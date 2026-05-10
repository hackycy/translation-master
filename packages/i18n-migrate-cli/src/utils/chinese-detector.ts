const CHINESE_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
const LATIN_RE = /[a-z]/i

export function hasChinese(text: string): boolean {
  return CHINESE_RE.test(text)
}

export function chineseLength(text: string): number {
  return Array.from(text).filter(char => CHINESE_RE.test(char)).length
}

export function hasLocaleText(text: string, locale: string): boolean {
  if (isChineseLocale(locale))
    return hasChinese(text)
  if (isEnglishLocale(locale))
    return LATIN_RE.test(text)
  return /\p{L}/u.test(text)
}

export function localeTextLength(text: string, locale: string): number {
  if (isChineseLocale(locale))
    return chineseLength(text)
  if (isEnglishLocale(locale))
    return Array.from(text).filter(char => LATIN_RE.test(char)).length
  return Array.from(text).filter(char => /\p{L}/u.test(char)).length
}

function isChineseLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('zh')
}

function isEnglishLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('en')
}
