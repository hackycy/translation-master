import type { ScanProgressEvent, WorkflowProgressEvent } from './types'
import path from 'node:path'
import process from 'node:process'
import { Command } from 'commander'
import pc from 'picocolors'
import { applyTranslations, restoreBackups } from './apply'
import { approveTranslations } from './approve'
import { initGlossary } from './glossary'
import { initProject } from './init'
import { createSpinner } from './prompts'
import { scanProject } from './scanner'
import { collectMapStats, formatMapStatsReport } from './stats'

export interface CreateCliOptions {
  version: string
}

export function createCli(options: CreateCliOptions): Command {
  const program = new Command()

  program
    .name('tmigrate')
    .description('Extract Chinese text from source files and manage i18n migration maps.')
    .version(options.version)

  program
    .command('init')
    .description('Create the .tmigrate directory structure with an interactive setup flow.')
    .option('-i, --interactive', 'force interactive setup prompts')
    .option('-y, --yes', 'skip prompts and use defaults')
    .option('--from <locale>', 'source locale')
    .option('--to <locale>', 'target locale')
    .option('--translator <backend>', 'translation backend: local, api, chrome')
    .option('--no-overwrite', 'preserve existing files')
    .action(async (command: { interactive?: boolean, yes?: boolean, from?: string, to?: string, translator?: string, overwrite?: boolean }) => {
      const interactive = command.yes ? false : command.interactive ?? Boolean(process.stdin.isTTY)
      const result = await initProject({
        ...command,
        translator: normalizeInitTranslator(command.translator),
        interactive,
      })
      console.log(pc.green(`Initialized .tmigrate (${result.created.length} created, ${result.skipped.length} skipped).`))
    })

  program
    .command('scan [path]')
    .description('Scan source files and write split map files under .tmigrate/maps.')
    .option('--to <locale>', 'target locale')
    .option('--incremental', 'scan only changed files')
    .option('--clean-deprecated', 'remove deprecated entries from map files')
    .action(async (targetPath: string | undefined, command: { to?: string, incremental?: boolean, cleanDeprecated?: boolean }) => {
      const progress = createScanProgressRenderer()
      const result = await scanProjectWithProgress({
        path: targetPath,
        to: command.to,
        incremental: command.incremental,
        cleanDeprecated: command.cleanDeprecated,
        onProgress: progress.update,
      }, progress)
      console.log(pc.green(`Scanned ${result.scannedFiles} file(s), skipped ${result.skippedFiles}, extracted ${result.extractedTexts} text(s).`))
    })

  program
    .command('approve')
    .description('Mark map entries as approved in bulk.')
    .option('--dry-run', 'preview approval counts without writing map files')
    .option('--path <path>', 'limit approval to a source file or directory')
    .option('--include-skipped', 'also approve entries marked with skip: true')
    .option('--include-deprecated', 'also approve entries marked with deprecated: true')
    .option('--allow-empty', 'also approve entries with empty translations')
    .action(async (command: {
      dryRun?: boolean
      path?: string
      includeSkipped?: boolean
      includeDeprecated?: boolean
      allowEmpty?: boolean
    }) => {
      const progress = createWorkflowProgressRenderer('approve')
      const result = await approveTranslations({
        dryRun: command.dryRun,
        path: command.path,
        includeSkipped: command.includeSkipped,
        includeDeprecated: command.includeDeprecated,
        allowEmpty: command.allowEmpty,
        onProgress: progress.update,
      })
      progress.stop('Approve finished.')
      const approved = result.files.reduce((sum, file) => sum + file.approved, 0)
      const changed = result.files.filter(file => file.changed).length
      const skipped = result.files.reduce((sum, file) => sum + file.skipped, 0)
      console.log(pc.green(`${result.dryRun ? 'Would approve' : 'Approved'} ${approved} entries in ${changed} map file(s).`))
      if (skipped > 0)
        console.log(pc.dim(`Skipped ${skipped} entries (skip/deprecated/empty translation).`))
    })

  program
    .command('stats [path]')
    .description('Summarize map files and translation progress.')
    .action(async (targetPath: string | undefined) => {
      const report = await collectMapStats({ path: targetPath })
      console.log(formatMapStatsReport(report))
    })

  const glossary = program
    .command('glossary')
    .description('Manage .tmigrate/glossary.json.')

  glossary
    .command('init')
    .description('Seed .tmigrate/glossary.json with built-in terminology presets.')
    .option('--preset <name>', 'preset glossary: ui, business, all', 'ui')
    .option('--from <locale>', 'source locale')
    .option('--to <locale>', 'target locale')
    .option('--overwrite', 'overwrite conflicting existing glossary entries')
    .option('--dry-run', 'preview changes without writing glossary.json')
    .action(async (command: {
      preset?: string
      from?: string
      to?: string
      overwrite?: boolean
      dryRun?: boolean
    }) => {
      const result = await initGlossary({
        preset: command.preset,
        from: command.from,
        to: command.to,
        overwrite: command.overwrite,
        dryRun: command.dryRun,
      })
      const verb = result.dryRun ? 'Would seed' : 'Seeded'
      console.log(pc.green(`${verb} ${pathRelativeToCwd(result.glossaryPath)} using ${result.preset} (${result.sourceLocale}->${result.targetLocale}).`))
      console.log(pc.dim(`Added ${result.added}, updated ${result.updated}, unchanged ${result.unchanged}, skipped ${result.skipped}.`))
      if (result.skipped > 0 && !command.overwrite)
        console.log(pc.dim('Use --overwrite to replace conflicting existing entries.'))
    })

  program
    .command('apply')
    .description('Apply approved translations back to source files.')
    .option('--dry-run', 'print a diff without writing files')
    .option('--path <path>', 'limit apply to a file or directory')
    .action(async (command: { dryRun?: boolean, path?: string }) => {
      const progress = createWorkflowProgressRenderer('apply')
      const result = await applyTranslations({
        dryRun: command.dryRun,
        path: command.path,
        onProgress: progress.update,
      })
      progress.stop('Apply finished.')
      for (const file of result.files) {
        if (file.diff)
          console.log(file.diff)
      }
      const changed = result.files.filter(file => file.changed).length
      console.log(pc.green(`${result.dryRun ? 'Previewed' : 'Applied'} ${changed} changed file(s).`))
    })

  program
    .command('restore')
    .description('Restore files from .tmigrate/backups.')
    .option('--path <path>', 'restore a specific file')
    .option('--list', 'list available backups')
    .action(async (command: { path?: string, list?: boolean }) => {
      const progress = createWorkflowProgressRenderer('restore')
      const result = await restoreBackups({
        path: command.path,
        list: command.list,
        onProgress: progress.update,
      })
      progress.stop('Restore finished.')
      if (command.list) {
        for (const entry of result.available)
          console.log(`${entry.sourcePath}\t${entry.backedUpAt}`)
        return
      }
      console.log(pc.green(`Restored ${result.restored.length} file(s).`))
    })

  return program
}

