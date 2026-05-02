import type { ModelConfig, ResolvedModel } from './types'
import { UnsupportedLanguagePairError } from './errors'
import { LANG_TO_FLORES, normalizeLang, toFloresCode } from './lang'

/** Default built-in model configurations */
const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'Xenova/opus-mt-zh-en',
    type: 'opus-mt',
    pairs: [{ from: 'zh', to: 'en' }],
    priority: 1,
  },
  {
    id: 'Xenova/opus-mt-en-zh',
    type: 'opus-mt',
    pairs: [{ from: 'en', to: 'zh' }],
    priority: 1,
  },
  {
    id: 'Xenova/nllb-200-distilled-600M',
    type: 'nllb',
    pairs: [], // Covers all pairs as fallback
    priority: 100,
    requiresLangPrefix: true,
    langCodeMap: LANG_TO_FLORES,
  },
]

export class ModelRouter {
  private configs: ModelConfig[]

  constructor(configs?: ModelConfig[]) {
    this.configs = configs ?? [...DEFAULT_MODELS]
  }

  /**
   * Register a model configuration.
   */
  register(config: ModelConfig): void {
    this.configs.push(config)
    // Sort by priority (lower = higher priority)
    this.configs.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Resolve the best model for a given language pair.
   *
   * Selection logic:
   * 1. Exact match (from, to) on opus-mt → Tier 1
   * 2. Fallback to nllb-200 → Tier 2
   * 3. Neither → throw UnsupportedLanguagePairError
   */
  resolve(from: string, to: string): ResolvedModel {
    const normFrom = normalizeLang(from)
    const normTo = normalizeLang(to)

    // Tier 1: Find exact match on opus-mt (or other small models)
    for (const config of this.configs) {
      if (config.type === 'nllb' || config.type === 'm2m100')
        continue

      const matched = config.pairs.some(
        p => normalizeLang(p.from) === normFrom && normalizeLang(p.to) === normTo,
      )
      if (matched) {
        return { modelId: config.id }
      }
    }

    // Tier 2: Fallback to nllb/m2m100 with FLORES codes
    for (const config of this.configs) {
      if (!config.requiresLangPrefix)
        continue

      const srcFlores = toFloresCode(normFrom)
      const tgtFlores = toFloresCode(normTo)

      if (srcFlores && tgtFlores) {
        return {
          modelId: config.id,
          src_lang: srcFlores,
          tgt_lang: tgtFlores,
          requiresLangPrefix: true,
        }
      }
    }

    throw new UnsupportedLanguagePairError(from, to)
  }

  /**
   * Get all registered model configs.
   */
  getConfigs(): ModelConfig[] {
    return [...this.configs]
  }
}
