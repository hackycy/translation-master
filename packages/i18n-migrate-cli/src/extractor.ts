import type { FileParser, MigrateConfig, TextSegment } from './types'
import path from 'node:path'
import { createDefaultParser } from './parsers/parser'
import { shouldTranslate } from './utils/filter'

export class Extractor {
  constructor(
    private readonly config: MigrateConfig,
    private readonly parser: FileParser = createDefaultParser(),
  ) {}

  extract(content: string, filePath: string): TextSegment[] {
    const extension = path.extname(filePath).toLowerCase()
    if (!this.parser.supportedExtensions.includes(extension))
      return []

    return this.parser.extract(content, filePath)
      .filter(segment => shouldTranslate({
        text: segment.text,
        context: segment.context,
        sourceLocale: this.config.sourceLocale,
      }, this.config.rules))
  }
}