function normalizeInitTranslator(value: string | undefined): 'local' | 'api' | 'chrome' | undefined {
  if (!value)
    return undefined
  if (value === 'local' || value === 'api' || value === 'chrome')
    return value
  throw new Error(`Unsupported translator "${value}". Expected local, api, or chrome.`)
}

type ScanCommandOptions = Parameters<typeof scanProject>[0]

async function scanProjectWithProgress(options: ScanCommandOptions, progress: { stop: (message: string) => void }) {
  try {
    const result = await scanProject(options)
    progress.stop('Scan finished.')
    return result
  }
  catch (error) {
    progress.stop('Scan failed.')
    throw error
  }
}

function createScanProgressRenderer(): { update: (event: ScanProgressEvent) => void, stop: (message: string) => void } {
  const spinner = createSpinner()
  let started = false
  let finished = false
  let currentFilePath: string | undefined
  let currentFileIndex = 0
  let currentFileTotal = 0
  let lastMessage = ''

  const startOrUpdate = (message: string) => {
    if (finished)
      return
    if (message === lastMessage)
      return
    lastMessage = message
    if (started) {
      spinner.message(message)
      return
    }
    spinner.start(message)
    started = true
  }

  return {
    update(event) {
      if (event.phase === 'config') {
        startOrUpdate('Preparing translation workspace')
        return
      }
      if (event.phase === 'discover') {
        if (event.totalFiles !== undefined) {
          startOrUpdate(`Scanning source files (${event.totalFiles} found)`)
        }
        else {
          startOrUpdate('Scanning source files')
        }
        return
      }
      if (event.phase === 'file') {
        currentFilePath = event.filePath
        currentFileIndex = event.current
        currentFileTotal = event.total
        startOrUpdate(`Processing ${event.filePath} (${event.current}/${event.total})`)
        return
      }
      if (event.phase === 'model-load') {
        if (event.state === 'ready' || event.state === 'done')
          return
        startOrUpdate(formatModelLoadMessage(currentFilePath, currentFileIndex, currentFileTotal))
        return
      }
      if (event.phase === 'translate') {
        if (event.totalTexts === 0) {
          startOrUpdate(`Processing ${event.filePath} · glossary only`)
        }
        else {
          startOrUpdate(`Processing ${event.filePath} · translating ${event.completedTexts}/${event.totalTexts} texts (batch ${event.completedBatches}/${event.totalBatches})`)
        }
        return
      }
      if (event.phase === 'write') {
        currentFilePath = event.filePath
        currentFileIndex = event.current
        currentFileTotal = event.total
        startOrUpdate(`Processing ${event.filePath} · saving map`)
      }
    },
    stop(message) {
      if (finished)
        return
      finished = true
      if (started)
        spinner.stop(message)
    },
  }
}

