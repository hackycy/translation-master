import type { ScanOptions, ScanResult, TranslationEntry } from './types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { glob } from 'tinyglobby'
import { hashFile, loadScanMeta, saveScanMeta } from './cache'
import { loadConfig } from './config'
import { Extractor } from './extractor'
import { loadGlossary } from './glossary'
import { createEntry, mergeMapEntries, readMapFile, writeMapFile } from './mapping'
import { sourcePathToMapPath, toPosixPath } from './paths'
import { createTranslator } from './translator'
import { translateTexts } from './translator/pipeline'

export async function scanProject(options: ScanOptions = {}): Promise<ScanResult> {
  const cwd = options.cwd ?? process.cwd()
  const config = await loadConfig(cwd, options.to ? { targetLocale: options.to } : {})
  const glossary = await loadGlossary(cwd)
  const translator = options.translator ?? createTranslator(config)
  const extractor = new Extractor(config)
  const scanMeta = await loadScanMeta(cwd)
  const files = await findSourceFiles(cwd, options.path, config.include, config.exclude)
  const result: ScanResult = { scannedFiles: 0, skippedFiles: 0, extractedTexts: 0, mapFiles: [] }

  for (const sourcePath of files) {
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
    const mapFile = await writeMapFile(cwd, sourcePath, merged)

    scanMeta[sourcePath] = {
      hash,
      lastScanned: new Date().toISOString(),
      mapFile: sourcePathToMapPath(sourcePath).replace('.tmigrate/maps/', ''),
    }

    result.scannedFiles++
    result.extractedTexts += segments.length
    result.mapFiles.push(mapFile)
  }

  await saveScanMeta(cwd, scanMeta)
  return result
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
