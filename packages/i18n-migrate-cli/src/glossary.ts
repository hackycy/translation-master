import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'
import { toPosixPath } from './paths'

export type Glossary = Record<string, string>

const INTERPOLATION_RE = /(\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\})/
const DROPPABLE_SOURCE_WORDS = new Set(['a', 'an', 'the', 'has', 'to', 'of'])

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

    const interpolation = normalizedText.slice(cursor).match(INTERPOLATION_RE)?.[0]
    if (interpolation && normalizedText.startsWith(interpolation, cursor)) {
      chunks.push(interpolation)
      cursor += interpolation.length
      continue
    }

    const punctuation = normalizedText.slice(cursor).match(/^[,.;:!?()[\]{}"'`-]+/)?.[0]
    if (punctuation) {
      chunks.push(punctuation)
      cursor += punctuation.length
      continue
    }

    const term = findMatchingTerm(normalizedText, cursor, terms)
    if (term) {
      chunks.push(term.translation)
      cursor += term.length
      continue
    }

    const word = normalizedText.slice(cursor).match(/^[a-z]+/i)?.[0]
    if (word && DROPPABLE_SOURCE_WORDS.has(word.toLocaleLowerCase())) {
      cursor += word.length
      continue
    }

    if (!term)
      return undefined
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

function findMatchingTerm(
  text: string,
  start: number,
  terms: Array<{ source: string, translation: string }>,
): { translation: string, length: number } | undefined {
  for (const term of terms) {
    const length = matchTermLength(text, start, term.source)
    if (length)
      return { translation: term.translation, length }
  }
  return undefined
}

function matchTermLength(text: string, start: number, source: string): number | undefined {
  for (const variant of termVariants(source)) {
    if (
      text.slice(start, start + variant.length).toLocaleLowerCase() === variant.toLocaleLowerCase()
      && isWordBoundary(text[start - 1])
      && isWordBoundary(text[start + variant.length])
    ) {
      return variant.length
    }
  }
  return undefined
}

function termVariants(source: string): string[] {
  const variants = [source]
  const plural = pluralizeEnglishTerm(source)
  if (plural && plural !== source)
    variants.push(plural)
  return variants.sort((a, b) => b.length - a.length)
}

function pluralizeEnglishTerm(source: string): string | undefined {
  if (!/^[a-z][a-z\s-]*$/i.test(source))
    return undefined

  const lastWord = source.match(/[a-z]+$/i)?.[0]
  if (!lastWord)
    return undefined

  const plural = lastWord.endsWith('y')
    ? `${lastWord.slice(0, -1)}ies`
    : /(?:[sxz]|ch|sh)$/i.test(lastWord)
      ? `${lastWord}es`
      : `${lastWord}s`

  return `${source.slice(0, -lastWord.length)}${plural}`
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
