import type { DOMTranslateProgressEvent, DOMTranslatorOptions, TextGroup } from './dom-types'
import type { Translator } from './translator'
import { TranslationResultCache } from './cache'
import { DOMObserver } from './dom-observer'
import { DOMRenderer } from './dom-renderer'
import { DOMViewport } from './dom-viewport'
import { DOMWalker } from './dom-walker'
import { detectLanguage } from './lang'

/**
 * DOMTranslator provides automatic translation of web page content.
 *
 * It walks the DOM, collects translatable text nodes, translates them
 * using the provided Translator instance, and writes the translated text
 * back to the DOM while preserving HTML structure.
 *
 * Features:
 * - TreeWalker-based DOM traversal with intelligent text merging
 * - Placeholder-based write-back for mixed inline elements
 * - Original text preservation with restore support
 * - MutationObserver for dynamic content (Vue/React compatible)
 * - Viewport priority (visible content translated first)
 * - Adaptive batching for large pages
 * - AbortController support for cancellation
 * - Debug logging
 *
 * @example
 * ```ts
 * const translator = new Translator()
 * const dom = new DOMTranslator(translator)
 *
 * // Translate the whole page to English
 * await dom.translatePage({ to: 'en' })
 *
 * // Restore original text
 * dom.restore()
 *
 * // Translate a specific element
 * await dom.translatePage({ to: 'ja', root: document.getElementById('content') })
 * ```
 */
export class DOMTranslator {
  private translator: Translator
  private walker: DOMWalker | null = null
  private renderer: DOMRenderer | null = null
  private observer: DOMObserver | null = null
  private viewport: DOMViewport | null = null

  /** All translated nodes, tracked for restore */
  private translatedNodes = new Set<Text | Attr>()

  /** All translated TextGroups, tracked for restore */
  private translatedGroups: TextGroup[] = []

  /** Current abort controller */
  private abortController: AbortController | null = null

  /** Current state */
  private state: 'idle' | 'scanning' | 'translating' | 'done' | 'cancelled' = 'idle'

  /** Result cache for DOM translations */
  private resultCache = new TranslationResultCache(2000, 10 * 60 * 1000)

  /** Target language set by the last translatePage() call */
  private targetLang = ''

  /** Debug mode */
  private debug = false

  constructor(translator: Translator) {
    this.translator = translator
  }

  /**
   * Translate the entire page or a specific root element.
   *
   * @param options Translation options
   */
  async translatePage(options: DOMTranslatorOptions & { root?: Element }): Promise<void> {
    if (this.state === 'scanning' || this.state === 'translating') {
      throw new Error(
        '[translation-master] A DOM translation is already in progress. '
        + 'Cancel the current one first or wait for it to finish.',
      )
    }

    const root = options.root ?? document.documentElement
    const signal = options.signal

    // Create a new AbortController if no signal provided
    if (!signal) {
      this.abortController = new AbortController()
    }

    this.state = 'scanning'
    this.targetLang = options.to
    this.debug = options.debug ?? false

    // Initialize modules
    this.walker = new DOMWalker(options)
    this.renderer = new DOMRenderer(options.debug)

    if (options.viewportPriority !== false) {
      this.viewport = new DOMViewport()
      this.viewport.init()
    }

    try {
      // Phase 1: Scan
      this.emitProgress(options.onProgress, {
        phase: 'scanning',
      })

      const groups = this.walker.scan(root)
      const translatableGroups = groups.filter(g => g.text.trim().length > 0)

      if (options.debug) {
        console.log(`[translation-master] Found ${translatableGroups.length} text groups to translate`)
      }

      if (translatableGroups.length === 0) {
        this.state = 'done'
        this.emitProgress(options.onProgress, { phase: 'done', totalGroups: 0, translatedGroups: 0 })
        return
      }

      // Sort by viewport priority
      if (this.viewport) {
        this.viewport.observeElements(translatableGroups.map(g => g.parentElement))
        // Give IntersectionObserver a tick to collect initial entries
        await new Promise(resolve => setTimeout(resolve, 0))
        const sorted = this.viewport.sort(translatableGroups)
        translatableGroups.length = 0
        translatableGroups.push(...sorted)
      }

      // Preload translation pipeline while we have the chance
      // This avoids blocking during the first batch translation
      await this.preloadPipeline(translatableGroups, options)

      // Phase 2: Translate
      this.state = 'translating'
      await this.translateGroups(translatableGroups, options)

      // Phase 3: Done
      // State may have changed to 'cancelled' during the await (via cancel() call)
      if ((this.state as string) === 'cancelled') {
        this.emitProgress(options.onProgress, { phase: 'cancelled' })
        return
      }

      this.state = 'done'
      this.emitProgress(options.onProgress, {
        phase: 'done',
        totalGroups: translatableGroups.length,
        translatedGroups: translatableGroups.length,
      })

      // Phase 4: Optional observer
      if (options.observe) {
        this.startObserver({ debounceMs: options.debounceMs, root })
      }
    }
    catch (err) {
      this.state = 'idle'
      throw err
    }
    finally {
      this.viewport?.destroy()
      this.viewport = null
    }
  }

