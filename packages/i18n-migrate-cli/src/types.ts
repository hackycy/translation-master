export type TranslationSource
  = 'machine' | 'glossary' | 'manual'

export type TextContext
  = | 'template'
    | 'script'
    | 'style'
    | 'json-value'
    | 'html-text'
    | 'html-attr'
    | 'markdown'
    | 'yaml-value'
    | 'console'
    | 'comment'
    | 'enum'
    | 'test'

export interface Location {
  line: number
  column: number
  context: TextContext
}

export interface TextSegment {
  id: string
  text: string
  start: number
  end: number
  line: number
  column: number
  context: TextContext
  interpolation?: {
    pattern: string
    segments: string[]
  }
  nodeType: string
}

export interface TranslationEntry {
  id: string
  translation: string
  translationSource: TranslationSource
  approved: boolean
  skip: boolean
  location?: Location
  deprecated?: boolean
}

export interface MapFile {
  version: 2
  generatedAt: string
  entries: Record<string, TranslationEntry>
}

export interface ScanMetaEntry {
  hash: string
  lastScanned: string
  mapFile: string
}

export interface ScanMeta {
  [filePath: string]: ScanMetaEntry
}

export type FilterRule
  = | { type: 'skip-context', value: TextContext }
    | { type: 'skip-pattern', value: string }
    | { type: 'force-pattern', value: string }
    | { type: 'min-length', value: number }
    | { type: 'max-length', value: number }

export interface TranslatorOptions {
  modelBaseUrl?: string
  apiKey?: string
  timeout: number
  retries: number
  concurrency: number
}

export interface MigrateConfig {
  sourceLocale: string
  targetLocale: string
  include: string[]
  exclude: string[]
  rules: FilterRule[]
  translator: 'local' | 'api'
  translatorOptions: TranslatorOptions
  batchSize: number
}

export interface TranslateOptions {
  sourceLocale: string
  targetLocale: string
  glossary?: Record<string, string>
}

export interface TranslateResult {
  source: string
  translation: string
  translationSource: Extract<TranslationSource, 'glossary' | 'machine'>
  confidence?: number
}

export interface Translator {
  translate: (texts: string[], options: TranslateOptions) => Promise<TranslateResult[]>
}

export interface FileParser {
  supportedExtensions: string[]
  extract: (content: string, filePath: string) => TextSegment[]
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => { content: string, sourceMap?: object }
}
