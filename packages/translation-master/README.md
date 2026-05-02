# translation-master

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]

Pure frontend WASM translation library powered by [Transformers.js](https://github.com/huggingface/transformers). Runs entirely in the browser — no server required.

## Install

```bash
pnpm add translation-master
```

## Quick Start

```ts
import { Translator } from 'translation-master'

const translator = new Translator()

const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // "你好世界"
```

That's it. The model downloads automatically on first use, with a built-in toast progress bar showing the loading status.

## Usage

```ts
import { Translator } from 'translation-master'

// Zero-config: device defaults to WASM, toast UI enabled, auto language detection
const translator = new Translator()

// Auto-detect source language
const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // "你好世界"
console.log(result.from) // "en"

// Specify source language
const result2 = await translator.translate('你好世界', { from: 'zh', to: 'en' })

// Batch translation
const results = await translator.translateBatch(
  ['Hello', 'World'],
  { to: 'ja' },
)

// Language detection
const detected = translator.detect('你好世界')
console.log(detected.lang) // "zh"

// Preload a model for faster first translation
await translator.preload('en', 'zh')

// Clear translation result cache
await translator.clearCache()

// Full cleanup: dispose models, clear caches, remove toast UI
await translator.dispose()
```

### Options

```ts
const translator = new Translator({
  device: 'wasm',        // 'wasm' | 'webgpu' | 'auto' (default: 'wasm')
  dtype: 'q8',           // 'fp32' | 'fp16' | 'q8' | 'q4' (default: auto)
  maxPoolSize: 3,        // Max models loaded simultaneously (default: 3)
  autoDetect: true,      // Auto-detect source language (default: true)
  ui: true,              // Built-in toast progress UI (default: true)
  debug: false,          // Full result metadata (default: false)
})
```

### Events

```ts
translator.events.on('modelLoad', (e) => {
  console.log(`${e.modelId}: ${e.progress}% (${e.state})`)
})

translator.events.on('translate', (e) => {
  console.log(`Translated "${e.text}" in ${e.duration}ms`)
})

translator.events.on('error', (e) => {
  console.error(e.error, e.context)
})
```

### Debug Mode

By default, `translate()` returns `{ text, from, to }` plus `model`, `duration`, `confidence`, and `cached` fields. Enable `debug: true` to get full metadata in the result for development and performance analysis.

### Web Worker

A built-in worker entry is provided for offloading translations to a background thread:

```ts
const worker = new Worker(new URL('translation-master/worker', import.meta.url), { type: 'module' })

worker.postMessage({
  type: 'translate',
  id: '1',
  payload: { text: 'Hello world', options: { to: 'zh' } },
})

worker.onmessage = (e) => {
  console.log(e.data) // { type: 'result', id: '1', payload: { text: '...' } }
}
```

### Shared Model Pool

Multiple `Translator` instances automatically share the same model pool when configured with the same `maxPoolSize`, avoiding duplicate model loads.

### Theming

The built-in toast UI supports light/dark themes via CSS variables:

```css
.translator-toast {
  --translator-toast-bg: #ffffff;
  --translator-toast-color: #333333;
  --translator-toast-border: rgba(0, 0, 0, 0.08);
  --translator-toast-progress-bg: #e8e8e8;
  --translator-toast-progress-fill: #4a90d9;
}
```

Dark mode is auto-detected from `[data-theme="dark"]`, `.dark` class, or `prefers-color-scheme: dark`.

## License

[MIT](./LICENSE) License © [hackycy](https://github.com/hackycy)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/translation-master?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/translation-master
[npm-downloads-src]: https://img.shields.io/npm/dm/translation-master?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/translation-master
