import type { LanguageInfo } from './types'

/** User-friendly language code → FLORES-200 language code */
export const LANG_TO_FLORES: Record<string, string> = {
  'zh': 'zho_Hans',
  'zh-CN': 'zho_Hans',
  'zh-TW': 'zho_Hant',
  'zh-HK': 'zho_Hant',
  'yue': 'yue_Hant',
  'en': 'eng_Latn',
  'ja': 'jpn_Jpan',
  'ko': 'kor_Hang',
  'fr': 'fra_Latn',
  'de': 'deu_Latn',
  'es': 'spa_Latn',
  'ru': 'rus_Cyrl',
  'ar': 'arb_Arab',
  'pt': 'por_Latn',
  'it': 'ita_Latn',
  'th': 'tha_Thai',
  'vi': 'vie_Latn',
  'id': 'ind_Latn',
  'ms': 'zsm_Latn',
  'nl': 'nld_Latn',
  'pl': 'pol_Latn',
  'tr': 'tur_Latn',
  'hi': 'hin_Deva',
  'uk': 'ukr_Cyrl',
  'sv': 'swe_Latn',
  'da': 'dan_Latn',
  'fi': 'fin_Latn',
  'no': 'nob_Latn',
  'cs': 'ces_Latn',
  'el': 'ell_Grek',
  'he': 'heb_Hebr',
  'hu': 'hun_Latn',
  'ro': 'ron_Latn',
  'bg': 'bul_Cyrl',
  'hr': 'hrv_Latn',
  'sk': 'slk_Latn',
  'sr': 'srp_Cyrl',
  'ca': 'cat_Latn',
  'et': 'est_Latn',
  'lv': 'lvs_Latn',
  'lt': 'lit_Latn',
  'bn': 'ben_Beng',
  'ta': 'tam_Taml',
  'te': 'tel_Telu',
  'ml': 'mal_Mlym',
  'mr': 'mar_Deva',
  'ur': 'urd_Arab',
  'sw': 'swh_Latn',
}

/** FLORES-200 code → user-friendly code (reverse mapping) */
const FLORES_TO_LANG: Record<string, string> = Object.fromEntries(
  Object.entries(LANG_TO_FLORES).map(([k, v]) => [v, k]),
)

/** Supported languages list */
const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
]

/** Simplified Chinese specific characters */
const SIMPLIFIED_CHARS = new Set(
  '国东车书学门问题说话读写买卖开关进出长短高低大小多少上下左右前后里外早晚远近快慢好坏新旧长短轻重冷热明暗干湿软硬深浅宽窄厚薄粗细快慢强弱难易贵贱',
)

/** Traditional Chinese specific characters */
const TRADITIONAL_CHARS = new Set(
  '國東車書學門問題說話讀寫買賣開關進出長短高低大小多少上下左右前後裡外早晚遠近快慢好壞新舊長短輕重冷熱明暗乾濕軟硬深淺寬窄厚薄粗細快慢強弱難易貴賤',
)

/** Unicode range-based language detection rules */
const UNICODE_RANGES: Array<{ range: [number, number], lang: string }> = [
  { range: [0x4E00, 0x9FFF], lang: 'zh' }, // CJK Unified Ideographs
  { range: [0x3400, 0x4DBF], lang: 'zh' }, // CJK Extension A
  { range: [0x3040, 0x309F], lang: 'ja' }, // Hiragana
  { range: [0x30A0, 0x30FF], lang: 'ja' }, // Katakana
  { range: [0xAC00, 0xD7AF], lang: 'ko' }, // Hangul Syllables
  { range: [0x0400, 0x04FF], lang: 'ru' }, // Cyrillic
  { range: [0x0600, 0x06FF], lang: 'ar' }, // Arabic
  { range: [0x0E00, 0x0E7F], lang: 'th' }, // Thai
  { range: [0x0900, 0x097F], lang: 'hi' }, // Devanagari
  { range: [0x0980, 0x09FF], lang: 'bn' }, // Bengali
  { range: [0x0B80, 0x0BFF], lang: 'ta' }, // Tamil
  { range: [0x0C00, 0x0C7F], lang: 'te' }, // Telugu
  { range: [0x0D00, 0x0D7F], lang: 'ml' }, // Malayalam
  { range: [0x0590, 0x05FF], lang: 'he' }, // Hebrew
  { range: [0x0370, 0x03FF], lang: 'el' }, // Greek
]

