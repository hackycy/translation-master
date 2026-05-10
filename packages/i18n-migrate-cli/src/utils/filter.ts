import type { FilterRule, TextContext } from '../types'
import { chineseLength, hasChinese } from './chinese-detector'

export interface FilterInput {
  text: string
  context: TextContext
}

export function shouldTranslate(input: FilterInput, rules: FilterRule[]): boolean {
  if (!hasChinese(input.text))
    return false

  for (const rule of rules) {
    if (rule.type === 'force-pattern' && new RegExp(rule.value).test(input.text))
      return true
  }

  for (const rule of rules) {
    if (rule.type === 'skip-context' && input.context === rule.value)
      return false
    if (rule.type === 'skip-pattern' && new RegExp(rule.value).test(input.text))
      return false
    if (rule.type === 'min-length' && chineseLength(input.text) < rule.value)
      return false
    if (rule.type === 'max-length' && chineseLength(input.text) > rule.value)
      return false
  }

  return true
}
