import type { MapFile, TextSegment, TranslationEntry } from './types'
import path from 'node:path'
import { readJsonFile, writeJsonFile } from './fs-utils'
import { keyCandidatesForText } from './keygen'
import { sourcePathToMapPath } from './paths'
import { isFuzzyMatch, similarity } from './utils/fuzzy-match'

export function createMapFile(entries: Record<string, TranslationEntry> = {}, now = new Date()): MapFile {
  return {
    version: 2,
    generatedAt: now.toISOString(),
    entries,
  }
}

export function createEntry(
  segment: TextSegment,
  translation = '',
  translationSource: TranslationEntry['translationSource'] = 'machine',
): TranslationEntry {
  return {
    id: segment.id,
    translation,
    translationSource,
    approved: translationSource === 'glossary',
    translationApproved: translationSource === 'glossary',
    key: keyCandidatesForText({ sourceText: segment.text, translation })[0],
    keySource: 'generated',
    keyApproved: translationSource === 'glossary',
    keyCandidates: keyCandidatesForText({ sourceText: segment.text, translation }),
    skip: false,
    location: {
      line: segment.line,
      column: segment.column,
      context: segment.context,
    },
  }
}

export function mergeMapEntries(
  previous: MapFile,
  segments: TextSegment[],
  nextEntries: Record<string, TranslationEntry>,
  options: { cleanDeprecated?: boolean } = {},
): MapFile {
  const segmentTexts = new Set(segments.map(segment => segment.text))
  const entries: Record<string, TranslationEntry> = {}
  const usedPreviousTexts = new Set<string>()

  for (const segment of segments) {
    const previousText = previous.entries[segment.text]
      ? segment.text
      : findFuzzyPreviousText(segment.text, previous.entries, usedPreviousTexts)
    const previousEntry = previousText ? previous.entries[previousText] : undefined
    if (previousText)
      usedPreviousTexts.add(previousText)
    const nextEntry = nextEntries[segment.text]
    const baseEntry = chooseEntry(previousEntry, nextEntry)
    const fuzzyTextChanged = Boolean(previousText && previousText !== segment.text)
    const machineTranslationChanged = Boolean(
      previousEntry
      && nextEntry
      && previousEntry.translationSource === 'machine'
      && previousEntry.translation !== nextEntry.translation,
    )

    entries[segment.text] = {
      ...(baseEntry ?? createEntry(segment)),
      id: nextEntry?.translationSource === 'glossary'
        ? segment.id
        : fuzzyTextChanged && previousEntry
          ? previousEntry.id
          : segment.id,
      approved: nextEntry?.translationSource === 'glossary'
        ? true
        : fuzzyTextChanged || machineTranslationChanged
          ? false
          : (baseEntry?.approved ?? false),
      translationApproved: nextEntry?.translationSource === 'glossary'
        ? true
        : fuzzyTextChanged || machineTranslationChanged
          ? false
          : (baseEntry?.translationApproved ?? baseEntry?.approved ?? false),
      key: fuzzyTextChanged && previousEntry?.keySource !== 'manual'
        ? nextEntry?.key
        : baseEntry?.key ?? nextEntry?.key,
      keySource: fuzzyTextChanged && previousEntry?.keySource !== 'manual'
        ? nextEntry?.keySource
        : baseEntry?.keySource ?? nextEntry?.keySource,
      keyApproved: nextEntry?.translationSource === 'glossary'
        ? true
        : fuzzyTextChanged && previousEntry?.keySource !== 'manual'
          ? false
          : (baseEntry?.keyApproved ?? baseEntry?.approved ?? false),
      keyCandidates: nextEntry?.keyCandidates ?? baseEntry?.keyCandidates,
      location: {
        line: segment.line,
        column: segment.column,
        context: segment.context,
      },
      deprecated: false,
    }
  }

  for (const [text, entry] of Object.entries(previous.entries)) {
    if (!options.cleanDeprecated && !segmentTexts.has(text) && !usedPreviousTexts.has(text)) {
      entries[text] = {
        ...entry,
        deprecated: true,
      }
    }
  }

  return createMapFile(entries)
}

export async function readMapFile(cwd: string, sourcePath: string): Promise<MapFile> {
  return readJsonFile<MapFile>(path.join(cwd, sourcePathToMapPath(sourcePath)), createMapFile())
}

export async function writeMapFile(cwd: string, sourcePath: string, mapFile: MapFile): Promise<string> {
  const mapPath = sourcePathToMapPath(sourcePath)
  await writeJsonFile(path.join(cwd, mapPath), mapFile)
  return mapPath
}

function findFuzzyPreviousText(
  text: string,
  previousEntries: Record<string, TranslationEntry>,
  usedTexts: Set<string>,
): string | undefined {
  let best: { text: string, score: number } | undefined
  for (const previousText of Object.keys(previousEntries)) {
    if (usedTexts.has(previousText) || !isFuzzyMatch(text, previousText))
      continue
    const score = similarity(text, previousText)
    if (!best || score > best.score)
      best = { text: previousText, score }
  }
  return best?.text
}

function chooseEntry(previousEntry: TranslationEntry | undefined, nextEntry: TranslationEntry | undefined): TranslationEntry | undefined {
  if (!previousEntry)
    return nextEntry
  if (!nextEntry)
    return previousEntry
  if (nextEntry.translationSource === 'glossary')
    return nextEntry
  if (previousEntry.translationSource === 'manual' || previousEntry.approved)
    return previousEntry
  return nextEntry
}
