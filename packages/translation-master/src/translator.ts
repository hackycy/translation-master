import type { DOMTranslatorOptions } from './dom-types'
import type { PipelineInstance } from './model-pool'
import type { ModelLoadProgress, ResolvedModel, TranslateOptions, TranslateResult, TranslateResultMinimal, TranslatorOptions } from './types'
import { TranslationResultCache } from './cache'
import { isSSR, isWorker, isWorkerSupported, resolveDevice } from './env'
import { TranslatorEventEmitter } from './event-emitter'
import { detectLanguage, getSupportedLanguages, normalizeLang } from './lang'
import { ModelPool } from './model-pool'
import { ModelRouter } from './model-router'
import { ToastUI } from './ui'

export class Translator {
  private router: ModelRouter
  private pool: ModelPool
  private resultCache: TranslationResultCache
  private device: TranslatorOptions['device']
  private dtype: TranslatorOptions['dtype']
  private autoDetect: boolean
  private debug: boolean
  private transformersModule: typeof import('@huggingface/transformers') | null = null

  /** Event emitter for modelLoad, translate, error events */
  readonly events: TranslatorEventEmitter

  /** Built-in toast UI */
  private toastUI: ToastUI | null = null

  /** DOM translator instance (lazy) */
  private _domTranslator: import('./dom-translator').DOMTranslator | null = null

  /** Web Worker translator for off-main-thread inference (lazy) */
  private _workerTranslator: import('./worker-translator').WorkerTranslator | null = null
  private _useWorker: boolean
  private _workerUrl?: URL | string

  constructor(options?: TranslatorOptions) {
    if (isSSR()) {
      throw new Error(
        '[translation-master] SSR environment detected. Translator requires a browser environment with WebGPU/WASM support. '
        + 'If you are using Next.js/Nuxt, ensure Translator is only instantiated on the client side.',
      )
    }

    this.router = new ModelRouter(options?.models)
    this.pool = ModelPool.getShared(options?.maxPoolSize ?? 3)
    this.resultCache = new TranslationResultCache()
    this.device = options?.device ?? 'wasm'
    this.dtype = options?.dtype
    this.autoDetect = options?.autoDetect ?? true
    this.debug = options?.debug ?? false
    this.events = new TranslatorEventEmitter()

    // Determine whether to use Web Worker for inference
    const useWorkerOpt = options?.useWorker ?? 'auto'
    this._useWorker = useWorkerOpt === true
      || (useWorkerOpt === 'auto' && isWorkerSupported() && !isWorker())
    this._workerUrl = options?.workerUrl

    // Toast UI (enabled by default)
    const uiEnabled = options?.ui !== false
    this.toastUI = new ToastUI(this.events, uiEnabled)

    // Backward compat: wire up deprecated onModelLoadProgress
    if (options?.onModelLoadProgress) {
      this.events.on('modelLoad', options.onModelLoadProgress)
    }
  }

  /**
   * Lazily initialize the worker translator.
   * Returns null if worker mode is disabled.
   */
  private async getWorkerTranslator(): Promise<import('./worker-translator').WorkerTranslator | null> {
    if (!this._useWorker)
      return null

    if (!this._workerTranslator) {
      try {
        const { WorkerTranslator } = await import('./worker-translator')
        this._workerTranslator = new WorkerTranslator({
          device: this.device,
          dtype: this.dtype,
          models: this.router.getConfigs(),
          autoDetect: this.autoDetect,
          workerUrl: this._workerUrl,
        })
        // Forward events from worker to main event emitter
        this._workerTranslator.events.on('modelLoad', e => this.events.emit('modelLoad', e))
        this._workerTranslator.events.on('translate', e => this.events.emit('translate', e))
        this._workerTranslator.events.on('error', e => this.events.emit('error', e))
      }
      catch {
        // Worker unavailable (e.g., bundled file not found during dev) — fall back to main thread
        this._useWorker = false
        return null
      }
    }

    return this._workerTranslator
  }

