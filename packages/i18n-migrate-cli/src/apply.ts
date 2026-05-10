import type { ApplyOptions, ApplyResult, RestoreOptions, RestoreResult, TranslationEntry } from './types'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { glob } from 'tinyglobby'
import { backupFile, listBackupEntries, loadBackupMeta } from './backup'
import { loadConfig } from './config'
import { Extractor } from './extractor'
import { readMapFile } from './mapping'
import { mapPathToSourcePath, sourcePathToMapPath, toPosixPath } from './paths'
import { Replacer } from './replacer'
import { createUnifiedDiff } from './reporter'

export async function applyTranslations(options: ApplyOptions = {}): Promise<ApplyResult> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd)
  const extractor = new Extractor(config)
  const replacer = new Replacer()
  const sourcePaths = await findMappedSourcePaths(cwd, options.path)
  const batchId = new Date().toISOString()
  const files: ApplyResult['files'] = []

  for (const sourcePath of sourcePaths) {
    const absolutePath = path.join(cwd, sourcePath)
    const content = await readFile(absolutePath, 'utf8')
    const mapFile = await readMapFile(cwd, sourcePath)
    const translations = new Map<string, TranslationEntry>(Object.entries(mapFile.entries))
    const segments = extractor.extract(content, sourcePath)
    const replaced = replacer.replace(content, sourcePath, segments, translations)
    const next = replaced.content
    const applied = replaced.applied
    const changed = next !== content

    if (changed && !options.dryRun) {
      await backupFile(cwd, sourcePath, batchId)
      await writeFile(absolutePath, next, 'utf8')
    }

    files.push({
      sourcePath,
      changed,
      applied,
      diff: options.dryRun ? createUnifiedDiff(sourcePath, content, next) : undefined,
    })
  }

  return { files, dryRun: options.dryRun === true }
}

export async function restoreBackups(options: RestoreOptions = {}): Promise<RestoreResult> {
  const cwd = options.cwd ?? process.cwd()
  const meta = await loadBackupMeta(cwd)
  const available = listBackupEntries(meta, options.path)

  if (options.list)
    return { restored: [], available }

  const restored: string[] = []
  for (const entry of available) {
    await copyFile(path.join(cwd, entry.backupPath), path.join(cwd, entry.sourcePath))
    restored.push(entry.sourcePath)
  }

  return { restored, available }
}

async function findMappedSourcePaths(cwd: string, targetPath?: string): Promise<string[]> {
  const mapPaths = await glob('.tmigrate/maps/**/*.json', {
    cwd,
    absolute: false,
    onlyFiles: true,
  })
  const normalizedTarget = targetPath ? toPosixPath(targetPath).replace(/\/$/, '') : undefined
  return mapPaths
    .map(mapPathToSourcePath)
    .filter((sourcePath) => {
      if (!normalizedTarget)
        return true
      return sourcePath === normalizedTarget
        || sourcePath.startsWith(`${normalizedTarget}/`)
        || sourcePathToMapPath(sourcePath).startsWith(sourcePathToMapPath(normalizedTarget).replace(/\.json$/, '/'))
    })
    .sort()
}
