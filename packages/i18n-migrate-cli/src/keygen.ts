import type { TranslationEntry } from './types'
import { createHash } from 'node:crypto'
import { protectPlaceholders } from './utils/placeholder'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'please',
  'the',
  'to',
  'with',
  'your',
])

const GLOSSARY_KEY_OVERRIDES: Record<string, string> = {
  取消: 'cancel',
  删除: 'delete',
  导出: 'export',
  订单: 'order',
  详情: 'details',
  登录: 'login',
  提交: 'submit',
  保存: 'save',
  设置: 'settings',
  搜索: 'search',
  用户名: 'username',
}

const PINYIN_KEY_OVERRIDES: Record<string, string> = {
  异常提醒: 'errorAlert',
  保存设置: 'saveSettings',
  导出报表: 'exportReports',
  订单详情: 'orderDetails',
  请输入用户名: 'enterUsername',
  消费记录: 'consumptionRecords',
  账号安全: 'accountSecurity',
  总条记录: 'totalRecords',
  最大上传张图片: 'maxUploadImages',
}

export interface KeyCandidateOptions {
  sourceText: string
  translation?: string
  glossary?: Record<string, string>
}

export interface AssignEntryKeysOptions {
  sourcePath: string
  entries: Record<string, TranslationEntry>
  glossary?: Record<string, string>
}

export function assignEntryKeys(options: AssignEntryKeysOptions): Record<string, TranslationEntry> {
  const usedKeys = new Map<string, string>()
  const nextEntries: Record<string, TranslationEntry> = {}

  for (const [sourceText, entry] of Object.entries(options.entries)) {
    const candidates = keyCandidatesForText({
      sourceText,
      translation: entry.translation,
      glossary: options.glossary,
    })
    const existingKey = normalizeKey(entry.key)
    const baseKey = existingKey ?? candidates[0] ?? fallbackKey(sourceText)
    const uniqueKey = ensureUniqueKey(baseKey, sourceText, usedKeys)
    const keyChanged = existingKey !== uniqueKey

    nextEntries[sourceText] = {
      ...entry,
      key: uniqueKey,
      keySource: existingKey && entry.keySource === 'manual' ? 'manual' : 'generated',
      keyApproved: entry.keyApproved ?? entry.approved,
      keyCandidates: uniqueCandidates([uniqueKey, ...candidates]),
      approved: isTranslationApproved(entry) && (entry.keyApproved ?? entry.approved) && !keyChanged,
    }
  }

  return nextEntries
}

export function keyCandidatesForText(options: KeyCandidateOptions): string[] {
  const candidates = [
    glossaryCandidate(options.sourceText, options.glossary),
    chineseCandidate(options.sourceText),
    semanticCandidate(options.translation),
    semanticCandidate(options.sourceText),
  ]
  return uniqueCandidates(candidates.filter((candidate): candidate is string => Boolean(candidate)))
}

export function normalizeKey(value: string | undefined): string | undefined {
  if (!value)
    return undefined

  const words = extractWords(value)
  if (!words.length)
    return undefined

  return toCamelCase(words)
}

export function messageWithNamedParams(text: string): string {
  return text.replace(/\{\{\s*([a-z_$][\w$]*(?:\.[a-z_$][\w$]*|\[[^\]]+\])*)\s*\}\}/gi, (_match, expression: string) => `{${paramNameForExpression(expression)}}`)
    .replace(/\$\{\s*([a-z_$][\w$]*(?:\.[a-z_$][\w$]*|\[[^\]]+\])*)\s*\}/gi, (_match, expression: string) => `{${paramNameForExpression(expression)}}`)
}

export function paramNameForExpression(expression: string): string {
  const trimmed = expression.trim()
  const words = extractWords(trimmed.replace(/\[['"]?([^'"\]]+)['"]?\]/g, ' $1 '))
    .map(word => word.replace(/^\$+/, ''))
    .filter(Boolean)

  return words.length ? toCamelCase(words) : 'value'
}

export function keyHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

function glossaryCandidate(sourceText: string, glossary: Record<string, string> | undefined): string | undefined {
  const glossaryValue = glossary?.[sourceText]
  return semanticCandidate(glossaryValue)
}

function semanticCandidate(text: string | undefined): string | undefined {
  if (!text)
    return undefined

  const protectedText = protectPlaceholders(text)
  const words = extractWords(protectedText.text)
    .filter(word => !STOP_WORDS.has(word.toLowerCase()))
    .filter(word => !/^_*tm_*\d+_*$/i.test(word))

  return words.length ? toCamelCase(words) : undefined
}

function chineseCandidate(sourceText: string): string | undefined {
  const compact = sourceText
    .replace(/\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\}/g, '')
    .replace(/[^\u4E00-\u9FFF]/g, '')

  if (!compact)
    return undefined

  const exact = PINYIN_KEY_OVERRIDES[compact]
  if (exact)
    return exact

  const terms = Object.entries(GLOSSARY_KEY_OVERRIDES)
    .filter(([term]) => compact.includes(term))
    .map(([, key]) => key)

  return terms.length ? toCamelCase(terms) : undefined
}

function extractWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[^\w$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function toCamelCase(words: string[]): string {
  const normalized = words
    .map(word => word.replace(/^[_$]+|[_$]+$/g, ''))
    .filter(Boolean)
    .map(word => word.toLowerCase())

  if (!normalized.length)
    return ''

  const [first, ...rest] = normalized
  return [
    first,
    ...rest.map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`),
  ].join('')
}

function ensureUniqueKey(key: string, sourceText: string, usedKeys: Map<string, string>): string {
  const previousText = usedKeys.get(key)
  if (!previousText || previousText === sourceText) {
    usedKeys.set(key, sourceText)
    return key
  }

  const nextKey = `${key}_${keyHash(sourceText)}`
  usedKeys.set(nextKey, sourceText)
  return nextKey
}

function fallbackKey(sourceText: string): string {
  return `message_${keyHash(sourceText)}`
}

function uniqueCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.map(normalizeKey).filter((candidate): candidate is string => Boolean(candidate)))]
}

function isTranslationApproved(entry: TranslationEntry): boolean {
  return entry.translationApproved ?? entry.approved
}
