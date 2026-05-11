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
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing preview of approved translations' : 'Preparing to apply approved translations' })
  const config = await loadConfig(cwd)
  const extractor = new Extractor(config)
  const replacer = new Replacer()
  const sourcePaths = await findMappedSourcePaths(cwd, options.path)
  const batchId = new Date().toISOString()
  const files: ApplyResult['files'] = []
  options.onProgress?.({ phase: 'discover', message: `Found ${sourcePaths.length} source file(s) with maps`, total: sourcePaths.length })

  for (const [index, sourcePath] of sourcePaths.entries()) {
    options.onProgress?.({
      phase: 'file',
      path: sourcePath,
      current: index + 1,
      total: sourcePaths.length,
      action: 'apply',
      dryRun: options.dryRun,
    })
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
      options.onProgress?.({ phase: 'write', path: sourcePath, current: index + 1, total: sourcePaths.length, action: 'apply' })
    }

    files.push({
      sourcePath,
      changed,
      applied,
      diff: options.dryRun ? createUnifiedDiff(sourcePath, content, next) : undefined,
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Apply finished' })
  return { files, dryRun: options.dryRun === true }
}

export async function restoreBackups(options: RestoreOptions = {}): Promise<RestoreResult> {
  const cwd = options.cwd ?? process.cwd()
  options.onProgress?.({ phase: 'prepare', message: options.list ? 'Loading backup list' : 'Preparing restore' })
  const meta = await loadBackupMeta(cwd)
  const available = listBackupEntries(meta, options.path)
  options.onProgress?.({ phase: 'discover', message: `Found ${available.length} backup entr${available.length === 1 ? 'y' : 'ies'}`, total: available.length })

  if (options.list)
    return { restored: [], available }

  const restored: string[] = []
  for (const [index, entry] of available.entries()) {
    options.onProgress?.({
      phase: 'file',
      path: entry.sourcePath,
      current: index + 1,
      total: available.length,
      action: 'restore',
    })
    await copyFile(path.join(cwd, entry.backupPath), path.join(cwd, entry.sourcePath))
    restored.push(entry.sourcePath)
    options.onProgress?.({
      phase: 'write',
      path: entry.sourcePath,
      current: index + 1,
      total: available.length,
      action: 'restore',
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Restore finished' })
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
