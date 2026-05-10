import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

export type Glossary = Record<string, string>

export async function loadGlossary(cwd = process.cwd()): Promise<Glossary> {
  return readJsonFile<Glossary>(path.join(cwd, '.tmigrate', 'glossary.json'), {})
}

export function matchGlossary(text: string, glossary: Glossary, filePath?: string): string | undefined {
  const contexts = filePath ? contextCandidates(filePath) : []

  for (const context of contexts) {
    const exact = glossary[`${context}/${text}`]
    if (exact)
      return exact
  }

  const plain = glossary[text]
  if (plain)
    return plain

  for (const context of contexts) {
    const prefix = glossary[`${context}/*`]
    if (prefix)
      return prefix
  }

  return undefined
}

export function composeGlossaryTranslation(text: string, glossary: Glossary, filePath?: string): string | undefined {
  const terms = glossaryTerms(glossary, filePath)
  if (!terms.length)
    return undefined

  const normalizedText = text.trim()
  const chunks: string[] = []
  let cursor = 0

  while (cursor < normalizedText.length) {
    const nextWhitespace = normalizedText.slice(cursor).match(/^\s+/)?.[0]
    if (nextWhitespace) {
      cursor += nextWhitespace.length
      continue
    }

    const punctuation = normalizedText.slice(cursor).match(/^[,.;:!?()[\]{}"'`-]+/)?.[0]
    if (punctuation) {
      chunks.push(punctuation)
      cursor += punctuation.length
      continue
    }

    const term = terms.find(term => matchesAt(normalizedText, cursor, term.source))
    if (!term)
      return undefined

    chunks.push(term.translation)
    cursor += term.source.length
  }

  return joinGlossaryChunks(chunks)
}

function contextCandidates(filePath: string): string[] {
  const parts = toPosixPath(filePath).split('/').filter(Boolean)
  const basename = parts.at(-1)
  const withoutFile = basename && basename.includes('.') ? parts.slice(0, -1) : parts
  const candidates: string[] = []

  for (let index = withoutFile.length; index > 0; index--)
    candidates.push(withoutFile.slice(Math.max(0, index - 2), index).join('/'))

  return Array.from(new Set(candidates.filter(Boolean)))
}

function glossaryTerms(glossary: Glossary, filePath?: string): Array<{ source: string, translation: string }> {
  const contexts = filePath ? contextCandidates(filePath) : []
  const contextPrefixes = new Set(contexts.map(context => `${context}/`))

  return Object.entries(glossary)
    .map(([source, translation]) => ({
      source: stripContextPrefix(source, contextPrefixes),
      translation,
    }))
    .filter(term => term.source && !term.source.endsWith('*'))
    .sort((a, b) => b.source.length - a.source.length)
}

function stripContextPrefix(source: string, contextPrefixes: Set<string>): string {
  for (const prefix of contextPrefixes) {
    if (source.startsWith(prefix))
      return source.slice(prefix.length)
  }
  return source
}

function matchesAt(text: string, start: number, source: string): boolean {
  return text.slice(start, start + source.length).toLocaleLowerCase() === source.toLocaleLowerCase()
    && isWordBoundary(text[start - 1])
    && isWordBoundary(text[start + source.length])
}

function isWordBoundary(char: string | undefined): boolean {
  return !char || !/[a-z0-9]/i.test(char)
}

function joinGlossaryChunks(chunks: string[]): string {
  return chunks.reduce((result, chunk) => {
    if (!result)
      return chunk
    if (isPunctuation(chunk))
      return `${result}${chunk}`
    if (hasCjk(result) || hasCjk(chunk))
      return `${result}${chunk}`
    return `${result} ${chunk}`
  }, '')
}

function isPunctuation(text: string): boolean {
  return /^[,.;:!?()[\]{}"'`-]+$/.test(text)
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text)
}
