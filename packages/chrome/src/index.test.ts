import { describe, expect, it } from 'vitest'
import { normalizeDownloadProgress } from './index'

describe('chrome translator progress mapping', () => {
  it('normalizes browser and translator download progress values', () => {
    expect(normalizeDownloadProgress(0, 0)).toBe(0)
    expect(normalizeDownloadProgress(0.42, 0)).toBe(42)
    expect(normalizeDownloadProgress(42, 100)).toBe(42)
    expect(normalizeDownloadProgress(101, 100)).toBe(100)
    expect(normalizeDownloadProgress(-5, 100)).toBe(0)
  })
})
