import { describe, expect, it } from 'vitest'
import { normalizeChromeTranslatorLanguageCode, normalizeChromeTranslatorLanguagePair, normalizeDownloadProgress, parseChromeMajorVersion } from './index'

describe('chrome translator progress mapping', () => {
  it('normalizes browser and translator download progress values', () => {
    expect(normalizeDownloadProgress(0, 0)).toBe(0)
    expect(normalizeDownloadProgress(0.42, 0)).toBe(42)
    expect(normalizeDownloadProgress(42, 100)).toBe(42)
    expect(normalizeDownloadProgress(101, 100)).toBe(100)
    expect(normalizeDownloadProgress(-5, 100)).toBe(0)
  })

  it('parses Google Chrome major versions', () => {
    expect(parseChromeMajorVersion('Google Chrome 148.0.0.0')).toBe(148)
    expect(parseChromeMajorVersion('Chrome 138.0.7204.49')).toBe(138)
    expect(parseChromeMajorVersion('Google Chrome for Testing 148.0.7778.97')).toBe(148)
    expect(parseChromeMajorVersion('Chromium 148.0.0.0')).toBeUndefined()
  })

  it('normalizes project locale codes to Chrome Translator language codes', () => {
    expect(normalizeChromeTranslatorLanguageCode('zh-TW')).toBe('zh-Hant')
    expect(normalizeChromeTranslatorLanguageCode('zh_HK')).toBe('zh-Hant')
    expect(normalizeChromeTranslatorLanguageCode('zh-CN')).toBe('zh')
    expect(normalizeChromeTranslatorLanguageCode('en-US')).toBe('en')
    expect(normalizeChromeTranslatorLanguageCode('pt-BR')).toBe('pt')
    expect(normalizeChromeTranslatorLanguageCode('he')).toBe('iw')
    expect(normalizeChromeTranslatorLanguageCode('iw')).toBe('iw')
  })

  it('normalizes language pairs before passing them to Chrome', () => {
    expect(normalizeChromeTranslatorLanguagePair('zh-CN', 'zh-TW')).toEqual({
      sourceLanguage: 'zh',
      targetLanguage: 'zh-Hant',
    })
  })

  it('rejects languages that Chrome Translator does not list as supported', () => {
    expect(() => normalizeChromeTranslatorLanguageCode('ms')).toThrow('Chrome Translator API does not support language code "ms"')
    expect(() => normalizeChromeTranslatorLanguageCode('yue')).toThrow('Chrome Translator API does not support language code "yue"')
  })
})
