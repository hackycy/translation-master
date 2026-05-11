import type { FileParser, TextContext, TextSegment, TranslationEntry } from '../types'
import type { RangeSegment } from './range'
import { dedupeSegments, finalizeSegments, leadingSpaces, lineColumn, replaceTranslations } from './range'

export const htmlParser: FileParser = {
  supportedExtensions: ['.html'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractHtmlSegments(content, filePath), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractHtmlSegments(content: string, filePath: string, offset = 0, textContext: TextContext = 'html-text'): RangeSegment[] {
  return [
    ...extractHtmlText(content, filePath, offset, textContext),
    ...extractHtmlAttrs(content, filePath, offset),
  ]
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
    segments.push(...extractTextParts(content, raw, startTagEnd + 1, offset, context))
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
    if (!raw.trim())
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

function extractTextParts(content: string, raw: string, rawStart: number, offset: number, context: TextContext): RangeSegment[] {
  if (hasInterpolation(raw))
    return createTextPartSegments(content, raw, rawStart, offset, context)

  const segments: RangeSegment[] = []
  const interpolationRe = /\{\{[\s\S]*?\}\}/g
  let cursor = 0

  for (const match of raw.matchAll(interpolationRe)) {
    const index = match.index ?? 0
    segments.push(...createTextPartSegments(content, raw.slice(cursor, index), rawStart + cursor, offset, context))
    cursor = index + match[0].length
  }

  segments.push(...createTextPartSegments(content, raw.slice(cursor), rawStart + cursor, offset, context))
  return segments
}

function hasInterpolation(text: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(text)
}

function createTextPartSegments(content: string, textPart: string, partStart: number, offset: number, context: TextContext): RangeSegment[] {
  const trimmed = textPart.trim()
  if (!trimmed)
    return []

  const leading = leadingSpaces(textPart)
  const textStart = partStart + leading
  const position = lineColumn(content, textStart)
  return [{
    text: trimmed,
    start: offset + textStart,
    end: offset + textStart + trimmed.length,
    line: position.line,
    column: position.column,
    context,
    nodeType: 'Text',
  }]
}
