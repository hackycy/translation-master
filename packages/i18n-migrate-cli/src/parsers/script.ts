import type { FileParser, TextContext, TextSegment, TranslationEntry } from '../types'
import { parse as babelParse } from '@babel/parser'
import { dedupeSegments, finalizeSegments, leadingSpaces, lineColumn, replaceTranslations } from './range'

export const scriptParser: FileParser = {
  supportedExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  extract: (content: string, filePath: string): TextSegment[] => finalizeSegments(extractScriptSegments(content, filePath, 'script'), filePath),
  replace: (
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>,
  ) => replaceTranslations(content, segments, translations),
}

export function extractScriptSegments(content: string, filePath: string, context: TextContext, offset = 0) {
  const astSegments = extractBabelStringSegments(content, filePath, context, offset)
  if (astSegments.length)
    return astSegments

  return []
}

interface BabelNode {
  type: string
  start?: number | null
  end?: number | null
  value?: unknown
  extra?: { raw?: string }
  key?: BabelNode
  source?: BabelNode
  callee?: BabelNode
  computed?: boolean
}

function extractBabelStringSegments(content: string, filePath: string, context: TextContext, offset: number) {
  try {
    const ast = babelParse(content, {
      sourceType: 'unambiguous',
      plugins: parserPlugins(filePath),
      errorRecovery: true,
    })
    const segments = collectStringSegments(ast as unknown as BabelNode, content, context, offset)
    return dedupeSegments(segments, filePath)
  }
  catch {
    return []
  }
}

function parserPlugins(filePath: string): Array<'typescript' | 'jsx' | 'decorators-legacy'> {
  const lower = filePath.toLowerCase()
  const plugins: Array<'typescript' | 'jsx' | 'decorators-legacy'> = ['typescript', 'decorators-legacy']
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx'))
    plugins.splice(1, 0, 'jsx')
  return plugins
}

function collectStringSegments(root: BabelNode, content: string, context: TextContext, offset: number) {
  const segments: Array<Omit<TextSegment, 'id'>> = []
  const seen = new Set<BabelNode>()

  function visit(node: unknown, parent?: BabelNode) {
    if (!isBabelNode(node) || seen.has(node))
      return
    seen.add(node)

    if (node.type === 'StringLiteral' && shouldExtractStringLiteral(node, parent)) {
      const segment = createStringLiteralSegment(node, content, context, offset, parent?.type === 'JSXAttribute' ? 'JSXStringLiteral' : 'StringLiteral')
      if (segment)
        segments.push(segment)
    }
    else if (node.type === 'JSXText') {
      const segment = createJsxTextSegment(node, content, context, offset)
      if (segment)
        segments.push(segment)
    }
    else if (node.type === 'TemplateElement') {
      const segment = createTemplateElementSegment(node, content, context, offset)
      if (segment)
        segments.push(segment)
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end')
        continue
      if (Array.isArray(value)) {
        for (const child of value)
          visit(child, node)
      }
      else if (isBabelNode(value)) {
        visit(value, node)
      }
    }
  }

  visit(root)
  return segments
}

function createStringLiteralSegment(
  node: BabelNode,
  content: string,
  context: TextContext,
  offset: number,
  nodeType: string,
): Omit<TextSegment, 'id'> | undefined {
  if (typeof node.start !== 'number' || typeof node.end !== 'number' || typeof node.value !== 'string')
    return undefined

  const raw = node.extra?.raw ?? content.slice(node.start, node.end)
  if (!raw || raw.length < 2)
    return undefined

  if (isCodeLikeScriptText(raw.slice(1, -1), node.value))
    return undefined

  const start = node.start + 1
  const end = node.end - 1
  if (start > end)
    return undefined

  const position = lineColumn(content, start)
  return {
    text: node.value,
    start: offset + start,
    end: offset + end,
    line: position.line,
    column: position.column,
    context,
    nodeType,
  }
}

function createJsxTextSegment(
  node: BabelNode,
  content: string,
  context: TextContext,
  offset: number,
): Omit<TextSegment, 'id'> | undefined {
  if (typeof node.start !== 'number' || typeof node.end !== 'number' || typeof node.value !== 'string')
    return undefined

  const left = leadingSpaces(node.value)
  const right = node.value.length - node.value.trimEnd().length
  const trimmedLength = node.value.length - left - right
  if (trimmedLength <= 0)
    return undefined

  const text = node.value.trim()
  const start = node.start + left
  const end = node.end - right
  const position = lineColumn(content, start)
  return {
    text,
    start: offset + start,
    end: offset + end,
    line: position.line,
    column: position.column,
    context,
    nodeType: 'JSXText',
  }
}

function createTemplateElementSegment(
  node: BabelNode,
  content: string,
  context: TextContext,
  offset: number,
): Omit<TextSegment, 'id'> | undefined {
  if (typeof node.start !== 'number' || typeof node.end !== 'number')
    return undefined

  const value = node.value
  if (!isTemplateElementValue(value))
    return undefined

  const raw = value.raw
  const cooked = value.cooked ?? raw
  if (isCodeLikeScriptText(raw, cooked))
    return undefined

  const left = leadingSpaces(raw)
  const right = raw.length - raw.trimEnd().length
  const trimmedRawLength = raw.length - left - right
  if (trimmedRawLength <= 0)
    return undefined

  const start = node.start + left
  const end = node.end - right
  const text = cooked.trim()
  if (!text)
    return undefined

  const position = lineColumn(content, start)
  return {
    text,
    start: offset + start,
    end: offset + end,
    line: position.line,
    column: position.column,
    context,
    nodeType: 'TemplateElement',
  }
}

function shouldExtractStringLiteral(node: BabelNode, parent?: BabelNode): boolean {
  if (!parent)
    return true

  if (parent.key === node && !parent.computed)
    return false

  if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration')
    return parent.source !== node

  if (parent.type === 'CallExpression' && parent.callee?.type === 'Import')
    return false

  if (parent.type === 'Directive' || parent.type === 'DirectiveLiteral')
    return false

  return true
}

function isBabelNode(value: unknown): value is BabelNode {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
}

function isTemplateElementValue(value: unknown): value is { raw: string, cooked?: string | null } {
  return Boolean(value && typeof value === 'object' && typeof (value as { raw?: unknown }).raw === 'string')
}

function isCodeLikeScriptText(raw: string, cooked: string): boolean {
  const text = cooked || raw
  return /<\/?[a-z][\s\S]*>/i.test(raw)
    || /\b(?:const|let|var|function|return|import|export|class|interface|type)\b/.test(text)
    || /=>|;|https?:\/\/|\\\$\{|\{\{|\}\}/.test(raw)
    || /^[\s{[]*["'][\w-]+["']\s*:/.test(raw)
    || /[{}][\s\S]*[;=,]/.test(raw)
}
