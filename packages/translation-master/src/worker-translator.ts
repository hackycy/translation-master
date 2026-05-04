import type { TranslateOptions, TranslateResult, TranslateResultMinimal, TranslatorOptions } from './types'
import type { WorkerMessage, WorkerResponse } from './worker'
import { TranslatorEventEmitter } from './event-emitter'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * Main-thread proxy that runs translation inference in a Web Worker.
 *
 * Spawns a worker, sends translation requests via postMessage,
 * and returns results via Promises. Keeps the main thread completely
 * free during model loading and inference.
 *
 * @example
 * ```ts
 * const translator = new WorkerTranslator({ device: 'auto' })
 * const result = await translator.translate('你好', { to: 'en' })
 * await translator.dispose()
 * ```
 */
export class WorkerTranslator {
  private worker: Worker | null = null
  private requestId = 0
  private pending = new Map<string, PendingRequest>()
  private initPromise: Promise<void> | null = null
  private options: TranslatorOptions
  private workerUrl: URL | string
  private disposed = false

  readonly events = new TranslatorEventEmitter()

  /** Timeout for individual requests (ms). Model loading can be slow. */
  requestTimeout = 120_000

  constructor(options?: TranslatorOptions & { workerUrl?: URL | string }) {
    this.options = options ?? {}
    // Resolve worker URL: explicit > auto-detect
    this.workerUrl = options?.workerUrl ?? new URL('./worker.mjs', import.meta.url)
  }

  /**
   * Initialize the worker. Called lazily on first request,
   * or explicitly to preload. Resets on failure so the caller can
   * detect the error and fall back.
   */
  private ensureInitialized(): Promise<void> {
    if (this.initPromise)
      return this.initPromise

    this.initPromise = this.doInit().catch((err) => {
      // Reset so caller can detect failure and fall back
      this.initPromise = null
      throw err
    })
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    try {
      this.worker = new Worker(this.workerUrl, { type: 'module' })
    }
    catch (err) {
      throw new Error(`Failed to spawn translation worker: ${err instanceof Error ? err.message : err}`)
    }

    // Listen for all messages from worker
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      this.handleMessage(e.data)
    }
    this.worker.onerror = (e) => {
      // Reject all pending requests on worker crash
      const err = new Error(`Worker error: ${e.message}`)
      for (const [, req] of this.pending) {
        clearTimeout(req.timeout)
        req.reject(err)
      }
      this.pending.clear()
    }

    // Send init message with options
    await this.send('init', this.options)
  }

  private handleMessage(response: WorkerResponse): void {
    if (response.type === 'event') {
      const { eventName, data } = response.payload as { eventName: string, data: unknown }
      this.events.emit(eventName as any, data as any)
      return
    }

    const { id, type, payload } = response
    const req = this.pending.get(id)
    if (!req)
      return

    this.pending.delete(id)
    clearTimeout(req.timeout)

    if (type === 'error') {
      const errPayload = payload as { message: string, name: string }
      const err = new Error(errPayload.message)
      err.name = errPayload.name
      req.reject(err)
    }
    else {
      req.resolve(payload)
    }
  }

  private send(type: WorkerMessage['type'], payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'))
        return
      }

      const id = String(++this.requestId)
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker request '${type}' timed out after ${this.requestTimeout}ms`))
      }, this.requestTimeout)

      this.pending.set(id, { resolve, reject, timeout })

      const message: WorkerMessage = { type, id, payload }
      this.worker.postMessage(message)
    })
  }

  /**
   * Translate text. Same API as Translator.translate().
   */
  async translate(text: string, options: TranslateOptions): Promise<TranslateResult & TranslateResultMinimal> {
    await this.ensureInitialized()
    // AbortSignal cannot be transferred to worker; we handle abort on the main thread
    // by timing out or ignoring the result if the caller aborts
    const { signal, ...transferableOptions } = options
    const resultPromise = this.send('translate', { text, options: transferableOptions })

    if (signal) {
      if (signal.aborted) {
        throw new Error('Translation aborted')
      }
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Translation aborted')), { once: true })
      })
      return Promise.race([resultPromise, abortPromise]) as Promise<TranslateResult & TranslateResultMinimal>
    }

    return resultPromise as Promise<TranslateResult & TranslateResultMinimal>
  }

  /**
   * Translate multiple texts in batch. Same API as Translator.translateBatch().
   */
  async translateBatch(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    await this.ensureInitialized()
    const { signal, ...transferableOptions } = options
    const resultPromise = this.send('translateBatch', { texts, options: transferableOptions })

    if (signal) {
      if (signal.aborted) {
        throw new Error('Translation aborted')
      }
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Translation aborted')), { once: true })
      })
      return Promise.race([resultPromise, abortPromise]) as Promise<TranslateResult[]>
    }

    return resultPromise as Promise<TranslateResult[]>
  }

  /**
   * Detect language. Same API as Translator.detect().
   */
  async detect(text: string): Promise<{ lang: string, confidence: number }> {
    await this.ensureInitialized()
    return this.send('detect', { text }) as Promise<{ lang: string, confidence: number }>
  }

  /**
   * Preload model for a language pair. Same API as Translator.preload().
   */
  async preload(from: string, to: string): Promise<void> {
    await this.ensureInitialized()
    await this.send('preload', { from, to })
  }

  /**
   * Dispose the worker and free resources.
   */
  async dispose(): Promise<void> {
    if (this.disposed)
      return
    this.disposed = true

    if (this.worker) {
      try {
        await this.send('dispose', {})
      }
      catch {
        // Ignore errors during dispose
      }
      this.worker.terminate()
      this.worker = null
    }

    // Reject any remaining pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout)
      req.reject(new Error('WorkerTranslator disposed'))
    }
    this.pending.clear()
    this.initPromise = null
    this.events.removeAllListeners()
  }
}
