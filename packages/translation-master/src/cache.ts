import type { CacheAdapter } from './types'

const CACHE_VERSION_KEY = 'translation-master:cache-version'

/**
 * Default CacheAdapter using the browser Cache API.
 * Supports version-based cache invalidation.
 */
export class BrowserCacheAdapter implements CacheAdapter {
  private cacheName: string
  private version: string

  constructor(cacheName = 'translator-models', version = '1') {
    this.cacheName = cacheName
    this.version = version
  }

  private async getCache(): Promise<Cache | undefined> {
    if (typeof caches === 'undefined')
      return undefined
    await this.checkVersion()
    return caches.open(this.cacheName)
  }

  private async checkVersion(): Promise<void> {
    if (typeof localStorage === 'undefined')
      return
    const stored = localStorage.getItem(CACHE_VERSION_KEY)
    if (stored !== this.version) {
      await this.clear()
      localStorage.setItem(CACHE_VERSION_KEY, this.version)
    }
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const cache = await this.getCache()
    if (!cache)
      return null
    const response = await cache.match(key)
    if (!response)
      return null
    return response.arrayBuffer()
  }

  async set(key: string, data: ArrayBuffer): Promise<void> {
    const cache = await this.getCache()
    if (!cache)
      return
    await cache.put(key, new Response(data))
  }

  async has(key: string): Promise<boolean> {
    const cache = await this.getCache()
    if (!cache)
      return false
    const response = await cache.match(key)
    return response !== undefined
  }

  async delete(key: string): Promise<void> {
    const cache = await this.getCache()
    if (!cache)
      return
    await cache.delete(key)
  }

  async clear(): Promise<void> {
    if (typeof caches === 'undefined')
      return
    await caches.delete(this.cacheName)
  }
}

/**
 * In-memory LRU cache for translation results.
 */
export class TranslationResultCache {
  private cache = new Map<string, { result: string, timestamp: number }>()
  private maxSize: number
  private ttl: number

  constructor(maxSize = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttl = ttlMs
  }

  private makeKey(text: string, from: string, to: string): string {
    return `${from}:${to}:${text}`
  }

  get(text: string, from: string, to: string): string | null {
    const key = this.makeKey(text, from, to)
    const entry = this.cache.get(key)
    if (!entry)
      return null

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.result
  }

  set(text: string, from: string, to: string, result: string): void {
    const key = this.makeKey(text, from, to)

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}
