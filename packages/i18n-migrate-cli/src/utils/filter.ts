import type { FilterRule, TextContext } from '../types'
import { hasLocaleText, localeTextLength } from './chinese-detector'

export interface FilterInput {
  text: string
  context: TextContext
  sourceLocale?: string
}

export function shouldTranslate(input: FilterInput, rules: FilterRule[]): boolean {
  const sourceLocale = input.sourceLocale ?? 'zh'
  const visibleText = stripInterpolation(input.text)

  if (!hasLocaleText(visibleText, sourceLocale))
    return false

  for (const rule of rules) {
    if (rule.type === 'force-pattern' && new RegExp(rule.value).test(visibleText))
      return true
  }

  for (const rule of rules) {
    if (rule.type === 'skip-context' && input.context === rule.value)
      return false
    if (rule.type === 'skip-pattern' && shouldApplySkipPattern(rule.value, sourceLocale) && new RegExp(rule.value).test(visibleText))
      return false
    if (rule.type === 'min-length' && localeTextLength(visibleText, sourceLocale) < rule.value)
      return false
    if (rule.type === 'max-length' && localeTextLength(visibleText, sourceLocale) > rule.value)
      return false
  }

  return true
}

function stripInterpolation(text: string): string {
  return text
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\$\{[\s\S]*?\}/g, ' ')
    .replace(/__TM_\d+__/g, ' ')
}

function shouldApplySkipPattern(pattern: string, sourceLocale: string): boolean {
  if (sourceLocale.toLowerCase().startsWith('en') && pattern === '^[a-zA-Z]')
    return false
  return true
}
