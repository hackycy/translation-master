import { describe, expect, it } from 'vitest'
import {
  detectLanguage,
  distinguishZhVariant,
  fromFloresCode,
  getSupportedLanguages,
  LANG_TO_FLORES,
  normalizeLang,
  toFloresCode,
} from './lang'

describe('toFloresCode', () => {
  it('converts simple codes', () => {
    expect(toFloresCode('en')).toBe('eng_Latn')
    expect(toFloresCode('zh')).toBe('zho_Hans')
    expect(toFloresCode('ja')).toBe('jpn_Jpan')
  })

  it('converts region-qualified codes', () => {
    expect(toFloresCode('zh-CN')).toBe('zho_Hans')
    expect(toFloresCode('zh-TW')).toBe('zho_Hant')
  })

  it('returns undefined for unknown codes', () => {
    expect(toFloresCode('xx')).toBeUndefined()
  })

  it('is case-insensitive via toLowerCase fallback', () => {
    expect(toFloresCode('EN')).toBe('eng_Latn')
    expect(toFloresCode('ZH')).toBe('zho_Hans')
  })
})

describe('fromFloresCode', () => {
  it('converts FLORES codes back to user codes', () => {
    expect(fromFloresCode('eng_Latn')).toBe('en')
    expect(fromFloresCode('zho_Hans')).toBe('zh')
  })

  it('returns undefined for unknown FLORES codes', () => {
    expect(fromFloresCode('xxx_Xxxx')).toBeUndefined()
  })
})

describe('normalizeLang', () => {
  it('normalizes English aliases', () => {
    expect(normalizeLang('English')).toBe('en')
    expect(normalizeLang('ENGLISH')).toBe('en')
  })

  it('normalizes Chinese aliases', () => {
    expect(normalizeLang('Chinese')).toBe('zh')
    expect(normalizeLang('Simplified Chinese')).toBe('zh')
    expect(normalizeLang('Traditional Chinese')).toBe('zh-TW')
  })

  it('returns the original code if no alias matches', () => {
    expect(normalizeLang('en')).toBe('en')
    expect(normalizeLang('xyz')).toBe('xyz')
  })

  it('is case-insensitive for aliases', () => {
    expect(normalizeLang('japanese')).toBe('ja')
    expect(normalizeLang('Japanese')).toBe('ja')
    expect(normalizeLang('JAPANESE')).toBe('ja')
  })
})

describe('distinguishZhVariant', () => {
  it('detects Simplified Chinese', () => {
    expect(distinguishZhVariant('国东车书学门')).toBe('zh-CN')
    expect(distinguishZhVariant('这是一个简体中文测试')).toBe('zh-CN')
  })

  it('detects Traditional Chinese', () => {
    // Use text with many exclusively traditional characters from TRADITIONAL_CHARS
    expect(distinguishZhVariant('國東車書學門問題說話讀寫買賣開關')).toBe('zh-TW')
  })

  it('defaults to Simplified when ambiguous', () => {
    // Equal or zero counts → simplified wins (>=)
    expect(distinguishZhVariant('abc')).toBe('zh-CN')
  })
})

describe('detectLanguage', () => {
  it('returns en with confidence 0 for empty text', () => {
    const result = detectLanguage('')
    expect(result.lang).toBe('en')
    expect(result.confidence).toBe(0)
  })

  it('returns en with confidence 0 for whitespace-only text', () => {
    const result = detectLanguage('   ')
    expect(result.lang).toBe('en')
    expect(result.confidence).toBe(0)
  })

  it('detects English (Latin text)', () => {
    const result = detectLanguage('Hello world, this is a test')
    expect(result.lang).toBe('en')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Chinese (CJK characters)', () => {
    const result = detectLanguage('你好世界，这是一个测试')
    expect(result.lang).toBe('zh')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Japanese (with Hiragana)', () => {
    const result = detectLanguage('これはテストです')
    expect(result.lang).toBe('ja')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Japanese (with Katakana)', () => {
    const result = detectLanguage('テストテスト')
    expect(result.lang).toBe('ja')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Japanese (CJK + Hiragana mix)', () => {
    const result = detectLanguage('你好世界です')
    expect(result.lang).toBe('ja')
  })

  it('detects Korean', () => {
    const result = detectLanguage('안녕하세요 세계')
    expect(result.lang).toBe('ko')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Russian (Cyrillic)', () => {
    const result = detectLanguage('Привет мир')
    expect(result.lang).toBe('ru')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Arabic', () => {
    const result = detectLanguage('مرحبا بالعالم')
    expect(result.lang).toBe('ar')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Thai', () => {
    const result = detectLanguage('สวัสดีชาวโลก')
    expect(result.lang).toBe('th')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Hindi (Devanagari)', () => {
    const result = detectLanguage('नमस्ते दुनिया')
    expect(result.lang).toBe('hi')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('confidence is between 0 and 1', () => {
    const result = detectLanguage('Hello world')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

describe('getSupportedLanguages', () => {
  it('returns a non-empty array', () => {
    const langs = getSupportedLanguages()
    expect(langs.length).toBeGreaterThan(0)
  })

  it('returns a copy (not the original array)', () => {
    const langs1 = getSupportedLanguages()
    const langs2 = getSupportedLanguages()
    expect(langs1).not.toBe(langs2)
    expect(langs1).toEqual(langs2)
  })

  it('each language has code and name', () => {
    for (const lang of getSupportedLanguages()) {
      expect(lang.code).toBeTruthy()
      expect(lang.name).toBeTruthy()
    }
  })

  it('includes common languages', () => {
    const codes = getSupportedLanguages().map(l => l.code)
    expect(codes).toContain('en')
    expect(codes).toContain('zh')
    expect(codes).toContain('ja')
    expect(codes).toContain('ko')
    expect(codes).toContain('fr')
    expect(codes).toContain('de')
  })
})

describe('langToFlores mapping', () => {
  it('has entries for all supported language codes', () => {
    const supported = getSupportedLanguages()
    for (const lang of supported) {
      expect(LANG_TO_FLORES[lang.code]).toBeDefined()
    }
  })
})
