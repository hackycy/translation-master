import type { PoolStats } from './types'

// Use any for pipeline to avoid complex union type issues with transformers.js
type PipelineInstance = any

interface PoolEntry {
  pipeline: PipelineInstance
  refCount: number
  lastAccess: number
  loading: Promise<PipelineInstance> | null
}

/** Global shared pool instances, keyed by maxSize */
const sharedPools = new Map<number, ModelPool>()

export class ModelPool {
  private pool = new Map<string, PoolEntry>()
  private maxSize: number

  constructor(maxSize = 3) {
    this.maxSize = maxSize
  }

  /**
   * Get or create a shared ModelPool instance for the given maxSize.
   * Multiple Translator instances with the same maxSize share one pool.
   */
  static getShared(maxSize = 3): ModelPool {
    let instance = sharedPools.get(maxSize)
    if (!instance) {
      instance = new ModelPool(maxSize)
      sharedPools.set(maxSize, instance)
    }
    return instance
  }

  /**
   * Acquire a pipeline instance for the given model.
   * Returns cached instance if available, otherwise creates one.
   * Uses a loading promise to prevent duplicate loads.
   */
  async acquire(
    modelId: string,
    task: string,
    options: Record<string, unknown>,
    loadFn: (modelId: string, task: string, options: Record<string, unknown>) => Promise<PipelineInstance>,
    progressCallback?: (event: unknown) => void,
  ): Promise<PipelineInstance> {
    const entry = this.pool.get(modelId)

    // Already loaded
    if (entry && entry.pipeline) {
      entry.refCount++
      entry.lastAccess = Date.now()
      this.touchLRU(modelId)
      return entry.pipeline
    }

    // Currently loading — share the same promise
    if (entry && entry.loading) {
      entry.refCount++
      return entry.loading
    }

    // Need to load — first check pool capacity
    await this.evictIfNeeded()

    // Create loading promise
    const loadingPromise = this.doLoad(modelId, task, options, loadFn, progressCallback)

    this.pool.set(modelId, {
      pipeline: null,
      refCount: 1,
      lastAccess: Date.now(),
      loading: loadingPromise,
    })

    try {
      const pipeline = await loadingPromise
      const existing = this.pool.get(modelId)
      if (existing) {
        existing.pipeline = pipeline
        existing.loading = null
      }
      return pipeline
    }
    catch (err) {
      // Remove failed entry
      this.pool.delete(modelId)
      throw err
    }
  }

  /**
   * Release a reference to a model.
   */
  release(modelId: string): void {
    const entry = this.pool.get(modelId)
    if (entry) {
      entry.refCount = Math.max(0, entry.refCount - 1)
    }
  }

  /**
   * Dispose of a specific model and free its resources.
   */
  async dispose(modelId: string): Promise<void> {
    const entry = this.pool.get(modelId)
    if (!entry)
      return

    // Wait for loading to finish if in progress
    if (entry.loading) {
      try {
        await entry.loading
      }
      catch {
        // Ignore load errors during dispose
      }
    }

    if (entry.pipeline && typeof entry.pipeline.dispose === 'function') {
      await entry.pipeline.dispose()
    }

    this.pool.delete(modelId)
  }

  /**
   * Dispose all models and free resources.
   */
  async disposeAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [id] of this.pool) {
      promises.push(this.dispose(id))
    }
    await Promise.all(promises)
    this.pool.clear()
  }

  /**
   * Get pool statistics.
   */
  stats(): PoolStats {
    const models: PoolStats['models'] = []
    let loading = 0

    for (const [id, entry] of this.pool) {
      if (entry.loading) {
        loading++
      }
      else {
        models.push({
          id,
          refCount: entry.refCount,
          lastAccess: entry.lastAccess,
        })
      }
    }

    return {
      active: models.length,
      loading,
      maxSize: this.maxSize,
      models,
    }
  }

  /**
   * Evict LRU models if pool is at capacity.
   */
  private async evictIfNeeded(): Promise<void> {
    while (this.pool.size >= this.maxSize) {
      const victim = this.findLRU()
      if (victim && victim.entry.refCount === 0) {
        await this.dispose(victim.id)
      }
      else {
        // All models are in use, cannot evict
        break
      }
    }
  }

  /**
   * Find the least recently used model with zero references.
   */
  private findLRU(): { id: string, entry: PoolEntry } | null {
    let oldest: { id: string, entry: PoolEntry } | null = null

    for (const [id, entry] of this.pool) {
      if (entry.refCount > 0)
        continue
      if (entry.loading)
        continue
      if (!oldest || entry.lastAccess < oldest.entry.lastAccess) {
        oldest = { id, entry }
      }
    }

    return oldest
  }

  /**
   * Move model to most-recently-used position.
   */
  private touchLRU(modelId: string): void {
    const entry = this.pool.get(modelId)
    if (entry) {
      entry.lastAccess = Date.now()
    }
  }

  /**
   * Internal load wrapper with progress callback support.
   */
  private async doLoad(
    modelId: string,
    task: string,
    options: Record<string, unknown>,
    loadFn: (modelId: string, task: string, options: Record<string, unknown>) => Promise<PipelineInstance>,
    progressCallback?: (event: unknown) => void,
  ): Promise<PipelineInstance> {
    // Merge progress callback into options if provided
    const loadOptions = { ...options }
    if (progressCallback) {
      (loadOptions as Record<string, unknown>).progress_callback = progressCallback
    }
    return loadFn(modelId, task, loadOptions)
  }
}
