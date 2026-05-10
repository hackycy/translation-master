import type { FileParser, TextContext, TextSegment, TranslationEntry } from '../types'
import { parse as babelParse } from '@babel/parser'
import { parse as parseVue } from '@vue/compiler-sfc'
import YAML from 'yaml'
import { hasChinese } from '../utils/chinese-detector'
import { generateId } from '../utils/id-generator'
import { protectPlaceholders } from '../utils/placeholder'

type RangeSegment = Omit<TextSegment, 'id'> & { id?: string }

const MARKDOWN_CODE_FENCE_RE = /```[^`]*(?:`(?!``)[^`]*)*```/g
const STRING_RE = /(["'`])(?:\\.|[^\\])*?\1/g

export class SimpleParser implements FileParser {
  supportedExtensions = ['.vue', '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss', '.less', '.md', '.yaml', '.yml']

  extract(content: string, filePath: string): TextSegment[] {
    const extension = extensionOf(filePath)
    const segments = this.extractByExtension(content, filePath, extension)
    return segments.map((segment) => {
      const protectedText = protectPlaceholders(segment.text)
      return {
        ...segment,
        id: segment.id ?? generateId(segment.text, filePath),
        interpolation: protectedText.placeholders.length
          ? { pattern: 'placeholder', segments: protectedText.placeholders }
          : undefined,
      }
    })
  }

