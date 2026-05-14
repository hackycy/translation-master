import type { FileParser, TextSegment, TranslationEntry } from '../types'
import type { RangeSegment } from './range'
import { parse as parseVue } from '@vue/compiler-sfc'
import { extractStyleSegments } from './css'
import { dedupeSegments, finalizeSegments, leadingSpaces, lineColumn, replaceTranslations } from './range'
import { extractScriptSegments } from './script'

export const vueParser: FileParser = {
  supportedExtensions: ['.vue'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractVueSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractVueSegments(content: string, filePath: string): RangeSegment[] {
  const { descriptor } = parseVue(content, { sourceMap: true })
  const segments: RangeSegment[] = []

  if (descriptor.template) {
    segments.push(...extractVueTemplateTextSegments(descriptor.template.ast, content, filePath))
    segments.push(...extractVueTemplateAttrSegments(descriptor.template.ast, content, filePath))
    segments.push(...extractVueTemplateExpressionSegments(descriptor.template.ast, content, filePath))
  }

  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) {
      const offset = block.loc.start.offset
      segments.push(...extractScriptSegments(block.content, scriptBlockPath(filePath, block.lang), 'script', offset))
    }
  }

  for (const style of descriptor.styles) {
    const offset = style.loc.start.offset
    segments.push(...extractStyleSegments(style.content, filePath, offset))
  }

  return segments.sort((left, right) => left.start - right.start).map((segment) => {
    const position = lineColumn(content, segment.start)
    return {
      ...segment,
      line: position.line,
      column: position.column,
    }
  })
}

function scriptBlockPath(filePath: string, lang?: string): string {
  if (lang === 'tsx')
    return `${filePath}.tsx`
  if (lang === 'jsx')
    return `${filePath}.jsx`
  return filePath
}

interface VueTemplateNode {
  type: number | string
  loc?: {
    start: { offset: number }
    end: { offset: number }
    source: string
  }
  children?: unknown[]
  props?: unknown[]
}

interface VueTemplateAttr {
  type: number
  name?: string
  exp?: {
    content?: string
    loc?: {
      start: { offset: number }
      end: { offset: number }
      source: string
    }
  }
  value?: {
    content?: string
    loc?: {
      start: { offset: number }
      end: { offset: number }
      source: string
    }
  }
}

function extractVueTemplateExpressionSegments(ast: unknown, content: string, filePath: string): RangeSegment[] {
  const segments: RangeSegment[] = []

  collectVueTemplateExpressionSegments(ast, content, filePath, segments)
  return dedupeSegments(segments, filePath)
}

function collectVueTemplateExpressionSegments(
  node: unknown,
  content: string,
  filePath: string,
  segments: RangeSegment[],
): void {
  if (!isVueTemplateNode(node))
    return

  for (const prop of node.props ?? []) {
    if (!isVueDirective(prop) || !prop.exp?.content || !prop.exp.loc)
      continue

    const quotedLiteral = vueDirectiveQuotedLiteralSegment(prop.exp.content, prop.exp.loc.start.offset, content)
    if (quotedLiteral)
      segments.push(quotedLiteral)

    segments.push(...extractScriptSegments(prop.exp.content, scriptBlockPath(filePath, 'ts'), 'template', prop.exp.loc.start.offset)
      .map(segment => ({
        ...segment,
        nodeType: `VueDirective${segment.nodeType}`,
      })))
  }

  for (const child of node.children ?? [])
    collectVueTemplateExpressionSegments(child, content, filePath, segments)
}

function vueDirectiveQuotedLiteralSegment(expression: string, offset: number, content: string): RangeSegment | undefined {
  const quote = expression[0]
  if (!quote || (quote !== '\'' && quote !== '"') || expression.at(-1) !== quote)
    return undefined

  const text = normalizeQuotedText(expression.slice(1, -1))
  if (!text.trim())
    return undefined

  const start = offset + 1
  const position = lineColumn(content, start)
  return {
    text,
    start,
    end: start + expression.length - 2,
    line: position.line,
    column: position.column,
    context: 'template',
    nodeType: 'VueDirectiveStringLiteral',
  }
}