/**
 * Convert a user-friendly language code to FLORES-200 code.
 */
export function toFloresCode(lang: string): string | undefined {
  return LANG_TO_FLORES[lang] ?? LANG_TO_FLORES[lang.toLowerCase()]
}

/**
 * Convert a FLORES-200 code back to a user-friendly code.
 */
export function fromFloresCode(flores: string): string | undefined {
  return FLORES_TO_LANG[flores]
}

/**
 * Normalize a language code to a canonical form.
 */
export function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase()
  // Map common aliases
  const aliases: Record<string, string> = {
    'chinese': 'zh',
    'simplified chinese': 'zh',
    'traditional chinese': 'zh-TW',
    'english': 'en',
    'japanese': 'ja',
    'korean': 'ko',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'russian': 'ru',
    'arabic': 'ar',
    'portuguese': 'pt',
    'italian': 'it',
    'thai': 'th',
    'vietnamese': 'vi',
    'indonesian': 'id',
    'malay': 'ms',
  }
  return aliases[lower] ?? lang
}

/**
 * Distinguish between Simplified and Traditional Chinese.
 * Returns 'zh-CN' for Simplified, 'zh-TW' for Traditional.
 */
export function distinguishZhVariant(text: string): 'zh-CN' | 'zh-TW' {
  let simplified = 0
  let traditional = 0
  for (const char of text) {
    if (SIMPLIFIED_CHARS.has(char))
      simplified++
    if (TRADITIONAL_CHARS.has(char))
      traditional++
  }
  return simplified >= traditional ? 'zh-CN' : 'zh-TW'
}

/**
 * Detect language based on Unicode ranges (heuristic, zero-cost).
 * Returns detected language code and confidence.
 */
export function detectLanguage(text: string): { lang: string, confidence: number } {
  if (!text || text.trim().length === 0) {
    return { lang: 'en', confidence: 0 }
  }

  const counts: Record<string, number> = {}
  let totalChars = 0

  for (const char of text) {
    const code = char.codePointAt(0)!
    // Skip whitespace, digits, punctuation, common symbols
    if (code < 0x80 && !/[a-z]/i.test(char))
      continue

    totalChars++

    // Check CJK (needs special handling for zh vs ja)
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // Count as CJK, will refine below
      counts.cjk = (counts.cjk || 0) + 1
      continue
    }

    // Check Hiragana/Katakana (definitive Japanese marker)
    if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
      counts.ja = (counts.ja || 0) + 1
      totalChars++
      continue
    }

    for (const { range, lang } of UNICODE_RANGES) {
      if (code >= range[0] && code <= range[1]) {
        counts[lang] = (counts[lang] || 0) + 1
        break
      }
    }

    // Latin characters
    if (code >= 0x41 && code <= 0x7A) {
      counts.en = (counts.en || 0) + 1
    }
  }

  // Handle CJK characters: if we also see Hiragana/Katakana, it's Japanese
  if (counts.cjk) {
    if (counts.ja) {
      // Has kana → Japanese
      counts.ja += counts.cjk
    }
    else {
      // No kana → Chinese, distinguish variant
      const variant = distinguishZhVariant(text)
      const key = variant === 'zh-CN' ? 'zh' : 'zh-TW'
      counts[key] = (counts[key] || 0) + counts.cjk
    }
    delete counts.cjk
  }

  if (totalChars === 0 || Object.keys(counts).length === 0) {
    return { lang: 'en', confidence: 0.5 }
  }

  // Find the language with the highest count
  let bestLang = 'en'
  let bestCount = 0
  for (const [lang, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count
      bestLang = lang
    }
  }

  const confidence = Math.min(bestCount / totalChars, 1)
  return { lang: bestLang, confidence }
}

/**
 * Get the list of supported languages.
 */
export function getSupportedLanguages(): LanguageInfo[] {
  return [...SUPPORTED_LANGUAGES]
}