function createWorkflowProgressRenderer(_action: 'approve' | 'apply' | 'restore'): { update: (event: WorkflowProgressEvent) => void, stop: (message: string) => void } {
  const spinner = createSpinner()
  let started = false
  let finished = false
  let lastMessage = ''

  const startOrUpdate = (message: string) => {
    if (finished || message === lastMessage)
      return
    lastMessage = message
    if (started) {
      spinner.message(message)
      return
    }
    spinner.start(message)
    started = true
  }

  return {
    update(event) {
      if (event.phase === 'prepare') {
        startOrUpdate(event.message)
        return
      }
      if (event.phase === 'discover') {
        startOrUpdate(event.message)
        return
      }
      if (event.phase === 'file') {
        const prefix = actionLabel(event.action)
        const dryRun = event.dryRun ? ' preview' : ''
        startOrUpdate(`${prefix}${dryRun}: ${event.path} (${event.current}/${event.total})`)
        return
      }
      if (event.phase === 'write') {
        const prefix = actionLabel(event.action)
        startOrUpdate(`${prefix}: ${event.path} (${event.current}/${event.total})`)
        return
      }
      if (event.phase === 'done') {
        startOrUpdate(event.message)
      }
    },
    stop(message) {
      if (finished)
        return
      finished = true
      if (started)
        spinner.stop(message)
    },
  }
}

function actionLabel(action: 'approve' | 'apply' | 'restore'): string {
  if (action === 'approve')
    return 'Approving'
  if (action === 'apply')
    return 'Applying'
  return 'Restoring'
}

function formatModelLoadMessage(
  filePath: string | undefined,
  currentFileIndex: number,
  currentFileTotal: number,
): string {
  const filePrefix = filePath ? `Processing ${filePath}` : 'Loading local model'
  const fileProgress = currentFileTotal > 0 ? ` (${currentFileIndex}/${currentFileTotal})` : ''
  return `${filePrefix}${fileProgress} · loading local model`
}

function pathRelativeToCwd(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath
}