function extractVueTemplateAttrSegments(ast: unknown, content: string, filePath: string): RangeSegment[] {
  const segments: RangeSegment[] = []

  collectVueTemplateAttrSegments(ast, content, segments)
  return dedupeSegments(segments, filePath)
}

function collectVueTemplateAttrSegments(
  node: unknown,
  content: string,
  segments: RangeSegment[],
): void {
  if (!isVueTemplateNode(node))
    return

  for (const prop of node.props ?? []) {
    if (!isVueStaticAttr(prop) || !prop.name || shouldSkipVueStaticAttr(prop.name) || !prop.value?.content || !prop.value.loc)
      continue

    const raw = prop.value.loc.source
    const quoteOffset = isQuoted(raw) ? 1 : 0
    const start = prop.value.loc.start.offset + quoteOffset
    const end = prop.value.loc.end.offset - quoteOffset
    const position = lineColumn(content, start)
    segments.push({
      text: prop.value.content,
      start,
      end,
      line: position.line,
      column: position.column,
      context: 'html-attr',
      nodeType: 'VueStaticAttribute',
    })
  }

  for (const child of node.children ?? [])
    collectVueTemplateAttrSegments(child, content, segments)
}

function extractVueTemplateTextSegments(ast: unknown, content: string, filePath: string): RangeSegment[] {
  const segments: RangeSegment[] = []

  collectVueTemplateTextSegments(ast, content, segments)
  return dedupeSegments(segments, filePath)
}

function collectVueTemplateTextSegments(
  node: unknown,
  content: string,
  segments: RangeSegment[],
): void {
  if (!isVueTemplateNode(node))
    return

  collectVueTemplateChildRuns(node.children ?? [], content, segments)

  for (const child of node.children ?? []) {
    if (isInlineTemplateTextNode(child))
      continue
    collectVueTemplateTextSegments(child, content, segments)
  }
}

function collectVueTemplateChildRuns(
  children: unknown[],
  content: string,
  segments: RangeSegment[],
): void {
  let run: VueTemplateNode[] = []

  for (const child of children) {
    if (isVueTemplateNode(child) && isInlineTemplateTextNode(child)) {
      run.push(child)
      continue
    }

    pushVueTemplateRun(run, content, segments)
    run = []
  }

  pushVueTemplateRun(run, content, segments)
}

function pushVueTemplateRun(
  run: VueTemplateNode[],
  content: string,
  segments: RangeSegment[],
): void {
  if (!run.length || !run.some(node => node.type === 2 && node.loc?.source.trim()))
    return

  const first = run[0]?.loc
  const last = run.at(-1)?.loc
  if (!first || !last)
    return

  const rawStart = first.start.offset
  const rawEnd = last.end.offset
  const raw = content.slice(rawStart, rawEnd)
  const trimmed = raw.trim()
  if (!trimmed)
    return

  const leading = leadingSpaces(raw)
  const start = rawStart + leading
  const position = lineColumn(content, start)
  segments.push({
    text: trimmed,
    start,
    end: start + trimmed.length,
    line: position.line,
    column: position.column,
    context: 'template',
    nodeType: 'VueTemplateText',
  })
}

function isInlineTemplateTextNode(node: unknown): node is VueTemplateNode {
  return isVueTemplateNode(node) && (node.type === 2 || node.type === 5)
}

function isVueTemplateNode(value: unknown): value is VueTemplateNode {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

function isVueStaticAttr(value: unknown): value is VueTemplateAttr {
  return Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 6)
}

function isVueDirective(value: unknown): value is VueTemplateAttr {
  return Boolean(value && typeof value === 'object' && (value as { type?: unknown }).type === 7)
}

function isQuoted(value: string): boolean {
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))
}

function normalizeQuotedText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\'/g, '\'').replace(/\\"/g, '"')
}

function shouldSkipVueStaticAttr(name: string): boolean {
  return name === 'class'
    || name === 'style'
    || name === 'id'
    || name === 'key'
    || name === 'ref'
    || name.startsWith('data-')
    || name.startsWith('aria-')
}
