/**
 * FileCacheAdapter demo using @translation-master/node
 *
 * Shows how to use file-system based caching for model data.
 *
 * Run: pnpm -F playground script:cache
 */
import { resolve } from 'node:path'
import { FileCacheAdapter } from '@translation-master/node'

const cacheDir = resolve(import.meta.dirname, '../.cache-demo')
const cache = new FileCacheAdapter(cacheDir)

console.log(`Cache directory: ${cacheDir}\n`)

// Write
console.log('--- Writing cache entries ---')
const encoder = new TextEncoder()

const entries = [
  { key: 'model:zh-en:v1', value: 'Chinese to English model data' },
  { key: 'model:en-ja:v1', value: 'English to Japanese model data' },
  { key: 'result:你好:en', value: 'Hello' },
]

for (const entry of entries) {
  const data = encoder.encode(entry.value).buffer
  await cache.set(entry.key, data)
  console.log(`  SET ${entry.key}`)
}

// Read
console.log('\n--- Reading cache entries ---')
for (const entry of entries) {
  const data = await cache.get(entry.key)
  if (data) {
    const text = new TextDecoder().decode(data)
    console.log(`  GET ${entry.key} → "${text}"`)
  }
  else {
    console.log(`  GET ${entry.key} → null`)
  }
}

// Has
console.log('\n--- Checking existence ---')
console.log(`  HAS model:zh-en:v1 → ${await cache.has('model:zh-en:v1')}`)
console.log(`  HAS model:fr-de:v1 → ${await cache.has('model:fr-de:v1')}`)

// Delete
console.log('\n--- Deleting one entry ---')
await cache.delete('result:你好:en')
console.log(`  DELETE result:你好:en`)
console.log(`  HAS result:你好:en → ${await cache.has('result:你好:en')}`)

// Clear
console.log('\n--- Clearing all ---')
await cache.clear()
console.log(`  CLEAR done`)
console.log(`  HAS model:zh-en:v1 → ${await cache.has('model:zh-en:v1')}`)

// Clean up the demo cache directory
const { rmSync } = await import('node:fs')
rmSync(cacheDir, { recursive: true, force: true })
console.log(`\nCleaned up cache directory`)

console.log('\nDone!')
