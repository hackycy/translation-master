export { adaptContent, adaptSources } from './adapt'
export { applyTranslations, restoreBackups } from './apply'
export { approveTranslations } from './approve'
export { backupFile, listBackupEntries, loadBackupMeta, saveBackupMeta } from './backup'
export { loadScanMeta, saveScanMeta } from './cache'
export { createCli } from './cli'
export { DEFAULT_CONFIG, defineConfig, loadConfig } from './config'
export { convertMaps } from './converter'
export { Extractor } from './extractor'
export { composeGlossaryTranslation, enforceGlossaryTerms, initGlossary, loadGlossary, matchGlossary } from './glossary'
export type { Glossary, GlossaryPresetName, InitGlossaryOptions, InitGlossaryResult } from './glossary'
export { initProject } from './init'
export { assignEntryKeys, keyCandidatesForText, keyHash, messageWithNamedParams, normalizeKey, paramNameForExpression } from './keygen'
export { findMapPaths } from './map-paths'
export { createEntry, createMapFile, mergeMapEntries, readMapFile, writeMapFile } from './mapping'
export { CompositeParser, createDefaultParser } from './parsers/parser'
export { mapPathToSourcePath, sourcePathToMapPath, toPosixPath } from './paths'
export { confirmOverwriteTmigrate, createSpinner, promptInitConfig } from './prompts'
export { Replacer } from './replacer'
export { createUnifiedDiff } from './reporter'
export { scanProject } from './scanner'
export { collectMapStats, formatMapStatsReport } from './stats'
export { createTranslator } from './translator'
export { ApiTranslator } from './translator/api'
export type { TranslateOptions as CliTranslateOptions, TranslateResult as CliTranslateResult, Translator as CliTranslator } from './translator/interface'
export { LocalTranslator } from './translator/local'
export { OnnxTranslator } from './translator/onnx'
export { translateTexts } from './translator/pipeline'
export type {
  AdaptFileChange,
  AdaptOptions,
  AdaptResult,
  AdaptSkip,
  ApplyOptions,
  ApplyResult,
  ApproveFileChange,
  ApproveOptions,
  ApproveResult,
  BackupMeta,
  BackupMetaEntry,
  ConvertConfig,
  ConvertFileChange,
  ConvertOptions,
  ConvertResult,
  FileChange,
  FileParser,
  FilterRule,
  Location,
  MapFile,
  MapStatsBucket,
  MapStatsFile,
  MapStatsInvalidFile,
  MapStatsReport,
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
