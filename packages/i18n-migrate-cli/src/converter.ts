import type {
  ConvertFileChange,
  ConvertOptions,
  ConvertResult,
  LocalePackageFormat,
  MapFile,
  MigrateConfig,
  TranslationEntry,
  Translator,
} from './types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadConfig } from './config'
import { isNodeError, readJsonFile } from './fs-utils'
import { loadGlossary } from './glossary'
import { messageWithNamedParams } from './keygen'
import { findMapPaths } from './map-paths'
import { createMapFile } from './mapping'
import { mapPathToSourcePath, toPosixPath } from './paths'
import { createTranslator } from './translator'
import { translateTexts } from './translator/pipeline'

interface ConvertRuntimeOptions extends Required<Pick<ConvertOptions, 'format' | 'includeSourceLocale' | 'legacyTextKey' | 'outputDir' | 'targetLocale' | 'translateMissing'>> {
  namespace?: string
  sourceLocale: string
}

interface LocaleOutput {
  locale: string
  outputPath: string
  entries: Record<string, string>
  sourceMaps: Set<string>
}

export async function convertMaps(options: ConvertOptions = {}): Promise<ConvertResult> {
  const cwd = options.cwd ?? process.cwd()
  options.onProgress?.({ phase: 'prepare', message: options.dryRun ? 'Preparing locale package preview' : 'Preparing locale package conversion' })

  const config = await loadConfig(cwd)
  const runtime = resolveConvertOptions(config.convert, config.sourceLocale, config.targetLocale, options)
  const translationConfig: MigrateConfig = {
    ...config,
    sourceLocale: runtime.sourceLocale,
    targetLocale: runtime.targetLocale,
  }
  const mapPaths = await findMapPaths(cwd, options.path)
  const outputs = new Map<string, LocaleOutput>()
  const glossary = runtime.translateMissing ? await loadGlossary(cwd) : {}
  const translator = runtime.translateMissing
    ? options.translator ?? createTranslator(config)
    : undefined

  if (translator && config.translator === 'chrome') {
    const chromeTranslator = translator as { preflight?: (options: { sourceLocale: string, targetLocale: string }) => Promise<void> }
    if (typeof chromeTranslator.preflight === 'function') {
      options.onProgress?.({ phase: 'prepare', message: 'Checking managed Chrome availability' })
      await chromeTranslator.preflight({
        sourceLocale: translationConfig.sourceLocale,
        targetLocale: translationConfig.targetLocale,
      })
    }
  }

  options.onProgress?.({ phase: 'discover', message: `Found ${mapPaths.length} map file(s)`, total: mapPaths.length })

  try {
    for (const [index, mapPath] of mapPaths.entries()) {
      const sourcePath = mapPathToSourcePath(mapPath)
      options.onProgress?.({
        phase: 'file',
        path: sourcePath,
        current: index + 1,
        total: mapPaths.length,
        action: 'convert',
        dryRun: options.dryRun,
      })

      const mapFile = await readJsonFile<MapFile>(path.join(cwd, mapPath), createMapFile())
      const entries = activeEntries(mapFile, runtime)
      const translatedEntries = runtime.translateMissing
        ? await fillMissingTranslations(entries, sourcePath, translationConfig, glossary, translator, options)
        : entries

      if (runtime.includeSourceLocale) {
        const output = ensureOutput(outputs, runtime, sourcePath, runtime.sourceLocale)
        for (const [sourceText, entry] of translatedEntries)
          output.entries[entryLocaleKey(sourceText, entry, runtime)] = messageWithNamedParams(sourceText)
        output.sourceMaps.add(mapPath)
      }

      const targetOutput = ensureOutput(outputs, runtime, sourcePath, runtime.targetLocale)
      for (const [sourceText, entry] of translatedEntries) {
        if (entry.translation)
          targetOutput.entries[entryLocaleKey(sourceText, entry, runtime)] = messageWithNamedParams(entry.translation)
      }
      targetOutput.sourceMaps.add(mapPath)
    }
  }
  finally {
    if (translator && !options.translator)
      await translator.dispose?.()
  }

  const files: ConvertFileChange[] = []
  const orderedOutputs = [...outputs.values()].sort((left, right) => left.outputPath.localeCompare(right.outputPath))
  for (const [index, output] of orderedOutputs.entries()) {
    const content = serializeLocalePackage(output.entries, runtime.format)
    const absolutePath = path.join(cwd, output.outputPath)
    const before = await readTextFile(absolutePath)
    const changed = before !== content

    if (changed && !options.dryRun) {
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content, 'utf8')
      options.onProgress?.({
        phase: 'write',
        path: output.outputPath,
        current: index + 1,
        total: orderedOutputs.length,
        action: 'convert',
      })
    }

    files.push({
      locale: output.locale,
      outputPath: output.outputPath,
      changed,
      entries: Object.keys(output.entries).length,
      sourceMaps: [...output.sourceMaps].sort(),
    })
  }

  options.onProgress?.({ phase: 'done', message: 'Convert finished' })
  return {
    files,
    dryRun: options.dryRun === true,
    outputDir: runtime.outputDir,
    format: runtime.format,
  }
}

