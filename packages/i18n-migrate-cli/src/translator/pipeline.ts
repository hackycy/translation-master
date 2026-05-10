import type { Glossary } from '../glossary'
import type { MigrateConfig, TranslateResult, Translator } from '../types'
import { composeGlossaryTranslation, matchGlossary } from '../glossary'
import { protectPlaceholders, restorePlaceholders } from '../utils/placeholder'

export interface TranslatePipelineInput {
  texts: string[]
  filePath?: string
  config: MigrateConfig
  glossary: Glossary
  translator: Translator
}

export async function translateTexts(input: TranslatePipelineInput): Promise<Record<string, TranslateResult>> {
  const uniqueTexts = Array.from(new Set(input.texts))
  const results: Record<string, TranslateResult> = {}
  const machineTexts: string[] = []

  for (const text of uniqueTexts) {
    const glossaryTranslation = matchGlossary(text, input.glossary, input.filePath)
      ?? composeGlossaryTranslation(text, input.glossary, input.filePath)
    if (glossaryTranslation) {
      results[text] = {
        source: text,
        translation: glossaryTranslation,
        translationSource: 'glossary',
        confidence: 1,
      }
    }
    else {
      machineTexts.push(text)
    }
  }

  const batches = chunk(machineTexts, input.config.batchSize)
  await runConcurrent(batches, input.config.translatorOptions.concurrency, async (batch) => {
    const protectedBatch = batch.map(text => protectPlaceholders(text))
    const translated = await retry(
      () => input.translator.translate(
        protectedBatch.map(item => item.text),
        {
          sourceLocale: input.config.sourceLocale,
          targetLocale: input.config.targetLocale,
          glossary: input.glossary,
        },
      ),
      input.config.translatorOptions.retries,
    )

    translated.forEach((result, index) => {
      const source = batch[index]
      const protectedText = protectedBatch[index]
      if (!source || !protectedText)
        return
      results[source] = {
        source,
        translation: restorePlaceholders(result.translation, protectedText.placeholders),
        translationSource: 'machine',
        confidence: result.confidence,
      }
    })
  })

  return results
}

function chunk<T>(items: T[], size: number): T[][] {
  const batchSize = Math.max(1, size)
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += batchSize)
    chunks.push(items.slice(index, index + batchSize))
  return chunks
}

async function runConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const workers = Array.from({ length: Math.max(1, concurrency) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += Math.max(1, concurrency))
      await worker(items[index] as T)
  })
  await Promise.all(workers)
}

async function retry<T>(task: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task()
    }
    catch (error) {
      lastError = error
    }
  }
  throw lastError
}
