import type { ApproveOptions, ApproveResult, TranslationEntry } from './types'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { keyCandidatesForText } from './keygen'
import { findMapPaths } from './map-paths'
import { createMapFile } from './mapping'
import { mapPathToSourcePath } from './paths'

export async function approveTranslations(options: ApproveOptions = {}): Promise<ApproveResult> {
  const cwd = options.cwd ?? process.cwd()
  const mapPaths = await findMapPaths(cwd, options.path)
  const files: ApproveResult['files'] = []
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing approval preview' : 'Preparing to approve map entries' })
  options.onProgress?.({ phase: 'discover', message: `Found ${mapPaths.length} map file(s)`, total: mapPaths.length })

  for (const [index, mapPath] of mapPaths.entries()) {
    options.onProgress?.({
      phase: 'file',
      path: mapPathToSourcePath(mapPath),
      current: index + 1,
      total: mapPaths.length,
      action: 'approve',
      dryRun: options.dryRun,
    })
    const absolutePath = path.join(cwd, mapPath)
    const mapFile = await readJsonFile(absolutePath, createMapFile())
    let approved = 0
    let alreadyApproved = 0
    let skipped = 0

    for (const [sourceText, entry] of Object.entries(mapFile.entries)) {
      if (!isApprovableEntry(sourceText, entry, options)) {
        skipped += 1
        continue
      }
      if (isFullyApproved(entry)) {
        alreadyApproved += 1
        continue
      }
      entry.translationApproved = true
      entry.keyApproved = true
      entry.approved = true
      approved += 1
    }

    const changed = approved > 0
    if (changed && !options.dryRun) {
      await writeJsonFile(absolutePath, mapFile)
      options.onProgress?.({
        phase: 'write',
        path: mapPathToSourcePath(mapPath),
        current: index + 1,
        total: mapPaths.length,
        action: 'approve',
      })
    }

    files.push({
      sourcePath: mapPathToSourcePath(mapPath),
      mapPath,
      changed,
      approved,
      alreadyApproved,
      skipped,
      total: Object.keys(mapFile.entries).length,
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Approve finished' })
  return { files, dryRun: options.dryRun === true }
}

function isApprovableEntry(sourceText: string, entry: TranslationEntry, options: ApproveOptions): boolean {
  if (!options.includeSkipped && entry.skip)
    return false
  if (!options.includeDeprecated && entry.deprecated)
    return false
  if (!options.allowEmpty && !entry.translation)
    return false
  if (!entry.key && !ensureEntryKey(sourceText, entry))
    return false
  return true
}

function isFullyApproved(entry: TranslationEntry): boolean {
  return entry.approved
    && (entry.translationApproved ?? true)
    && (entry.keyApproved ?? true)
}

function ensureEntryKey(sourceText: string, entry: TranslationEntry): boolean {
  const candidate = entry.keyCandidates?.[0] ?? keyCandidatesForText({ sourceText, translation: entry.translation })[0]
  if (!candidate)
    return false
  entry.key = candidate
  entry.keySource = entry.keySource ?? 'generated'
  return true
}