  /**
   * Translate collected TextGroups using batch API with frequent yielding.
   *
   * Key performance strategies:
   * 1. Use translator.translateBatch() to reuse pipeline within a batch
   * 2. Yield to main thread between every batch (not just between batches)
   * 3. Process cache hits immediately without waiting
   * 4. Filter out same-language groups before sending to the model
   */
  private async translateGroups(
    groups: TextGroup[],
    options: DOMTranslatorOptions,
  ): Promise<void> {
    const from = options.from
    const to = options.to
    const signal = options.signal ?? this.abortController?.signal
    const onProgress = options.onProgress

    // Group by detected source language
    const langGroups = this.groupByLanguage(groups, from)

    // Yield after scanning
    await this.yieldToMain()

    let translatedCount = 0
    let batchIdx = 0

    for (const [lang, langGroupList] of langGroups) {
      // Skip groups already in target language
      if (lang === to) {
        translatedCount += langGroupList.length
        continue
      }

      // Split into cache hits and cache misses
      const cacheHits: TextGroup[] = []
      const toTranslate: TextGroup[] = []

      for (const group of langGroupList) {
        if (signal?.aborted) {
          this.state = 'cancelled'
          return
        }

        const text = group.text.trim()
        if (text.length === 0) {
          translatedCount++
          continue
        }

        const cached = this.resultCache.get(text, lang, to)
        if (cached) {
          // Cache hit — write back immediately, no model inference needed
          this.renderer!.writeBack(group, cached)
          this.trackTranslated(group)
          cacheHits.push(group)
          translatedCount++
        }
        else {
          toTranslate.push(group)
        }
      }

      // Yield after processing cache hits
      if (cacheHits.length > 0) {
        await this.yieldToMain()
      }

      if (toTranslate.length === 0)
        continue

      // Translate in batches using translateBatch for pipeline reuse
      const batchSize = this.calculateBatchSize(toTranslate)
      const totalBatches = Math.ceil(toTranslate.length / batchSize)

      for (let i = 0; i < toTranslate.length; i += batchSize) {
        if (signal?.aborted) {
          this.state = 'cancelled'
          return
        }

        batchIdx++
        const batch = toTranslate.slice(i, i + batchSize)

        this.emitProgress(onProgress, {
          phase: 'translating',
          translatedGroups: translatedCount,
          totalGroups: groups.length,
          currentBatch: batchIdx,
          totalBatches,
        })

        // Prepare texts for batch translation
        const texts = batch.map(g => this.renderer!.prepareForTranslation(g))
        const fromLang = lang

        try {
          // Use translateBatch — reuses the same pipeline, much faster
          const results = await this.translator.translateBatch(texts, {
            from: fromLang,
            to,
            signal,
          })

          // Write back results
          for (let j = 0; j < batch.length; j++) {
            const group = batch[j]
            const result = results[j]
            this.resultCache.set(group.text.trim(), fromLang, to, result.text)
            this.renderer!.writeBack(group, result.text)
            this.trackTranslated(group)
            translatedCount++
          }
        }
        catch {
          // Fallback: translate individually if batch fails
          for (const group of batch) {
            if (signal?.aborted) {
              this.state = 'cancelled'
              return
            }
            await this.translateSingleGroup(group, from, to, signal)
            translatedCount++
          }
        }

        // Yield to main thread between EVERY batch — critical for responsiveness
        await this.yieldToMain()

        this.emitProgress(onProgress, {
          phase: 'translating',
          translatedGroups: translatedCount,
          totalGroups: groups.length,
          currentBatch: batchIdx,
          totalBatches,
        })
      }
    }
  }

