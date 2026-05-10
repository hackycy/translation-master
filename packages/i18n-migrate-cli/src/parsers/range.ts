import type { TextContext, TextSegment, TranslationEntry } from '../types'
import { generateId } from '../utils/id-generator'
import { protectPlaceholders } from '../utils/placeholder'

export type RangeSegment = Omit<TextSegment, 'id'> & { id?: string }

const STRING_RE = /(["'`])(?:\\.|[^\\])*?\1/g

export function finalizeSegments(segments: RangeSegment[], filePath: string): TextSegment[] {
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

export function replaceTranslations(
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

export function extractQuotedStrings(
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
    if (!quote || !text.trim())
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

export function extractLines(content: string, filePath: string, context: TextContext, nodeType: string): RangeSegment[] {
  const segments: RangeSegment[] = []
  let offset = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed) {
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

export function lineColumn(content: string, index: number): { line: number, column: number } {
  const lines = content.slice(0, index).split('\n')
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

export function leadingSpaces(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0
}

export function dedupeSegments(segments: RangeSegment[], filePath: string): RangeSegment[] {
  const seen = new Set<string>()
  return segments.filter((segment) => {
    const key = `${filePath}:${segment.start}:${segment.end}`
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

function quoteLike(original: string, text: string, translation: string): string {
  if (original === text)
    return translation
  return original.replace(text, translation)
}

function normalizeQuotedText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\'/g, '\'').replace(/\\"/g, '"').replace(/\\`/g, '`')
}
