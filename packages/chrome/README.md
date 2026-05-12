# @translation-master/chrome

Chrome built-in Translator API adapter for `translation-master`.

This package downloads and reuses a managed Chrome for Testing build, launches it through `playwright-core`, opens a small bridge page, and delegates translation work to the browser's built-in `Translator` API.

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
    console.log(event.state, event.progress, event.executablePath ?? event.cacheDir ?? '')
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

- Uses an installed desktop Google Chrome by default, because Chrome's built-in Translator model download depends on the regular Chrome model/component service. If no system Chrome is found, it downloads Chrome for Testing into `.tmigrate/chrome` and reuses it on later runs.
- Set `browserExecutablePath` to use a specific Chrome executable, or `browserBuildId` to force a managed Chrome for Testing build.
- Emits the cache directory and executable path through `onDownloadProgress` so users can inspect or delete the managed browser.
- Uses a real page click to initialize the translator because browser implementations may require user activation.
- Opens a visible Chrome window by default; first-time built-in model downloads may not progress in headless Chrome.
- Requests are serialized internally to reuse one browser page and one language-pair translator safely.