  /**
   * Translate a single TextGroup and write back to DOM.
   */
  private async translateSingleGroup(
    group: TextGroup,
    from: string | undefined,
    to: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const text = group.text.trim()
    if (text.length === 0)
      return

    // Check if source language matches target — skip if so
    const detected = from ?? detectLanguage(text).lang
    group.detectedLang = detected
    if (detected === to) {
      return
    }

    // Check cache
    const cached = this.resultCache.get(text, detected, to)
    if (cached) {
      this.renderer!.writeBack(group, cached)
      this.trackTranslated(group)
      return
    }

    // Prepare text with placeholders for multi-fragment groups
    const textForTranslation = this.renderer!.prepareForTranslation(group)

    // Translate using the Translator instance
    const result = await this.translator.translate(textForTranslation, {
      from: detected,
      to,
      signal,
    })

    // Cache the result
    this.resultCache.set(text, detected, to, result.text)

    // Write back to DOM
    this.emitProgress(undefined, { phase: 'rendering' })
    this.renderer!.writeBack(group, result.text)
    this.trackTranslated(group)
  }

  /**
   * Track translated nodes and groups for restore support.
   */
  private trackTranslated(group: TextGroup): void {
    this.translatedGroups.push(group)
    for (const fragment of group.fragments) {
      this.translatedNodes.add(fragment.node)
    }
  }

  /**
   * Group TextGroups by detected source language.
   */
  private groupByLanguage(
    groups: TextGroup[],
    defaultFrom?: string,
  ): Map<string, TextGroup[]> {
    const map = new Map<string, TextGroup[]>()

    for (const group of groups) {
      const lang = defaultFrom ?? detectLanguage(group.text).lang
      group.detectedLang = lang

      if (!map.has(lang)) {
        map.set(lang, [])
      }
      map.get(lang)!.push(group)
    }

    return map
  }

  /**
   * Calculate adaptive batch size based on total text volume.
   * With worker-based inference, the main thread is free during translation,
   * so larger batches reduce postMessage round-trip overhead.
   */
  private calculateBatchSize(groups: TextGroup[]): number {
    const totalChars = groups.reduce((sum, g) => sum + g.text.length, 0)
    const avgCharsPerGroup = totalChars / groups.length

    if (avgCharsPerGroup < 20) {
      return Math.min(20, groups.length) // Many short texts (buttons, labels)
    }
    else if (avgCharsPerGroup < 100) {
      return Math.min(10, groups.length) // Medium texts
    }
    else {
      return Math.min(5, groups.length) // Long texts (paragraphs)
    }
  }

  /**
   * Preload the translation pipeline for the detected language pairs.
   * Called during the scanning phase so the model is ready when translation starts.
   */
  private async preloadPipeline(
    groups: TextGroup[],
    options: DOMTranslatorOptions,
  ): Promise<void> {
    const from = options.from
    const to = options.to

    // Detect source language from the first non-empty group
    const sampleLang = from ?? (groups.length > 0 ? detectLanguage(groups[0].text).lang : undefined)
    if (!sampleLang || sampleLang === to)
      return

    try {
      await this.translator.preload(sampleLang, to)
      if (this.debug) {
        console.log(`[translation-master] Pipeline preloaded: ${sampleLang} → ${to}`)
      }
    }
    catch {
      // Preload failure is non-fatal; translation will load it later
    }
  }

