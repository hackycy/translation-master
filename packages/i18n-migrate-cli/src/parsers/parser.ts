import type { FileParser, TextSegment, TranslationEntry } from '../types'
import { cssParser } from './css'
import { htmlParser } from './html'
import { jsonParser } from './json'
import { markdownParser } from './markdown'
import { scriptParser } from './script'
import { vueParser } from './vue'
import { yamlParser } from './yaml'

export type { FileParser }

export class CompositeParser implements FileParser {
  readonly supportedExtensions: string[]

  constructor(private readonly parsers: FileParser[]) {
    this.supportedExtensions = Array.from(new Set(parsers.flatMap(parser => parser.supportedExtensions)))
  }

  extract(content: string, filePath: string): TextSegment[] {
    return this.getParser(filePath)?.extract(content, filePath) ?? []
  }

  replace(
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ): { content: string } {
    return this.parsers[0]?.replace(content, segments, translations) ?? { content }
  }

  replaceFile(
    content: string,
    filePath: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ): { content: string } {
    return this.getParser(filePath)?.replace(content, segments, translations) ?? { content }
  }

  private getParser(filePath: string): FileParser | undefined {
    const extension = extensionOf(filePath)
    return this.parsers.find(parser => parser.supportedExtensions.includes(extension))
  }
}

export function createDefaultParser(): CompositeParser {
  return new CompositeParser([
    vueParser,
    scriptParser,
    jsonParser,
    htmlParser,
    cssParser,
    markdownParser,
    yamlParser,
  ])
}

function extensionOf(filePath: string): string {
  if (filePath.endsWith('.d.ts'))
    return '.ts'
  return filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
}
