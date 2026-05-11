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

export interface BackupMetaEntry {
  sourcePath: string
  backupPath: string
  backedUpAt: string
  batchId: string
}

export interface BackupMeta {
  version: 1
  backups: Record<string, BackupMetaEntry>
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
  endpoint?: string
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
  ) => { content: string }
}

export interface ScanOptions {
  cwd?: string
  path?: string
  to?: string
  incremental?: boolean
  cleanDeprecated?: boolean
  translator?: Translator
  onProgress?: (event: ScanProgressEvent) => void
}

export interface ScanResult {
  scannedFiles: number
  skippedFiles: number
  extractedTexts: number
  mapFiles: string[]
}

export type ScanProgressEvent
  = | { phase: 'config', message: string }
    | { phase: 'discover', message: string, totalFiles?: number }
    | { phase: 'file', filePath: string, current: number, total: number }
    | { phase: 'model-load', modelId: string, progress: number, state: string, file?: string }
    | { phase: 'translate', filePath: string, completedBatches: number, totalBatches: number, completedTexts: number, totalTexts: number }
    | { phase: 'write', filePath: string, current: number, total: number }
    | { phase: 'done', result: ScanResult }

export interface ApplyOptions {
  cwd?: string
  path?: string
  dryRun?: boolean
  onProgress?: (event: WorkflowProgressEvent) => void
}

export interface FileChange {
  sourcePath: string
  changed: boolean
  applied: number
  diff?: string
}

export interface ApplyResult {
  files: FileChange[]
  dryRun: boolean
}

export interface ApproveOptions {
  cwd?: string
  path?: string
  dryRun?: boolean
  includeSkipped?: boolean
  includeDeprecated?: boolean
  allowEmpty?: boolean
  onProgress?: (event: WorkflowProgressEvent) => void
}

export interface ApproveFileChange {
  sourcePath: string
  mapPath: string
  changed: boolean
  approved: number
  alreadyApproved: number
  skipped: number
  total: number
}

export interface ApproveResult {
  files: ApproveFileChange[]
  dryRun: boolean
}

export interface RestoreOptions {
  cwd?: string
  path?: string
  list?: boolean
  onProgress?: (event: WorkflowProgressEvent) => void
}

export interface RestoreResult {
  restored: string[]
  available: BackupMetaEntry[]
}

export type WorkflowProgressEvent
  = | { phase: 'prepare', message: string }
    | { phase: 'discover', message: string, total?: number }
    | { phase: 'file', path: string, current: number, total: number, action: 'approve' | 'apply' | 'restore', dryRun?: boolean }
    | { phase: 'write', path: string, current: number, total: number, action: 'approve' | 'apply' | 'restore' }
    | { phase: 'done', message: string }
