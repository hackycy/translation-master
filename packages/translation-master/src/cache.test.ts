import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationResultCache } from './cache'

describe('translationResultCache', () => {
  let cache: TranslationResultCache

  beforeEach(() => {
    cache = new TranslationResultCache(3, 1000) // maxSize=3, ttl=1s
  })

  describe('get/set basics', () => {
    it('returns null for missing keys', () => {
      expect(cache.get('hello', 'en', 'zh')).toBeNull()
    })

    it('returns stored values', () => {
      cache.set('hello', 'en', 'zh', '你好')
      expect(cache.get('hello', 'en', 'zh')).toBe('你好')
    })

    it('distinguishes language pairs', () => {
      cache.set('hello', 'en', 'zh', '你好')
      cache.set('hello', 'en', 'ja', 'こんにちは')
      expect(cache.get('hello', 'en', 'zh')).toBe('你好')
      expect(cache.get('hello', 'en', 'ja')).toBe('こんにちは')
    })

    it('distinguishes source text', () => {
      cache.set('hello', 'en', 'zh', '你好')
      cache.set('world', 'en', 'zh', '世界')
      expect(cache.get('hello', 'en', 'zh')).toBe('你好')
      expect(cache.get('world', 'en', 'zh')).toBe('世界')
    })
  })

  describe('lru eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      cache.set('a', 'en', 'zh', 'A')
      cache.set('b', 'en', 'zh', 'B')
      cache.set('c', 'en', 'zh', 'C')
      // Cache is full (maxSize=3)
      cache.set('d', 'en', 'zh', 'D')
      // 'a' should be evicted
      expect(cache.get('a', 'en', 'zh')).toBeNull()
      expect(cache.get('d', 'en', 'zh')).toBe('D')
    })

    it('moves accessed entries to end (most recently used)', () => {
      cache.set('a', 'en', 'zh', 'A')
      cache.set('b', 'en', 'zh', 'B')
      cache.set('c', 'en', 'zh', 'C')
      // Access 'a' to make it recently used
      cache.get('a', 'en', 'zh')
      // Add 'd' — should evict 'b' (now the oldest)
      cache.set('d', 'en', 'zh', 'D')
      expect(cache.get('a', 'en', 'zh')).toBe('A')
      expect(cache.get('b', 'en', 'zh')).toBeNull()
      expect(cache.get('c', 'en', 'zh')).toBe('C')
      expect(cache.get('d', 'en', 'zh')).toBe('D')
    })
  })

  describe('ttl expiration', () => {
    it('expires entries after TTL', () => {
      vi.useFakeTimers()
      const shortCache = new TranslationResultCache(100, 500) // 500ms TTL

      shortCache.set('hello', 'en', 'zh', '你好')
      expect(shortCache.get('hello', 'en', 'zh')).toBe('你好')

      // Advance past TTL
      vi.advanceTimersByTime(600)
      expect(shortCache.get('hello', 'en', 'zh')).toBeNull()

      vi.useRealTimers()
    })

    it('does not expire entries before TTL', () => {
      vi.useFakeTimers()
      const shortCache = new TranslationResultCache(100, 500)

      shortCache.set('hello', 'en', 'zh', '你好')
      vi.advanceTimersByTime(400)
      expect(shortCache.get('hello', 'en', 'zh')).toBe('你好')

      vi.useRealTimers()
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('a', 'en', 'zh', 'A')
      cache.set('b', 'en', 'zh', 'B')
      cache.clear()
      expect(cache.get('a', 'en', 'zh')).toBeNull()
      expect(cache.get('b', 'en', 'zh')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles empty string values', () => {
      cache.set('hello', 'en', 'zh', '')
      expect(cache.get('hello', 'en', 'zh')).toBe('')
    })

    it('overwrites existing key', () => {
      cache.set('hello', 'en', 'zh', '你好')
      cache.set('hello', 'en', 'zh', '您好')
      expect(cache.get('hello', 'en', 'zh')).toBe('您好')
    })
  })
})
