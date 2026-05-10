export { applyTranslations, restoreBackups } from './apply'
export { backupFile, listBackupEntries, loadBackupMeta, saveBackupMeta } from './backup'
export { loadScanMeta, saveScanMeta } from './cache'
export { createCli } from './cli'
export { DEFAULT_CONFIG, defineConfig, loadConfig } from './config'
export { Extractor } from './extractor'
export { loadGlossary, matchGlossary } from './glossary'
export { initProject } from './init'
export { createEntry, createMapFile, mergeMapEntries, readMapFile, writeMapFile } from './mapping'
export { CompositeParser, createDefaultParser } from './parsers/parser'
export { mapPathToSourcePath, sourcePathToMapPath, toPosixPath } from './paths'
export { confirmOverwriteTmigrate, createSpinner, promptInitConfig } from './prompts'
export { Replacer } from './replacer'
export { createUnifiedDiff } from './reporter'
export { scanProject } from './scanner'
export { createTranslator } from './translator'
export { ApiTranslator } from './translator/api'
export type { TranslateOptions as CliTranslateOptions, TranslateResult as CliTranslateResult, Translator as CliTranslator } from './translator/interface'
export { LocalTranslator } from './translator/local'
export { OnnxTranslator } from './translator/onnx'
export { translateTexts } from './translator/pipeline'
export type {
  ApplyOptions,
  ApplyResult,
  BackupMeta,
  BackupMetaEntry,
  FileChange,
  FileParser,
  FilterRule,
  Location,
  MapFile,
  MigrateConfig,
  RestoreOptions,
  RestoreResult,
  ScanMeta,
  ScanMetaEntry,
  ScanOptions,
  ScanResult,
  TextContext,
  TextSegment,
  TranslateOptions,
  TranslateResult,
  TranslationEntry,
  TranslationSource,
  Translator,
  TranslatorOptions,
} from './types'
export { chineseLength, hasChinese } from './utils/chinese-detector'
export { shouldTranslate } from './utils/filter'
export { isFuzzyMatch, lcsLength, similarity } from './utils/fuzzy-match'
export { generateId } from './utils/id-generator'
export { protectPlaceholders, restorePlaceholders } from './utils/placeholder'
