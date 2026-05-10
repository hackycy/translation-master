import type { FileParser, TextSegment, TranslationEntry } from './types'
import { createDefaultParser } from './parsers/parser'

export interface ReplaceResult {
  content: string
  applied: number
  sourceMap?: object
}

export class Replacer {
  constructor(private readonly parser: FileParser = createDefaultParser()) {}

  replace(content: string, filePath: string, segments: TextSegment[], translations: Map<string, TranslationEntry>): ReplaceResult {
    const result = hasReplaceFile(this.parser)
      ? this.parser.replaceFile(content, filePath, segments, translations)
      : this.parser.replace(content, segments, translations)

    return {
      ...result,
      applied: segments.filter((segment) => {
        const entry = translations.get(segment.text)
        return Boolean(entry?.approved && !entry.skip && entry.translation)
      }).length,
    }
  }
}

interface FileParserWithPath extends FileParser {
  replaceFile: (
    content: string,
    filePath: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => { content: string, sourceMap?: object }
}

function hasReplaceFile(parser: FileParser): parser is FileParserWithPath {
  return 'replaceFile' in parser && typeof parser.replaceFile === 'function'
}
