const CHINESE_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

export function hasChinese(text: string): boolean {
  return CHINESE_RE.test(text)
}

export function chineseLength(text: string): number {
  return Array.from(text).filter(char => CHINESE_RE.test(char)).length
}
