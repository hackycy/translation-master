export interface TranslatorOptions {
  /** Backend device, default 'wasm' */
  device?: 'auto' | 'wasm' | 'webgpu'
  /** Quantization precision, default 'q8' */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4'
  /** Custom model configs, uses built-in list if omitted */
  models?: ModelConfig[]
  /** Max models loaded simultaneously, default 3 */
  maxPoolSize?: number
  /** Auto detect source language, default true */
  autoDetect?: boolean
  /** Custom cache implementation */
  cache?: CacheAdapter
  /** Enable built-in toast progress UI, default true */
  ui?: boolean
  /** Enable debug mode for full result metadata, default false */
  debug?: boolean
  /** @deprecated Use events.on('modelLoad', ...) instead */
  onModelLoadProgress?: (event: ModelLoadProgress) => void
}

export interface TranslateOptions {
  /** Source language, auto-detected if omitted */
  from?: string
  /** Target language (required) */
  to: string
  /** Override default quantization precision */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4'
  /** Abort signal */
  signal?: AbortSignal
}

export interface TranslateResult {
  /** Translated text */
  text: string
  /** Detected source language */
  from: string
  /** Target language */
  to: string
  /** Model ID used */
  model: string
  /** Duration in ms */
  duration: number
  /** Language detection confidence */
  confidence?: number
  /** Whether result was served from cache */
  cached?: boolean
}

export interface TranslateResultMinimal {
  /** Translated text */
  text: string
  /** Detected source language */
  from: string
  /** Target language */
  to: string
}

export interface ModelConfig {
  /** HuggingFace model ID */
  id: string
  /** Model type */
  type: 'opus-mt' | 'nllb' | 'm2m100' | 'custom'
  /** Supported language pairs */
  pairs: Array<{ from: string, to: string }>
  /** Priority, lower value = higher priority */
  priority: number
  /** Whether model requires src_lang/tgt_lang prefix (nllb/m2m100) */
  requiresLangPrefix?: boolean
  /** Custom language code mapping */
  langCodeMap?: Record<string, string>
}

export interface ResolvedModel {
  modelId: string
  src_lang?: string
  tgt_lang?: string
  requiresLangPrefix?: boolean
}

export interface ModelLoadProgress {
  modelId: string
  /** Progress 0-100 */
  progress: number
  /** Loading state */
  state: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  file?: string
}

export interface LanguageInfo {
  code: string
  name: string
  nativeName?: string
}

export interface CacheAdapter {
  get: (key: string) => Promise<ArrayBuffer | null>
  set: (key: string, data: ArrayBuffer) => Promise<void>
  has: (key: string) => Promise<boolean>
  delete: (key: string) => Promise<void>
  clear: () => Promise<void>
}

export interface PoolStats {
  active: number
  loading: number
  maxSize: number
  models: Array<{
    id: string
    refCount: number
    lastAccess: number
  }>
}
