import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { extractQuotedStrings, finalizeSegments, replaceTranslations } from './range'

export const jsonParser: FileParser = {
  supportedExtensions: ['.json'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractJsonSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractJsonSegments(content: string, filePath: string) {
  try {
    JSON.parse(content)
  }
  catch {
    return []
  }
  return extractQuotedStrings(content, filePath, 'json-value', 'JSONString')
    .filter(segment => !isLikelyJsonKey(content, segment.end + 1) && segment.text.trim())
}

function isLikelyJsonKey(content: string, end: number): boolean {
  return /^\s*:/.test(content.slice(end, end + 12))
}
