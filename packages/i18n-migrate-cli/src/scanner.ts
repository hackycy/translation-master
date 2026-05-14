import type { ScanOptions, ScanResult, TranslationEntry } from './types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { glob } from 'tinyglobby'
import { hashFile, loadScanMeta, saveScanMeta } from './cache'
import { loadConfig } from './config'
import { Extractor } from './extractor'
import { loadGlossary } from './glossary'
import { assignEntryKeys } from './keygen'
import { createEntry, mergeMapEntries, readMapFile, writeMapFile } from './mapping'
import { sourcePathToMapPath, toPosixPath } from './paths'
import { createTranslator } from './translator'
import { translateTexts } from './translator/pipeline'

export async function scanProject(options: ScanOptions = {}): Promise<ScanResult> {
  const cwd = options.cwd ?? process.cwd()
  options.onProgress?.({ phase: 'config', message: 'Loading .tmigrate config and glossary' })
  const config = await loadConfig(cwd, options.to ? { targetLocale: options.to } : {})
  const glossary = await loadGlossary(cwd)
  const translator = options.translator ?? createTranslator(config, {
    onModelLoadProgress(event) {
      options.onProgress?.({
        phase: 'model-load',
        modelId: event.modelId,
        progress: event.progress,
        state: event.state,
        file: event.file,
        cacheDir: event.cacheDir,
        executablePath: event.executablePath,
        downloadUrl: event.downloadUrl,
        version: event.version,
      })
    },
  })
  await preflightTranslator(translator, config, options.onProgress)
  const extractor = new Extractor(config)
  const scanMeta = await loadScanMeta(cwd)
  options.onProgress?.({ phase: 'discover', message: 'Discovering source files' })
  const files = await findSourceFiles(cwd, options.path, config.include, config.exclude)
  const result: ScanResult = { scannedFiles: 0, skippedFiles: 0, extractedTexts: 0, mapFiles: [] }
  options.onProgress?.({ phase: 'discover', message: `Discovered ${files.length} source file(s)`, totalFiles: files.length })

  try {
    for (const [index, sourcePath] of files.entries()) {
      options.onProgress?.({ phase: 'file', filePath: sourcePath, current: index + 1, total: files.length })
      const absolutePath = path.join(cwd, sourcePath)
      const hash = await hashFile(absolutePath)
      const previousMeta = scanMeta[sourcePath]

      if (options.incremental && previousMeta?.hash === hash) {
        if (options.cleanDeprecated) {
          const previousMap = await readMapFile(cwd, sourcePath)
          const cleanedEntries = Object.fromEntries(
            Object.entries(previousMap.entries).filter(([, entry]) => !entry.deprecated),
          )
          await writeMapFile(cwd, sourcePath, { ...previousMap, generatedAt: new Date().toISOString(), entries: cleanedEntries })
        }
        result.skippedFiles++
        continue
      }

      const content = await readFile(absolutePath, 'utf8')
      const segments = extractor.extract(content, sourcePath)
      const previousMap = await readMapFile(cwd, sourcePath)
      const translationResults = await translateTexts({
        texts: segments.map(segment => segment.text),
        filePath: sourcePath,
        config,
        glossary,
        translator,
        onProgress(event) {
          options.onProgress?.({ phase: 'translate', filePath: sourcePath, ...event })
        },
      })
      const nextEntries: Record<string, TranslationEntry> = {}

      for (const segment of segments) {
        const translated = translationResults[segment.text]
        nextEntries[segment.text] = createEntry(
          segment,
          translated?.translation ?? '',
          translated?.translationSource ?? 'machine',
        )
      }

      const merged = mergeMapEntries(previousMap, segments, nextEntries, {
        cleanDeprecated: options.cleanDeprecated,
      })
      const keyed = {
        ...merged,
        entries: assignEntryKeys({
          sourcePath,
          entries: merged.entries,
          glossary,
        }),
      }
      const mapFile = await writeMapFile(cwd, sourcePath, keyed)

      scanMeta[sourcePath] = {
        hash,
        lastScanned: new Date().toISOString(),
        mapFile: sourcePathToMapPath(sourcePath).replace('.tmigrate/maps/', ''),
      }

      options.onProgress?.({ phase: 'write', filePath: sourcePath, current: index + 1, total: files.length })
      result.scannedFiles++
      result.extractedTexts += segments.length
      result.mapFiles.push(mapFile)
    }
  }
  finally {
    if (!options.translator)
      await translator.dispose?.()
  }

  await saveScanMeta(cwd, scanMeta)
  options.onProgress?.({ phase: 'done', result })
  return result
}

async function preflightTranslator(
  translator: ReturnType<typeof createTranslator>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  onProgress: ScanOptions['onProgress'],
): Promise<void> {
  if (config.translator !== 'chrome')
    return
  const chromeTranslator = translator as { preflight?: (options: { sourceLocale: string, targetLocale: string }) => Promise<void> }
  if (typeof chromeTranslator.preflight !== 'function')
    return

  onProgress?.({ phase: 'config', message: 'Checking managed Chrome availability' })
  await chromeTranslator.preflight({
    sourceLocale: config.sourceLocale,
    targetLocale: config.targetLocale,
  })
}

async function findSourceFiles(cwd: string, targetPath: string | undefined, include: string[], exclude: string[]): Promise<string[]> {
  const normalizedTarget = targetPath ? toPosixPath(path.relative(cwd, path.resolve(cwd, targetPath))) : undefined
  const patterns = normalizedTarget && normalizedTarget !== ''
    ? [await patternForTarget(cwd, normalizedTarget)]
    : include

  const ignored = exclude.flatMap(pattern => pattern.includes('*') ? [pattern] : [pattern, `${pattern}/**`])
  const files = await glob(patterns, {
    cwd,
    absolute: false,
    onlyFiles: true,
    ignore: ignored,
  })

  return files.map(toPosixPath).sort()
}

async function patternForTarget(cwd: string, target: string): Promise<string> {
  const absolute = path.join(cwd, target)
  const stat = await import('node:fs/promises').then(fs => fs.stat(absolute))
  if (stat.isDirectory())
    return `${target.replace(/\/$/, '')}/**/*.{vue,ts,tsx,js,jsx,json,html,css,scss,less,md,yaml,yml}`
  return target
}
