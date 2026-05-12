import { describe, expect, it } from 'vitest'
import { normalizeDownloadProgress, parseChromeMajorVersion } from './index'

describe('chrome translator progress mapping', () => {
  it('normalizes browser and translator download progress values', () => {
    expect(normalizeDownloadProgress(0, 0)).toBe(0)
    expect(normalizeDownloadProgress(0.42, 0)).toBe(42)
    expect(normalizeDownloadProgress(42, 100)).toBe(42)
    expect(normalizeDownloadProgress(101, 100)).toBe(100)
    expect(normalizeDownloadProgress(-5, 100)).toBe(0)
  })

  it('parses Google Chrome major versions', () => {
    expect(parseChromeMajorVersion('Google Chrome 148.0.0.0')).toBe(148)
    expect(parseChromeMajorVersion('Chrome 138.0.7204.49')).toBe(138)
    expect(parseChromeMajorVersion('Google Chrome for Testing 148.0.7778.97')).toBe(148)
    expect(parseChromeMajorVersion('Chromium 148.0.0.0')).toBeUndefined()
  })
})
