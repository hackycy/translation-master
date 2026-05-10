import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { simpleParser } from './simple'

export const scriptParser: FileParser = {
  supportedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  extract: (content: string, filePath: string): TextSegment[] => simpleParser.extract(content, filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => simpleParser.replace(content, segments, translations),
}
