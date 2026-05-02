import type { TranslateOptions } from './types'
import { Translator } from './translator'

export interface WorkerMessage {
  type: 'translate' | 'translateBatch' | 'detect' | 'preload' | 'dispose'
  id: string
  payload: unknown
}

export interface WorkerResponse {
  type: 'result' | 'error'
  id: string
  payload: unknown
}

const workerSelf = globalThis as unknown as Worker

let translator: Translator | null = null

function getTranslator(): Translator {
  if (!translator) {
    translator = new Translator()
  }
  return translator
}

workerSelf.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = e.data

  try {
    let result: unknown

    switch (type) {
      case 'translate': {
        const { text, options } = payload as { text: string, options: TranslateOptions }
        result = await getTranslator().translate(text, options)
        break
      }
      case 'translateBatch': {
        const { texts, options } = payload as { texts: string[], options: TranslateOptions }
        result = await getTranslator().translateBatch(texts, options)
        break
      }
      case 'detect': {
        const { text } = payload as { text: string }
        result = getTranslator().detect(text)
        break
      }
      case 'preload': {
        const { from, to } = payload as { from: string, to: string }
        await getTranslator().preload(from, to)
        result = { success: true }
        break
      }
      case 'dispose': {
        if (translator) {
          await translator.dispose()
          translator = null
        }
        result = { success: true }
        break
      }
      default:
        throw new Error(`Unknown message type: ${type}`)
    }

    const response: WorkerResponse = { type: 'result', id, payload: result }
    workerSelf.postMessage(response)
  }
  catch (err) {
    const response: WorkerResponse = {
      type: 'error',
      id,
      payload: {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      },
    }
    workerSelf.postMessage(response)
  }
}
