import { describe, expect, it } from 'vitest'
import { ModelRouter } from './model-router'

describe('modelRouter', () => {
  describe('resolve', () => {
    it('resolves zh→en via opus-mt (tier 1)', () => {
      const router = new ModelRouter()
      const result = router.resolve('zh', 'en')
      expect(result.modelId).toBe('Xenova/opus-mt-zh-en')
      expect(result.requiresLangPrefix).toBeUndefined()
    })

    it('resolves en→zh via opus-mt (tier 1)', () => {
      const router = new ModelRouter()
      const result = router.resolve('en', 'zh')
      expect(result.modelId).toBe('Xenova/opus-mt-en-zh')
    })

    it('resolves unsupported pair via nllb fallback (tier 2)', () => {
      const router = new ModelRouter()
      const result = router.resolve('fr', 'de')
      expect(result.modelId).toBe('Xenova/nllb-200-distilled-600M')
      expect(result.requiresLangPrefix).toBe(true)
      expect(result.src_lang).toBe('fra_Latn')
      expect(result.tgt_lang).toBe('deu_Latn')
    })

    it('normalizes language codes before resolving', () => {
      const router = new ModelRouter()
      const result = router.resolve('French', 'German')
      expect(result.modelId).toBe('Xenova/nllb-200-distilled-600M')
      expect(result.src_lang).toBe('fra_Latn')
      expect(result.tgt_lang).toBe('deu_Latn')
    })

    it('throws UnsupportedLanguagePairError for unknown languages', () => {
      const router = new ModelRouter()
      expect(() => router.resolve('xx', 'yy')).toThrow('Unsupported language pair')
    })

    it('prefers opus-mt over nllb when both match', () => {
      const router = new ModelRouter()
      const result = router.resolve('zh', 'en')
      // Should NOT be nllb
      expect(result.modelId).not.toBe('Xenova/nllb-200-distilled-600M')
    })
  })

  describe('register', () => {
    it('adds a new model config', () => {
      const router = new ModelRouter()
      router.register({
        id: 'custom/model',
        type: 'opus-mt',
        pairs: [{ from: 'es', to: 'pt' }],
        priority: 0,
      })
      const result = router.resolve('es', 'pt')
      expect(result.modelId).toBe('custom/model')
    })

    it('higher priority model wins', () => {
      const router = new ModelRouter()
      router.register({
        id: 'high-priority',
        type: 'opus-mt',
        pairs: [{ from: 'zh', to: 'en' }],
        priority: 0, // Lower number = higher priority
      })
      const result = router.resolve('zh', 'en')
      expect(result.modelId).toBe('high-priority')
    })
  })

  describe('getConfigs', () => {
    it('returns a copy of configs', () => {
      const router = new ModelRouter()
      const configs1 = router.getConfigs()
      const configs2 = router.getConfigs()
      expect(configs1).not.toBe(configs2)
      expect(configs1).toEqual(configs2)
    })

    it('returns default configs when none provided', () => {
      const router = new ModelRouter()
      const configs = router.getConfigs()
      expect(configs.length).toBeGreaterThan(0)
    })
  })
})
