export { DEFAULT_CONFIG, defineConfig } from './config'
export { createEntry, createMapFile, mergeMapEntries } from './mapping'
export { mapPathToSourcePath, sourcePathToMapPath, toPosixPath } from './paths'
export type {
  FileParser,
  FilterRule,
  Location,
  MapFile,
  MigrateConfig,
  ScanMeta,
  ScanMetaEntry,
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
