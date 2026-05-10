import type { MapFile, TextSegment, TranslationEntry } from './types'

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
): MapFile {
  const segmentTexts = new Set(segments.map(segment => segment.text))
  const entries: Record<string, TranslationEntry> = {}

  for (const segment of segments) {
    entries[segment.text] = {
      ...(previous.entries[segment.text] ?? nextEntries[segment.text] ?? createEntry(segment)),
      id: segment.id,
      location: {
        line: segment.line,
        column: segment.column,
        context: segment.context,
      },
      deprecated: false,
    }
  }

  for (const [text, entry] of Object.entries(previous.entries)) {
    if (!segmentTexts.has(text)) {
      entries[text] = {
        ...entry,
        deprecated: true,
      }
    }
  }

  return createMapFile(entries)
}
