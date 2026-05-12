# @translation-master/chrome

Chrome built-in Translator API adapter for `translation-master`.

This package launches an installed desktop Google Chrome through `playwright-core`, opens a small bridge page, and delegates translation work to the browser's built-in `Translator` API.

## Install

```bash
pnpm add @translation-master/chrome
```

## Usage

```ts
import { ChromeTranslator } from '@translation-master/chrome'

const translator = new ChromeTranslator({
  browserVisible: true,
  onDownloadProgress(event) {
    console.log(event.state, event.progress, event.executablePath ?? event.version ?? event.downloadUrl ?? '')
  },
})

const results = await translator.translate(['提交'], {
  sourceLocale: 'zh',
  targetLocale: 'en',
})

console.log(results[0]?.translation)
await translator.dispose()
```

## Notes

- Uses an installed desktop Google Chrome 138+ by default, because Chrome's built-in Translator model download depends on the regular Chrome model/component service.
- If Google Chrome is missing or too old, install or upgrade it from <https://www.google.com/chrome/>; Chrome for Testing is intentionally not downloaded because its Translator model creation can hang.
- Set `browserExecutablePath` to use a specific Google Chrome executable.
- Emits the executable path and browser version through `onDownloadProgress` so users can inspect which Chrome is being used.
- Uses a real page click to initialize the translator because browser implementations may require user activation.
- Opens a visible Chrome window by default; first-time built-in model downloads may not progress in headless Chrome.
- Requests are serialized internally to reuse one browser page and one language-pair translator safely.
