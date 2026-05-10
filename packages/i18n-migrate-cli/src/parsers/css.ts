import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { simpleParser } from './simple'

export const cssParser: FileParser = {
  supportedExtensions: ['.css', '.scss', '.less'],
  extract: (content: string, filePath: string): TextSegment[] => simpleParser.extract(content, filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => simpleParser.replace(content, segments, translations),
}
