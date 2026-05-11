# @translation-master/chrome

Chrome built-in Translator API adapter for `translation-master`.

This package launches a desktop Chrome / Chromium instance through `playwright-core`, opens a small bridge page, and delegates translation work to the browser's built-in `Translator` API.

## Install

```bash
pnpm add @translation-master/chrome
```

## Usage

```ts
import { ChromeTranslator } from '@translation-master/chrome'

const translator = new ChromeTranslator({
  channel: 'chrome',
  headless: false,
})

const results = await translator.translate(['提交'], {
  sourceLocale: 'zh',
  targetLocale: 'en',
})

console.log(results[0]?.translation)
await translator.dispose()
```

## Notes

- Requires a desktop Chrome build with the built-in Translator API available.
- Uses a real page click to initialize the translator because browser implementations may require user activation.
- Requests are serialized internally to reuse one browser page and one language-pair translator safely.