function resolveConvertOptions(
  convertConfig: Partial<ConvertRuntimeOptions> | undefined,
  configSourceLocale: string,
  configTargetLocale: string,
  options: ConvertOptions,
): ConvertRuntimeOptions {
  const outputDir = normalizeRelativePath(options.outputDir ?? convertConfig?.outputDir ?? 'locales/langs', 'output directory')
  const namespace = options.namespace ?? convertConfig?.namespace
  return {
    outputDir,
    format: normalizeFormat(options.format ?? convertConfig?.format ?? 'json'),
    namespace: namespace ? normalizeRelativePath(namespace, 'namespace') : undefined,
    sourceLocale: options.sourceLocale ?? convertConfig?.sourceLocale ?? configSourceLocale,
    targetLocale: options.targetLocale ?? convertConfig?.targetLocale ?? configTargetLocale,
    includeSourceLocale: options.includeSourceLocale ?? convertConfig?.includeSourceLocale ?? true,
    translateMissing: options.translateMissing ?? convertConfig?.translateMissing ?? false,
    legacyTextKey: options.legacyTextKey ?? convertConfig?.legacyTextKey ?? false,
  }
}

function activeEntries(mapFile: MapFile, runtime: ConvertRuntimeOptions): Array<[string, TranslationEntry]> {
  return Object.entries(mapFile.entries)
    .filter(([, entry]) => isReadyEntry(entry, runtime))
}

function isReadyEntry(entry: TranslationEntry, runtime: ConvertRuntimeOptions): boolean {
  if (entry.skip || entry.deprecated)
    return false
  if (!entry.approved || !(entry.translationApproved ?? true) || !(entry.keyApproved ?? true))
    return false
  if (!entry.translation && !runtime.translateMissing)
    return false
  if (!runtime.legacyTextKey && !entry.key)
    return false
  return true
}

function entryLocaleKey(sourceText: string, entry: TranslationEntry, options: ConvertRuntimeOptions): string {
  if (options.legacyTextKey)
    return sourceText
  if (!entry?.key)
    throw new Error(`Approved entry "${sourceText}" is missing an i18n key.`)
  return entry.key
}

async function fillMissingTranslations(
  entries: Array<[string, TranslationEntry]>,
  sourcePath: string,
  config: MigrateConfig,
  glossary: Record<string, string>,
  translator: Translator | undefined,
  options: ConvertOptions,
): Promise<Array<[string, TranslationEntry]>> {
  const missingTexts = entries
    .filter(([, entry]) => !entry.translation)
    .map(([text]) => text)

  if (missingTexts.length === 0 || !translator)
    return entries

  const translated = await translateTexts({
    texts: missingTexts,
    filePath: sourcePath,
    config,
    glossary,
    translator,
    onProgress(event) {
      options.onProgress?.({ phase: 'discover', message: `Translating missing locale entries ${event.completedTexts}/${event.totalTexts}` })
    },
  })

  return entries.map(([text, entry]) => {
    const result = translated[text]
    return [
      text,
      result?.translation
        ? { ...entry, translation: result.translation, translationSource: result.translationSource }
        : entry,
    ]
  })
}

function ensureOutput(
  outputs: Map<string, LocaleOutput>,
  options: ConvertRuntimeOptions,
  sourcePath: string,
  locale: string,
): LocaleOutput {
  const outputPath = localeOutputPath(options, sourcePath, locale)
  const existing = outputs.get(outputPath)
  if (existing)
    return existing

  const output: LocaleOutput = {
    locale,
    outputPath,
    entries: {},
    sourceMaps: new Set(),
  }
  outputs.set(outputPath, output)
  return output
}

function localeOutputPath(options: ConvertRuntimeOptions, sourcePath: string, locale: string): string {
  const modulePath = sourcePathToLocaleModulePath(sourcePath, options.format)
  return toPosixPath(path.join(
    options.outputDir,
    locale,
    options.namespace ?? '',
    modulePath,
  ))
}

function sourcePathToLocaleModulePath(sourcePath: string, format: LocalePackageFormat): string {
  const withoutSourceRoot = sourcePath.replace(/^(?:src|source)\//, '')
  const parsed = path.posix.parse(toPosixPath(withoutSourceRoot))
  return toPosixPath(path.posix.join(parsed.dir, `${parsed.name}.${format}`))
}

function serializeLocalePackage(entries: Record<string, string>, format: LocalePackageFormat): string {
  const sorted = Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)))
  const json = JSON.stringify(sorted, null, 2)

  if (format === 'json')
    return `${json}\n`
  return `export default ${json}\n`
}

function normalizeFormat(format: string): LocalePackageFormat {
  if (format === 'json' || format === 'js' || format === 'ts')
    return format
  throw new Error(`Unsupported locale package format "${format}". Expected json, js, or ts.`)
}

function normalizeRelativePath(value: string, label: string): string {
  const normalized = toPosixPath(value.trim()).replace(/^\/+|\/+$/g, '')
  if (!normalized)
    throw new Error(`Convert ${label} cannot be empty.`)
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../'))
    throw new Error(`Convert ${label} must stay inside the project: ${value}`)
  return normalized
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