  /**
   * Translate text from source language to target language.
   */
  async translate(text: string, options: TranslateOptions): Promise<TranslateResult & TranslateResultMinimal> {
    // Delegate to worker if available — inference runs off main thread
    const worker = await this.getWorkerTranslator()
    if (worker) {
      try {
        return await worker.translate(text, options)
      }
      catch {
        // Worker failed (e.g., failed to load) — fall back to main thread
        this._useWorker = false
        await worker.dispose().catch(() => {})
        this._workerTranslator = null
      }
    }

    const startTime = Date.now()
    const to = normalizeLang(options.to)

    // Detect source language
    let from: string
    let confidence: number | undefined
    if (options.from) {
      from = normalizeLang(options.from)
    }
    else if (this.autoDetect) {
      const detected = detectLanguage(text)
      from = detected.lang
      confidence = detected.confidence
    }
    else {
      throw new Error('Source language is required when autoDetect is disabled')
    }

    // Check result cache
    const cached = this.resultCache.get(text, from, to)
    if (cached) {
      const duration = Date.now() - startTime
      this.events.emit('translate', { text, from, to, result: cached, duration, cached: true })
      return { text: cached, from, to, model: 'cache', duration, confidence, cached: true }
    }

    // Resolve model
    const resolved = this.router.resolve(from, to)

    // Translate
    const translatedText = await this.doTranslate(text, resolved, options.signal)

    // Cache result
    this.resultCache.set(text, from, to, translatedText)

    const duration = Date.now() - startTime
    this.events.emit('translate', { text, from, to, result: translatedText, duration, model: resolved.modelId })

    return { text: translatedText, from, to, model: resolved.modelId, duration, confidence }
  }

  /**
   * Translate multiple texts in batch.
   */
  async translateBatch(
    texts: string[],
    options: TranslateOptions,
  ): Promise<TranslateResult[]> {
    // Delegate to worker if available — inference runs off main thread
    const worker = await this.getWorkerTranslator()
    if (worker) {
      try {
        return await worker.translateBatch(texts, options)
      }
      catch {
        // Worker failed — fall back to main thread
        this._useWorker = false
        await worker.dispose().catch(() => {})
        this._workerTranslator = null
      }
    }

    const to = normalizeLang(options.to)

    let from: string
    let confidence: number | undefined
    if (options.from) {
      from = normalizeLang(options.from)
    }
    else if (this.autoDetect) {
      // Detect from first text
      const detected = detectLanguage(texts[0] ?? '')
      from = detected.lang
      confidence = detected.confidence
    }
    else {
      throw new Error('Source language is required when autoDetect is disabled')
    }

    const resolved = this.router.resolve(from, to)
    const pipe = await this.getPipeline(resolved)

    const results: TranslateResult[] = []
    const pipeOptions = this.buildPipeOptions(resolved)

    for (const text of texts) {
      const itemStart = Date.now()

      // Check cache first
      const cached = this.resultCache.get(text, from, to)
      if (cached) {
        results.push({
          text: cached,
          from,
          to,
          model: resolved.modelId,
          duration: Date.now() - itemStart,
          confidence,
          cached: true,
        })
        continue
      }

      const output = await pipe(text, pipeOptions)
      const translatedText = this.extractText(output)

      this.resultCache.set(text, from, to, translatedText)

      results.push({
        text: translatedText,
        from,
        to,
        model: resolved.modelId,
        duration: Date.now() - itemStart,
        confidence,
      })
    }

    return results
  }

  /**
   * Detect the language of a text.
   */
  detect(text: string): { lang: string, confidence: number } {
    return detectLanguage(text)
  }

  /**
   * Preload the model for a given language pair.
   */
  async preload(from: string, to: string): Promise<void> {
    const worker = await this.getWorkerTranslator()
    if (worker) {
      return worker.preload(from, to)
    }
    const resolved = this.router.resolve(from, to)
    await this.getPipeline(resolved)
  }

  /**
   * Get the list of supported languages.
   */
  getSupportedLanguages(): import('./types').LanguageInfo[] {
    return getSupportedLanguages()
  }

  /**
   * Unload the model for a given language pair.
   */
  async unload(from: string, to: string): Promise<void> {
    const resolved = this.router.resolve(from, to)
    await this.pool.dispose(resolved.modelId)
  }

  /**
   * Clear the in-memory translation result cache.
   */
  clearCache(): void {
    this.resultCache.clear()
  }

  /**
   * Translate the entire page or a specific DOM element.
   *
   * Walks the DOM, collects translatable text, translates it using WASM models,
   * and writes the translated text back while preserving HTML structure.
   * Original text is preserved and can be restored with `restorePage()`.
   *
   * @param options DOM translation options
   *
   * @example
   * ```ts
   * const translator = new Translator()
   * await translator.translatePage({ to: 'en' })
   * // Later: restore original text
   * translator.restorePage()
   * ```
   */
  async translatePage(options: DOMTranslatorOptions & { root?: Element }): Promise<void> {
    const { DOMTranslator } = await import('./dom-translator')
    if (!this._domTranslator) {
      this._domTranslator = new DOMTranslator(this)
    }

    // Wire up progress events to the event emitter
    const originalOnProgress = options.onProgress
    const wrappedOptions: typeof options = {
      ...options,
      onProgress: (event) => {
        this.events.emit('domTranslate', {
          phase: event.phase,
          translatedGroups: event.translatedGroups ?? 0,
          totalGroups: event.totalGroups ?? 0,
          currentBatch: event.currentBatch,
          totalBatches: event.totalBatches,
        })
        originalOnProgress?.(event)
      },
    }

    return this._domTranslator.translatePage(wrappedOptions)
  }