  /**
   * Yield to the main thread using MessageChannel (microtask-level, faster than setTimeout).
   */
  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => resolve()
      ch.port2.postMessage(undefined)
    })
  }

  /**
   * Restore all translated nodes back to their original text.
   */
  restore(): void {
    // Restore in reverse order for correctness
    for (let i = this.translatedGroups.length - 1; i >= 0; i--) {
      const group = this.translatedGroups[i]
      for (const fragment of group.fragments) {
        this.renderer?.restoreNode(fragment.node)
      }
    }

    this.translatedNodes.clear()
    this.translatedGroups = []

    if (this.observer) {
      this.observer.stop()
    }
  }

  /**
   * Start MutationObserver for dynamic content translation.
   */
  startObserver(options?: { debounceMs?: number, root?: Element }): void {
    if (!this.walker || !this.renderer) {
      console.warn('[translation-master] Cannot start observer before translatePage() is called')
      return
    }

    if (!this.targetLang) {
      console.warn('[translation-master] Cannot start observer: targetLang is not set. Call translatePage() first.')
      return
    }

    // Stop existing observer if any
    this.observer?.destroy()

    this.observer = new DOMObserver(
      this.walker,
      this.renderer,
      async (elements: Element[]) => {
        // Incremental translation for dynamically added content
        const groups: TextGroup[] = []
        for (const el of elements) {
          const elGroups = this.walker!.scan(el)
          groups.push(...elGroups.filter(g => g.text.trim().length > 0))
        }

        if (groups.length === 0)
          return

        const to = this.targetLang
        if (!to)
          return

        for (const group of groups) {
          try {
            const text = group.text.trim()
            if (text.length === 0)
              continue

            const detected = detectLanguage(text).lang
            if (detected === to)
              continue

            // Check cache first
            const cached = this.resultCache.get(text, detected, to)
            if (cached) {
              this.renderer!.writeBack(group, cached)
              this.trackTranslated(group)
              continue
            }

            // Translate and write back
            const textForTranslation = this.renderer!.prepareForTranslation(group)
            const result = await this.translator.translate(textForTranslation, {
              from: detected,
              to,
            })
            this.resultCache.set(text, detected, to, result.text)
            this.renderer!.writeBack(group, result.text)
            this.trackTranslated(group)
          }
          catch (err) {
            if (this.debug) {
              console.error('[translation-master] Observer failed to translate group:', group.text, err)
            }
          }
        }
      },
      options?.debounceMs ?? 300,
    )

    this.observer.start(options?.root ?? document.documentElement)
  }

  /**
   * Stop the MutationObserver.
   */
  stopObserver(): void {
    this.observer?.stop()
  }

  /**
   * Cancel the current translation in progress.
   * Already translated nodes are restored.
   */
  cancel(): void {
    if (this.state !== 'scanning' && this.state !== 'translating')
      return

    this.abortController?.abort()
    this.state = 'cancelled'

    // Restore already translated content
    this.restore()
  }

  /**
   * Get the current state.
   */
  getState(): string {
    return this.state
  }

  /**
   * Destroy the DOMTranslator and clean up all resources.
   */
  dispose(): void {
    this.cancel()
    this.observer?.destroy()
    this.observer = null
    this.viewport?.destroy()
    this.viewport = null
    this.walker = null
    this.renderer = null
    this.translatedNodes.clear()
    this.translatedGroups = []
    this.resultCache.clear()
    this.state = 'idle'
  }

  /**
   * Emit progress event to the callback.
   */
  private emitProgress(
    callback: ((event: DOMTranslateProgressEvent) => void) | undefined,
    event: Partial<DOMTranslateProgressEvent>,
  ): void {
    callback?.({
      phase: event.phase ?? 'translating',
      ...event,
    } as DOMTranslateProgressEvent)
  }
}
