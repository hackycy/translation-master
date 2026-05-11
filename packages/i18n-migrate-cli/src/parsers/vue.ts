import type { FileParser, TextSegment, TranslationEntry } from '../types'
import type { RangeSegment } from './range'
import { parse as parseVue } from '@vue/compiler-sfc'
import { extractStyleSegments } from './css'
import { extractHtmlAttrSegments } from './html'
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
    const offset = descriptor.template.loc.start.offset
    segments.push(...extractVueTemplateTextSegments(descriptor.template.ast, content, filePath))
    segments.push(...extractHtmlAttrSegments(descriptor.template.content, filePath, offset))
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
