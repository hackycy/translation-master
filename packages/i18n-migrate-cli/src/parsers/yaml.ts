import type { FileParser, TextSegment, TranslationEntry } from '../types'
import YAML from 'yaml'
import { extractLines, finalizeSegments, leadingSpaces, replaceTranslations } from './range'

export const yamlParser: FileParser = {
  supportedExtensions: ['.yaml', '.yml'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractYamlSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractYamlSegments(content: string, filePath: string) {
  try {
    YAML.parse(content)
  }
  catch {
    return []
  }
  return extractLines(content, filePath, 'yaml-value', 'YAMLScalar')
    .map((segment) => {
      const colonIndex = segment.text.indexOf(':')
      if (colonIndex === -1)
        return segment
      const text = segment.text.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '')
      const start = segment.start + colonIndex + 1 + leadingSpaces(segment.text.slice(colonIndex + 1))
      return {
        ...segment,
        text,
        start,
        end: start + text.length,
      }
    })
    .filter(segment => segment.text.trim())
}
