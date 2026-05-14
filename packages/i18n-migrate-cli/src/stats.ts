import type { MapFile, MapStatsBucket, MapStatsFile, MapStatsReport, TranslationEntry } from './types'
import { access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pc from 'picocolors'
import { readJsonFile } from './fs-utils'
import { findMapPaths } from './map-paths'
import { createMapFile } from './mapping'
import { mapPathToSourcePath } from './paths'

export interface MapStatsOptions {
  cwd?: string
  path?: string
}

const FOCUS_FILE_LIMIT = 5
const BAR_WIDTH = 18

export async function collectMapStats(options: MapStatsOptions = {}): Promise<MapStatsReport> {
  const cwd = options.cwd ?? process.cwd()
  const mapPaths = await findMapPaths(cwd, options.path)
  const report: MapStatsReport = {
    discoveredMapFiles: mapPaths.length,
    validMapFiles: 0,
    current: createEmptyBucket(),
    orphaned: createEmptyBucket(),
    invalidFiles: [],
    files: [],
  }

  for (const mapPath of mapPaths) {
    const sourcePath = mapPathToSourcePath(mapPath)
    const absoluteMapPath = path.join(cwd, mapPath)
    const absoluteSourcePath = path.join(cwd, sourcePath)

    let mapFile: MapFile
    try {
      mapFile = await readJsonFile<MapFile>(absoluteMapPath, createMapFile())
    }
    catch (error) {
      report.invalidFiles.push({
        mapPath,
        sourcePath,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    const sourceExists = await exists(absoluteSourcePath)
    const fileStats = summarizeMapFile(mapFile, { sourcePath, mapPath, sourceExists })
    report.validMapFiles += 1
    report.files.push(fileStats)
    mergeBucket(sourceExists ? report.current : report.orphaned, fileStats)
  }

  return report
}

export function formatMapStatsReport(report: MapStatsReport): string {
  const lines: string[] = []
  const currentEntries = report.current.entries
  const orphanEntries = report.orphaned.entries
  const totalEntries = currentEntries + orphanEntries
  const activeEntries = report.current.readyToApplyEntries + report.current.pendingReviewEntries + report.current.untranslatedEntries
  const translatedEntries = report.current.readyToApplyEntries + report.current.pendingReviewEntries
  const excludedEntries = report.current.skippedEntries + report.current.deprecatedEntries
  const riskyMapFiles = report.orphaned.mapFiles + report.invalidFiles.length

  lines.push(pc.bold('tmigrate stats dashboard'))
  lines.push(pc.dim('统计口径：按 map 条目数，不是源码出现次数。'))
  lines.push('')

  lines.push(pc.cyan('总览'))
  lines.push(renderMetric('Map 文件', `${formatCount(report.discoveredMapFiles)} 总计 · ${formatCount(report.validMapFiles)} 可读 · ${formatCount(report.invalidFiles.length)} 损坏`))
  lines.push(renderMetric('工作集', `${formatCount(report.current.mapFiles)} 当前 · ${formatCount(report.orphaned.mapFiles)} 孤儿`))
  lines.push(renderMetric('当前条目', `${formatCount(currentEntries)} 条 · ${formatCount(activeEntries)} 活跃 · ${formatCount(excludedEntries)} 已排除`))
  lines.push(renderMetric('总条目', `${formatCount(totalEntries)} 条（含 ${formatCount(orphanEntries)} 条孤儿）`))
  lines.push(renderMetric('风险', riskyMapFiles === 0 ? pc.green('暂无孤儿或损坏 map') : pc.yellow(`${formatCount(riskyMapFiles)} 个 map 需要关注`)))
  lines.push('')

  lines.push(pc.cyan('迁移进度'))
  lines.push(renderProgress('译文覆盖', translatedEntries, activeEntries))
  lines.push(renderProgress('已批准', report.current.readyToApplyEntries, translatedEntries))
  lines.push(renderProgress('可回写', report.current.readyToApplyEntries, activeEntries))
  lines.push('')

  lines.push(pc.cyan('工作队列'))
  lines.push(renderQueueRow('可回写', report.current.readyToApplyEntries, activeEntries, pc.green))
  lines.push(renderQueueRow('待校对', report.current.pendingReviewEntries, activeEntries, pc.yellow))
  lines.push(renderQueueRow('待补译', report.current.untranslatedEntries, activeEntries, pc.red))
  lines.push(renderQueueRow('已跳过', report.current.skippedEntries, currentEntries, pc.dim))
  lines.push(renderQueueRow('已废弃', report.current.deprecatedEntries, currentEntries, pc.dim))
  lines.push('')

  lines.push(pc.cyan('译文来源'))
  lines.push(renderSourceRow('glossary', report.current.translationSourceCounts.glossary, translatedEntries))
  lines.push(renderSourceRow('machine', report.current.translationSourceCounts.machine, translatedEntries))
  lines.push(renderSourceRow('manual', report.current.translationSourceCounts.manual, translatedEntries))

  const focusFiles = getFocusFiles(report.files)
  lines.push('')
  lines.push(pc.cyan('重点文件 Top 5'))
  if (focusFiles.length === 0) {
    lines.push('- 暂无待补译、待校对或废弃条目。')
  }
  else {
    for (const file of focusFiles) {
      const pending = file.pendingReviewEntries + file.untranslatedEntries + file.deprecatedEntries
      lines.push(
        `- ${file.sourcePath} · 待处理 ${formatCount(pending)}`
        + `（补译 ${formatCount(file.untranslatedEntries)}, 校对 ${formatCount(file.pendingReviewEntries)}, 废弃 ${formatCount(file.deprecatedEntries)}）`,
      )
    }
  }

  if (report.orphaned.mapFiles > 0) {
    lines.push('')
    lines.push(pc.yellow('孤儿 map Top 5'))
    for (const file of getOrphanFiles(report.files)) {
      lines.push(`- ${file.sourcePath} · ${formatCount(file.totalEntries)} 条`)
    }
  }

  if (report.invalidFiles.length > 0) {
    lines.push('')
    lines.push(pc.red('损坏 map Top 5'))
    for (const file of report.invalidFiles.slice(0, FOCUS_FILE_LIMIT))
      lines.push(`- ${file.mapPath}: ${file.error}`)
    if (report.invalidFiles.length > FOCUS_FILE_LIMIT)
      lines.push(pc.dim(`- 另有 ${formatCount(report.invalidFiles.length - FOCUS_FILE_LIMIT)} 个损坏 map 未显示。`))
  }

  lines.push('')
  lines.push(pc.cyan('建议'))
  if (report.current.untranslatedEntries > 0)
    lines.push(`- 先补齐 ${formatCount(report.current.untranslatedEntries)} 条待翻译文本。`)
  if (report.current.pendingReviewEntries > 0)
    lines.push(`- 再校对 ${formatCount(report.current.pendingReviewEntries)} 条译文，然后执行 \`tmigrate approve\`。`)
  if (report.current.readyToApplyEntries > 0)
    lines.push(`- 当前已有 ${formatCount(report.current.readyToApplyEntries)} 条可回写，执行 \`tmigrate apply\`。`)
  if (report.current.deprecatedEntries > 0)
    lines.push(`- 有 ${formatCount(report.current.deprecatedEntries)} 条废弃条目，可执行 \`tmigrate scan --clean-deprecated\`。`)
  if (report.orphaned.mapFiles > 0)
    lines.push(`- 有 ${formatCount(report.orphaned.mapFiles)} 个孤儿 map 文件，建议删除对应文件或重新扫描。`)
  if (report.invalidFiles.length > 0)
    lines.push(`- 先修复 ${formatCount(report.invalidFiles.length)} 个损坏的 map 文件，再继续统计或回写。`)
  if (
    report.current.untranslatedEntries === 0
    && report.current.pendingReviewEntries === 0
    && report.current.readyToApplyEntries === 0
    && report.current.deprecatedEntries === 0
    && report.orphaned.mapFiles === 0
    && report.invalidFiles.length === 0
  ) {
    lines.push('- 当前没有明显待处理项。')
  }

  return lines.join('\n')
}

function createEmptyBucket(): MapStatsBucket {
  return {
    mapFiles: 0,
    entries: 0,
    readyToApplyEntries: 0,
    pendingReviewEntries: 0,
    untranslatedEntries: 0,
    skippedEntries: 0,
    deprecatedEntries: 0,
    translationSourceCounts: {
      glossary: 0,
      machine: 0,
      manual: 0,
    },
  }
}

function summarizeMapFile(
  mapFile: MapFile,
  file: Pick<MapStatsFile, 'sourcePath' | 'mapPath' | 'sourceExists'>,
): MapStatsFile {
  const stats = createEmptyBucket()
  const entries = Object.values(mapFile.entries)
  stats.entries = entries.length

  for (const entry of entries)
    classifyEntry(entry, stats)

  return {
    ...file,
    totalEntries: entries.length,
    readyToApplyEntries: stats.readyToApplyEntries,
    pendingReviewEntries: stats.pendingReviewEntries,
    untranslatedEntries: stats.untranslatedEntries,
    skippedEntries: stats.skippedEntries,
    deprecatedEntries: stats.deprecatedEntries,
    translationSourceCounts: stats.translationSourceCounts,
  }
}

function classifyEntry(entry: TranslationEntry, stats: MapStatsBucket): void {
  if (entry.deprecated) {
    stats.deprecatedEntries += 1
    return
  }

  if (entry.skip) {
    stats.skippedEntries += 1
    return
  }

  if (!hasMeaningfulTranslation(entry.translation)) {
    stats.untranslatedEntries += 1
    return
  }

  stats.translationSourceCounts[entry.translationSource] += 1

  if (entry.approved && (entry.translationApproved ?? true) && (entry.keyApproved ?? true) && entry.key)
    stats.readyToApplyEntries += 1
  else
    stats.pendingReviewEntries += 1
}

function mergeBucket(target: MapStatsBucket, source: MapStatsFile): void {
  target.mapFiles += 1
  target.entries += source.totalEntries
  target.readyToApplyEntries += source.readyToApplyEntries
  target.pendingReviewEntries += source.pendingReviewEntries
  target.untranslatedEntries += source.untranslatedEntries
  target.skippedEntries += source.skippedEntries
  target.deprecatedEntries += source.deprecatedEntries
  target.translationSourceCounts.glossary += source.translationSourceCounts.glossary
  target.translationSourceCounts.machine += source.translationSourceCounts.machine
  target.translationSourceCounts.manual += source.translationSourceCounts.manual
}

function hasMeaningfulTranslation(translation: string): boolean {
  return translation.trim().length > 0
}

function getFocusFiles(files: MapStatsFile[]): MapStatsFile[] {
  return files
    .filter(file => file.sourceExists)
    .filter(file => file.pendingReviewEntries > 0 || file.untranslatedEntries > 0 || file.deprecatedEntries > 0)
    .sort((left, right) => getPendingScore(right) - getPendingScore(left) || left.sourcePath.localeCompare(right.sourcePath))
    .slice(0, FOCUS_FILE_LIMIT)
}

function getOrphanFiles(files: MapStatsFile[]): MapStatsFile[] {
  return files
    .filter(file => !file.sourceExists)
    .sort((left, right) => right.totalEntries - left.totalEntries || left.sourcePath.localeCompare(right.sourcePath))
    .slice(0, FOCUS_FILE_LIMIT)
}

function getPendingScore(file: MapStatsFile): number {
  return file.pendingReviewEntries + file.untranslatedEntries + file.deprecatedEntries
}

function renderMetric(label: string, value: string): string {
  return `  ${label.padEnd(8)} ${value}`
}

function renderProgress(label: string, value: number, total: number): string {
  return `  ${label.padEnd(8)} ${renderBar(value, total)} ${formatCount(value)} / ${formatCount(total)} (${formatPercent(value, total)})`
}

function renderQueueRow(label: string, value: number, total: number, color: (input: string | number | null | undefined) => string): string {
  const count = formatCount(value).padStart(6)
  return `  ${label.padEnd(8)} ${color(count)}  ${formatPercent(value, total)}`
}

function renderSourceRow(label: string, value: number, total: number): string {
  return `  ${label.padEnd(8)} ${renderBar(value, total)} ${formatCount(value)} (${formatPercent(value, total)})`
}

function renderBar(value: number, total: number): string {
  const ratio = total === 0 ? 0 : value / total
  const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round(ratio * BAR_WIDTH)))
  const empty = BAR_WIDTH - filled
  return `${pc.green('█'.repeat(filled))}${pc.dim('░'.repeat(empty))}`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0)
    return '0%'
  return `${(numerator / denominator * 100).toFixed(1)}%`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}
