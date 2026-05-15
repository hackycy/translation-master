import type { MigrateConfigInput } from './config'
import type {
  MigrateConfig,
  TranslateLocaleFileChange,
  TranslateLocaleOptions,
  TranslateLocaleResult,
  TranslationEntry,
  Translator,
} from './types'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { glob } from 'tinyglobby'
import { defineConfig } from './config'
import { isNodeError } from './fs-utils'
import { createDefaultParser } from './parsers/parser'
import { toPosixPath } from './paths'
import { createTranslator } from './translator'
import { translateTexts } from './translator/pipeline'

const LOCALE_FILE_PATTERN = '**/*.{json,js,ts}'

export async function translateLocalePackage(options: TranslateLocaleOptions): Promise<TranslateLocaleResult> {
  const cwd = options.cwd ?? process.cwd()
  const sourceDir = await resolveSourceDir(cwd, options.path)
  const outputDir = resolveOutputDir(cwd, sourceDir, options.outputDir, options.sourceLocale, options.targetLocale)
  assertSafeOutputDir(sourceDir, outputDir)

  const sourceDirLabel = displayPath(cwd, sourceDir)
  const outputDirLabel = displayPath(cwd, outputDir)
  options.onProgress?.({
    phase: 'prepare',
    message: options.dryRun
      ? `Preparing locale package translation preview ${sourceDirLabel} -> ${outputDirLabel}`
      : `Preparing locale package translation ${sourceDirLabel} -> ${outputDirLabel}`,
  })

  const config = createRuntimeConfig(options)
  const translator = options.translator ?? createTranslator(config, {
    onModelLoadProgress(event) {
      options.onProgress?.({
        phase: 'discover',
        message: formatTranslatorProgress(event.state, event.progress),
      })
    },
  })
  await preflightTranslator(translator, config)

  const parser = createDefaultParser()
  const files = await findLocaleFiles(sourceDir)
  options.onProgress?.({ phase: 'discover', message: `Found ${files.length} locale file(s)`, total: files.length })

  const resultFiles: TranslateLocaleFileChange[] = []
  try {
    for (const [index, sourcePath] of files.entries()) {
      const relativePath = toPosixPath(path.relative(sourceDir, sourcePath))
      const outputPath = path.join(outputDir, relativePath)
      options.onProgress?.({
        phase: 'file',
        path: displayPath(cwd, sourcePath),
        current: index + 1,
        total: files.length,
        action: 'translate-locale',
        dryRun: options.dryRun,
      })

      const content = await readFile(sourcePath, 'utf8')
      const parserPath = parserPathFor(sourcePath)
      const segments = parser.extract(content, parserPath).filter(segment => segment.text.trim())
      const translations = segments.length > 0
        ? await translateLocaleTexts({
            texts: segments.map(segment => segment.text),
            filePath: displayPath(cwd, sourcePath),
            config,
            translator,
            onProgress: options.onProgress,
          })
        : {}
      const entries = toTranslationEntries(translations)
      const nextContent = parser.replaceFile(content, parserPath, segments, entries).content
      const before = await readTextFile(outputPath)
      const outputExists = before !== undefined
      const skipped = outputExists && options.overwrite !== true
      const changed = !skipped && before !== nextContent

      if (changed && !options.dryRun) {
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, nextContent, 'utf8')
        options.onProgress?.({
          phase: 'write',
          path: displayPath(cwd, outputPath),
          current: index + 1,
          total: files.length,
          action: 'translate-locale',
        })
      }

      resultFiles.push({
        sourcePath: displayPath(cwd, sourcePath),
        outputPath: displayPath(cwd, outputPath),
        changed,
        skipped,
        entries: new Set(segments.map(segment => segment.text)).size,
      })
    }
  }
  finally {
    if (!options.translator)
      await translator.dispose?.()
  }

  options.onProgress?.({ phase: 'done', message: 'Locale package translation finished' })
  return {
    files: resultFiles,
    dryRun: options.dryRun === true,
    sourceDir: sourceDirLabel,
    outputDir: outputDirLabel,
    sourceLocale: options.sourceLocale,
    targetLocale: options.targetLocale,
  }
}

async function resolveSourceDir(cwd: string, sourcePath: string): Promise<string> {
  const absolute = path.resolve(cwd, sourcePath)
  const stats = await stat(absolute)
  if (!stats.isDirectory())
    throw new Error(`Locale package path must be a directory: ${sourcePath}`)
  return absolute
}

