export type TranslationSource
  = 'machine' | 'glossary' | 'manual'

export type TranslationKeySource
  = 'generated' | 'manual'

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
  translationApproved?: boolean
  key?: string
  keySource?: TranslationKeySource
  keyApproved?: boolean
  keyCandidates?: string[]
  skip: boolean
  location?: Location
  deprecated?: boolean
}

export interface MapFile {
  version: 2
  generatedAt: string
  adapt?: MapAdaptMeta
  entries: Record<string, TranslationEntry>
}

export interface MapAdaptMeta {
  adaptedAt: string
  entryRefs: string[]
  applied: number
  skipped: number
  changed: boolean
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
  chromeBrowserExecutablePath?: string
  chromeBrowserVisible?: boolean
  timeout: number
  retries: number
  concurrency: number
}

export interface GlossaryPresetSourceConfig {
  index: string
}

export type LocalePackageFormat = 'json' | 'js' | 'ts'

export interface ConvertConfig {
  outputDir: string
  format: LocalePackageFormat
  namespace?: string
  sourceLocale?: string
  targetLocale?: string
  includeSourceLocale: boolean
  translateMissing: boolean
  legacyTextKey: boolean
}

export interface AdaptCalleeConfig {
  vue: string
  script: string
  default: string
}

export interface AdaptKeyReferenceConfig {
  mode: 'local' | 'full'
  separator: string
  namespace?: string
}

export interface AdaptRuntimeImportConfig {
  source: string
  named: string
  local?: string
}

export interface AdaptVueRuntimeConfig {
  import: AdaptRuntimeImportConfig
  autoImport: boolean
}

export interface AdaptScriptRuntimeConfig {
  import?: AdaptRuntimeImportConfig
}

export interface AdaptRuntimeConfig {
  vue: AdaptVueRuntimeConfig
  script: AdaptScriptRuntimeConfig
}

export interface AdaptConfig {
  callee: AdaptCalleeConfig
  keyReference: AdaptKeyReferenceConfig
  runtime: AdaptRuntimeConfig
}

export interface MigrateConfig {
  sourceLocale: string
  targetLocale: string
  include: string[]
  exclude: string[]
  rules: FilterRule[]
  translator: 'local' | 'api' | 'chrome'
  translatorOptions: TranslatorOptions
  glossaryPresets?: GlossaryPresetSourceConfig
  convert?: ConvertConfig
  adapt: AdaptConfig
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
  dispose?: () => Promise<void>
  preflight?: (options: TranslateOptions) => Promise<void>
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
    | { phase: 'model-load', modelId: string, progress: number, state: string, file?: string, cacheDir?: string, executablePath?: string, downloadUrl?: string, version?: string }
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

export interface AdaptOptions {
  cwd?: string
  path?: string
  dryRun?: boolean
  all?: boolean
  strategy?: 'ast' | 'range'
  onProgress?: (event: WorkflowProgressEvent) => void
}

export interface AdaptSkip {
  sourcePath: string
  text: string
  key?: string
  reason: string
  suggestion: string
}

export interface AdaptAppliedChange {
  sourcePath: string
  text: string
  key: string
  replacement: string
  line: number
  column: number
  context: TextContext
}

export interface AdaptFileChange extends FileChange {
  changes: AdaptAppliedChange[]
  skipped: AdaptSkip[]
}

export interface AdaptResult {
  files: AdaptFileChange[]
  dryRun: boolean
  skipped: AdaptSkip[]
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

export interface ConvertOptions {
  cwd?: string
  path?: string
  outputDir?: string
  format?: LocalePackageFormat
  namespace?: string
  sourceLocale?: string
  targetLocale?: string
  includeSourceLocale?: boolean
  translateMissing?: boolean
  legacyTextKey?: boolean
  dryRun?: boolean
  translator?: Translator
  onProgress?: (event: WorkflowProgressEvent) => void
}

export interface ConvertFileChange {
  locale: string
  outputPath: string
  changed: boolean
  entries: number
  sourceMaps: string[]
}

export interface ConvertResult {
  files: ConvertFileChange[]
  dryRun: boolean
  outputDir: string
  format: LocalePackageFormat
}

export interface MapStatsBucket {
  mapFiles: number
  adaptReadyMapFiles: number
  adaptedMapFiles: number
  pendingAdaptMapFiles: number
  entries: number
  readyToApplyEntries: number
  pendingReviewEntries: number
  untranslatedEntries: number
  skippedEntries: number
  deprecatedEntries: number
  translationSourceCounts: Record<TranslationSource, number>
}

export interface MapStatsFile {
  sourcePath: string
  mapPath: string
  sourceExists: boolean
  adaptReady: boolean
  adapted: boolean
  adaptedAt?: string
  totalEntries: number
  readyToApplyEntries: number
  pendingReviewEntries: number
  untranslatedEntries: number
  skippedEntries: number
  deprecatedEntries: number
  translationSourceCounts: Record<TranslationSource, number>
}

export interface MapStatsInvalidFile {
  mapPath: string
  sourcePath: string
  error: string
}

export interface MapStatsReport {
  discoveredMapFiles: number
  validMapFiles: number
  current: MapStatsBucket
  orphaned: MapStatsBucket
  invalidFiles: MapStatsInvalidFile[]
  files: MapStatsFile[]
}

export type WorkflowProgressEvent
  = | { phase: 'prepare', message: string }
    | { phase: 'discover', message: string, total?: number }
    | { phase: 'file', path: string, current: number, total: number, action: 'approve' | 'apply' | 'adapt' | 'restore' | 'convert', dryRun?: boolean }
    | { phase: 'write', path: string, current: number, total: number, action: 'approve' | 'apply' | 'adapt' | 'restore' | 'convert' }
    | { phase: 'done', message: string }
