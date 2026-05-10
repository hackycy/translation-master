import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { simpleParser } from './simple'

export const yamlParser: FileParser = {
  supportedExtensions: ['.yaml', '.yml'],
  extract: (content: string, filePath: string): TextSegment[] => simpleParser.extract(content, filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => simpleParser.replace(content, segments, translations),
}