  replace(
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ): { content: string } {
    const replacements = segments
      .map((segment) => {
        const entry = translations.get(segment.text)
        if (!entry?.approved || entry.skip || !entry.translation)
          return undefined
        return {
          start: segment.start,
          end: segment.end,
          text: quoteLike(content.slice(segment.start, segment.end), segment.text, entry.translation),
        }
      })
      .filter((item): item is { start: number, end: number, text: string } => Boolean(item))
      .sort((a, b) => b.start - a.start)

    let next = content
    for (const replacement of replacements)
      next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`

    return { content: next }
  }

  private extractByExtension(content: string, filePath: string, extension: string): RangeSegment[] {
    if (extension === '.vue')
      return extractVue(content, filePath)
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension))
      return extractScript(content, filePath, 'script')
    if (extension === '.json')
      return extractJson(content, filePath)
    if (extension === '.html')
      return extractHtml(content, filePath)
    if (['.css', '.scss', '.less'].includes(extension))
      return extractStyle(content, filePath)
    if (extension === '.md')
      return extractMarkdown(content, filePath)
    if (['.yaml', '.yml'].includes(extension))
      return extractYaml(content, filePath)
    return []
  }
}

export const simpleParser = new SimpleParser()

function extractVue(content: string, filePath: string): RangeSegment[] {
  const { descriptor } = parseVue(content, { sourceMap: true })
  const segments: RangeSegment[] = []

  if (descriptor.template) {
    const offset = descriptor.template.loc.start.offset
    segments.push(...extractHtml(descriptor.template.content, filePath, offset, 'template'))
  }

  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) {
      const offset = block.loc.start.offset
      segments.push(...extractScript(block.content, filePath, 'script', offset))
    }
  }

  for (const style of descriptor.styles) {
    const offset = style.loc.start.offset
    segments.push(...extractStyle(style.content, filePath, offset))
  }

  return segments.map((segment) => {
    const position = lineColumn(content, segment.start)
    return {
      ...segment,
      line: position.line,
      column: position.column,
    }
  })
}

function extractScript(content: string, filePath: string, context: TextContext, offset = 0): RangeSegment[] {
  try {
    babelParse(content, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
      errorRecovery: true,
    })
  }
  catch {
    // Fall back to regex extraction below. Babel is used as a syntax guard when available.
  }

  return extractQuotedStrings(content, filePath, context, 'StringLiteral', offset)
    .filter(segment => !isLikelyObjectKey(content, segment.start - offset, segment.end - offset))
}

function extractJson(content: string, filePath: string): RangeSegment[] {
  try {
    JSON.parse(content)
  }
  catch {
    return []
  }
  return extractQuotedStrings(content, filePath, 'json-value', 'JSONString')
    .filter(segment => !isLikelyJsonKey(content, segment.end))
}

function extractHtml(content: string, filePath: string, offset = 0, textContext: TextContext = 'html-text'): RangeSegment[] {
  return [
    ...extractHtmlText(content, filePath, offset, textContext),
    ...extractHtmlAttrs(content, filePath, offset),
  ]
}

function extractMarkdown(content: string, filePath: string): RangeSegment[] {
  const masked = content.replace(MARKDOWN_CODE_FENCE_RE, match => ' '.repeat(match.length))
  return extractLines(masked, filePath, 'markdown', 'MarkdownText')
    .map(segment => ({ ...segment, text: content.slice(segment.start, segment.end).trim(), start: segment.start + leadingSpaces(content.slice(segment.start, segment.end)) }))
}

function extractYaml(content: string, filePath: string): RangeSegment[] {
  try {
    YAML.parse(content)
  }
  catch {
    return []
  }
  return extractYamlLines(content, filePath)
}

function extractQuotedStrings(
  content: string,
  filePath: string,
  context: TextContext,
  nodeType: string,
  offset = 0,
): RangeSegment[] {
  const segments: RangeSegment[] = []
  for (const match of content.matchAll(STRING_RE)) {
    const quoted = match[0]
    const quote = quoted[0]
    const raw = quoted.slice(1, -1)
    const text = normalizeQuotedText(raw)
    if (!quote || !hasChinese(text))
      continue
    const rawIndex = match.index ?? 0
    const textStart = rawIndex + 1
    const start = offset + textStart
    const end = start + raw.length
    const position = lineColumn(content, textStart)
    segments.push({
      text,
      start,
      end,
      line: position.line,
      column: position.column,
      context,
      nodeType,
    })
  }
  return dedupeSegments(segments, filePath)
}

function extractStyle(content: string, filePath: string, offset = 0): RangeSegment[] {
  return extractQuotedStrings(content, filePath, 'style', 'CSSContent', offset)
    .filter(segment => /content\s*:\s*$/.test(content.slice(Math.max(0, segment.start - offset - 32), segment.start - offset - 1)))
}

function extractHtmlText(content: string, filePath: string, offset: number, context: TextContext): RangeSegment[] {
  const segments: RangeSegment[] = []
  let cursor = 0
  while (cursor < content.length) {
    const startTagEnd = content.indexOf('>', cursor)
    if (startTagEnd === -1)
      break
    const endTagStart = content.indexOf('<', startTagEnd + 1)
    if (endTagStart === -1)
      break
    const raw = content.slice(startTagEnd + 1, endTagStart)
    const trimmed = raw.trim()
    if (hasChinese(trimmed)) {
      const leading = leadingSpaces(raw)
      const textStart = startTagEnd + 1 + leading
      const position = lineColumn(content, textStart)
      segments.push({
        text: trimmed,
        start: offset + textStart,
        end: offset + textStart + trimmed.length,
        line: position.line,
        column: position.column,
        context,
        nodeType: 'Text',
      })
    }
    cursor = endTagStart + 1
  }
  return dedupeSegments(segments, filePath)
}

function extractHtmlAttrs(content: string, filePath: string, offset: number): RangeSegment[] {
  const attrNames = new Set(['title', 'alt', 'placeholder', 'aria-label', 'label'])
  const segments: RangeSegment[] = []
  const attrRe = /\s([\w-]+)=["'][^"']*["']/g
  for (const match of content.matchAll(attrRe)) {
    const name = match[1]
    const rawAttr = match[0]
    if (!name || !attrNames.has(name))
      continue
    const quoteIndex = rawAttr.search(/["']/)
    const raw = rawAttr.slice(quoteIndex + 1, -1)
    if (!hasChinese(raw))
      continue
    const rawIndex = match.index ?? 0
    const textStart = rawIndex + quoteIndex + 1
    const position = lineColumn(content, textStart)
    segments.push({
      text: raw,
      start: offset + textStart,
      end: offset + textStart + raw.length,
      line: position.line,
      column: position.column,
      context: 'html-attr',
      nodeType: 'Attribute',
    })
  }
  return dedupeSegments(segments, filePath)
}

function extractLines(content: string, filePath: string, context: TextContext, nodeType: string): RangeSegment[] {
  const segments: RangeSegment[] = []
  let offset = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (hasChinese(trimmed)) {
      const start = offset + leadingSpaces(line)
      const position = lineColumn(content, start)
      segments.push({
        text: trimmed,
        start,
        end: start + trimmed.length,
        line: position.line,
        column: position.column,
        context,
        nodeType,
      })
    }
    offset += line.length + 1
  }
  return dedupeSegments(segments, filePath)
}

function extractYamlLines(content: string, filePath: string): RangeSegment[] {
  return extractLines(content, filePath, 'yaml-value', 'YAMLScalar')
    .map((segment) => {
      const colonIndex = segment.text.indexOf(':')
      if (colonIndex === -1)
        return segment
      const text = segment.text.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, '')
      const start = segment.start + colonIndex + 1 + leadingSpaces(segment.text.slice(colonIndex + 1))
      return {
        ...segment,
        text,
        start,
        end: start + text.length,
      }
    })
    .filter(segment => hasChinese(segment.text))
}

function lineColumn(content: string, index: number): { line: number, column: number } {
  const lines = content.slice(0, index).split('\n')
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

function quoteLike(original: string, text: string, translation: string): string {
  if (original === text)
    return translation
  return original.replace(text, translation)
}

function normalizeQuotedText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\'/g, '\'').replace(/\\"/g, '"').replace(/\\`/g, '`')
}

function extensionOf(filePath: string): string {
  const parsed = filePath.endsWith('.d.ts') ? '.ts' : filePath.slice(filePath.lastIndexOf('.'))
  return parsed.toLowerCase()
}

function isLikelyObjectKey(content: string, start: number, end: number): boolean {
  const before = content.slice(Math.max(0, start - 24), start)
  const after = content.slice(end, end + 12)
  return /[{,]\s*$/.test(before) && /^\s*:/.test(after)
}

function isLikelyJsonKey(content: string, end: number): boolean {
  return /^\s*:/.test(content.slice(end, end + 12))
}

function leadingSpaces(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0
}

function dedupeSegments(segments: RangeSegment[], filePath: string): RangeSegment[] {
  const seen = new Set<string>()
  return segments.filter((segment) => {
    const key = `${filePath}:${segment.start}:${segment.end}`
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}