function resolveOutputDir(cwd: string, sourceDir: string, outputDir: string | undefined, sourceLocale: string, targetLocale: string): string {
  if (outputDir)
    return path.resolve(cwd, outputDir)

  const parent = path.dirname(sourceDir)
  const baseName = path.basename(sourceDir)
  if (normalizeLocaleName(baseName) === normalizeLocaleName(sourceLocale))
    return path.join(parent, targetLocale)

  return path.join(parent, `${baseName}-${targetLocale}`)
}

function assertSafeOutputDir(sourceDir: string, outputDir: string): void {
  const normalizedSource = withTrailingSeparator(path.resolve(sourceDir))
  const normalizedOutput = withTrailingSeparator(path.resolve(outputDir))

  if (normalizedOutput === normalizedSource)
    throw new Error('Locale package output directory must be different from the source directory.')
  if (normalizedOutput.startsWith(normalizedSource))
    throw new Error('Locale package output directory cannot be inside the source directory.')
}

function createRuntimeConfig(options: TranslateLocaleOptions): MigrateConfig {
  return defineConfig(compactConfigInput({
    sourceLocale: options.sourceLocale,
    targetLocale: options.targetLocale,
    translator: options.translatorBackend ?? 'local',
    translatorOptions: compactTranslatorOptions(options.translatorOptions),
    batchSize: options.batchSize,
  }))
}

function compactConfigInput(input: {
  sourceLocale: string
  targetLocale: string
  translator: MigrateConfig['translator']
  translatorOptions?: TranslateLocaleOptions['translatorOptions']
  batchSize?: number
}): MigrateConfigInput {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as MigrateConfigInput
}

function compactTranslatorOptions(options: TranslateLocaleOptions['translatorOptions']): TranslateLocaleOptions['translatorOptions'] | undefined {
  if (!options)
    return undefined

  const entries = Object.entries(options).filter(([, value]) => value !== undefined)
  return entries.length > 0
    ? Object.fromEntries(entries) as TranslateLocaleOptions['translatorOptions']
    : undefined
}

async function preflightTranslator(translator: Translator, config: MigrateConfig): Promise<void> {
  if (config.translator !== 'chrome')
    return
  await translator.preflight?.({
    sourceLocale: config.sourceLocale,
    targetLocale: config.targetLocale,
  })
}

async function findLocaleFiles(sourceDir: string): Promise<string[]> {
  const files = await glob(LOCALE_FILE_PATTERN, {
    cwd: sourceDir,
    absolute: true,
    onlyFiles: true,
    ignore: ['node_modules', 'dist', 'coverage'],
  })
  return files.map(file => path.resolve(file)).sort((left, right) => left.localeCompare(right))
}

async function translateLocaleTexts(input: {
  texts: string[]
  filePath: string
  config: MigrateConfig
  translator: Translator
  onProgress?: TranslateLocaleOptions['onProgress']
}) {
  return translateTexts({
    texts: input.texts,
    filePath: input.filePath,
    config: input.config,
    glossary: {},
    translator: input.translator,
    onProgress(event) {
      input.onProgress?.({
        phase: 'discover',
        message: `Translating ${input.filePath} ${event.completedTexts}/${event.totalTexts}`,
      })
    },
  })
}

function toTranslationEntries(translations: Awaited<ReturnType<typeof translateLocaleTexts>>): Map<string, TranslationEntry> {
  const entries = new Map<string, TranslationEntry>()
  for (const [text, result] of Object.entries(translations)) {
    entries.set(text, {
      id: `locale:${text}`,
      translation: result.translation,
      translationSource: result.translationSource,
      approved: true,
      translationApproved: true,
      skip: false,
    })
  }
  return entries
}

function parserPathFor(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs'))
    return `${filePath}.js`
  return filePath
}

function formatTranslatorProgress(state: string, progress: number): string {
  if (state === 'ready' || state === 'done' || state === 'translator-ready' || state === 'translator-translated')
    return 'Translator is ready'
  const suffix = progress > 0 ? ` ${progress}%` : ''
  return `Preparing translator (${state}${suffix})`
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8')
  }
  catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      return undefined
    throw error
  }
}

function displayPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    return toPosixPath(relative)
  return toPosixPath(filePath)
}

function withTrailingSeparator(filePath: string): string {
  return filePath.endsWith(path.sep) ? filePath : `${filePath}${path.sep}`
}

function normalizeLocaleName(locale: string): string {
  return locale.toLowerCase().replace(/_/g, '-')
}