  /**
   * Restore all DOM content translated by `translatePage()` back to original text.
   */
  restorePage(): void {
    this._domTranslator?.restore()
  }

  /**
   * Start observing DOM changes for automatic incremental translation.
   * Must be called after `translatePage()`.
   */
  startDOMObserver(options?: { debounceMs?: number, root?: Element }): void {
    this._domTranslator?.startObserver(options)
  }

  /**
   * Stop the DOM change observer.
   */
  stopDOMObserver(): void {
    this._domTranslator?.stopObserver()
  }

  /**
   * Cancel an in-progress DOM translation. Already translated nodes are restored.
   */
  cancelPageTranslation(): void {
    this._domTranslator?.cancel()
  }

  /**
   * Dispose all models, clear caches, and remove toast UI.
   */
  async dispose(): Promise<void> {
    this._domTranslator?.dispose()
    this._domTranslator = null
    if (this._workerTranslator) {
      await this._workerTranslator.dispose()
      this._workerTranslator = null
    }
    await this.pool.disposeAll()
    this.resultCache.clear()
    this.toastUI?.destroy()
    this.toastUI = null
    this.events.removeAllListeners()
  }

  /**
   * Get pool statistics.
   */
  stats(): import('./types').PoolStats {
    return this.pool.stats()
  }

  /**
   * Internal: get or load a pipeline.
   */
  private async getPipeline(resolved: ResolvedModel): Promise<PipelineInstance> {
    const tf = await this.loadTransformers()
    const device = await resolveDevice(this.device ?? 'wasm')

    const options: Record<string, unknown> = {
      device,
    }
    // Only pass dtype when explicitly set by user — omitting it lets the
    // library auto-select the correct ONNX variant (see transformers.js #1581)
    if (this.dtype) {
      options.dtype = this.dtype
    }

    const progressCallback = (event: unknown): void => {
      const e = event as { status?: string, file?: string, progress?: number }
      const modelEvent = {
        modelId: resolved.modelId,
        progress: e.progress ?? 0,
        state: (e.status ?? 'progress') as ModelLoadProgress['state'],
        file: e.file,
      }
      this.events.emit('modelLoad', modelEvent)
    }

    const pipeline = await this.pool.acquire(
      resolved.modelId,
      'translation',
      options,
      (modelId, _task, opts) => tf.pipeline('translation', modelId, opts) as unknown as Promise<PipelineInstance>,
      progressCallback,
    )

    // Pipeline is fully loaded — emit 'ready' so the toast can dismiss
    this.events.emit('modelLoad', {
      modelId: resolved.modelId,
      progress: 100,
      state: 'ready',
    })

    return pipeline
  }

  /**
   * Internal: perform single text translation.
   */
  private async doTranslate(
    text: string,
    resolved: ResolvedModel,
    signal?: AbortSignal,
  ): Promise<string> {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error('Translation aborted')
    }

    const pipe = await this.getPipeline(resolved)
    const pipeOptions = this.buildPipeOptions(resolved)

    // Create a race between translation and abort
    const translatePromise = pipe(text, pipeOptions)

    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Translation aborted')), { once: true })
      })
      const output = await Promise.race([translatePromise, abortPromise])
      return this.extractText(output)
    }

    const output = await translatePromise
    return this.extractText(output)
  }

  /**
   * Build pipeline options based on resolved model config.
   * Includes generation parameters to prevent degenerate output.
   */
  private buildPipeOptions(resolved: ResolvedModel): Record<string, unknown> {
    const opts: Record<string, unknown> = {
      max_new_tokens: 512,
      no_repeat_ngram_size: 3,
      num_beams: 1,
    }
    if (resolved.requiresLangPrefix) {
      if (resolved.src_lang)
        opts.src_lang = resolved.src_lang
      if (resolved.tgt_lang)
        opts.tgt_lang = resolved.tgt_lang
    }
    return opts
  }

  /**
   * Extract translated text from pipeline output.
   */
  private extractText(output: Array<{ translation_text: string }>): string {
    return output[0]?.translation_text ?? ''
  }

  /**
   * Lazily load the @huggingface/transformers module.
   */
  private async loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
    if (!this.transformersModule) {
      this.transformersModule = await import('@huggingface/transformers')
    }
    return this.transformersModule
  }
}
