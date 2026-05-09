# @translation-master/browser

浏览器翻译库，支持 DOM 翻译、WebGPU 和 Web Worker 卸载，基于 [Transformers.js](https://huggingface.co/docs/transformers.js)。

## 安装

```bash
pnpm add @translation-master/browser
```

## 快速开始

```ts
import { Translator } from '@translation-master/browser'

const translator = new Translator()

// 自动检测源语言，翻译为中文
const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // '你好，世界'

await translator.dispose()
```

## API

### `Translator`

```ts
new Translator(options?: BrowserTranslatorOptions)
```

在核心 `Translator` 基础上扩展了浏览器特有功能。

**BrowserTranslatorOptions**（继承 `TranslatorOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `device` | `'auto' \| 'wasm' \| 'webgpu'` | `'auto'` | 推理后端（`auto` 优先 WebGPU，回退 WASM） |
| `ui` | `boolean` | `true` | 显示内置 toast 进度 UI |
| `useWorker` | `boolean \| 'auto'` | `'auto'` | 在 Web Worker 中运行推理，保持主线程流畅 |
| `workerUrl` | `URL \| string` | 自动 | 自定义翻译 Worker 脚本 URL |

**额外方法**（核心之外）：

| 方法 | 返回值 | 说明 |
|---|---|---|
| `translatePage(options)` | `Promise<void>` | 翻译整个页面或指定 DOM 元素 |
| `restorePage()` | `void` | 将所有 DOM 内容还原为原文 |
| `startDOMObserver(options?)` | `void` | 监听 DOM 变化，自动增量翻译 |
| `stopDOMObserver()` | `void` | 停止 DOM 变化观察器 |
| `cancelPageTranslation()` | `void` | 取消进行中的 DOM 翻译 |

### DOM 翻译

翻译页面上所有可见文本：

```ts
import { Translator } from '@translation-master/browser'

const translator = new Translator()

// 翻译整个页面
await translator.translatePage({
  to: 'zh',
  onProgress: (event) => {
    console.log(event.phase, event.translatedGroups, event.totalGroups)
  },
})

// 监听 DOM 变化，自动翻译新内容
translator.startDOMObserver({ debounceMs: 500 })

// 停止监听
translator.stopDOMObserver()

// 还原原文
translator.restorePage()

await translator.dispose()
```

翻译指定元素：

```ts
const container = document.getElementById('content')
await translator.translatePage({ to: 'ja', root: container })
```

取消进行中的翻译：

```ts
translator.cancelPageTranslation()
```

### Web Worker

默认情况下，推理在 Web Worker 中运行以保持 UI 响应。通过 `useWorker` 控制：

```ts
// 始终使用 Worker（不可用时抛出异常）
const translator = new Translator({ useWorker: true })

// 始终在主线程运行
const translator = new Translator({ useWorker: false })

// 自动 — 可用时使用 Worker，回退到主线程（默认）
const translator = new Translator({ useWorker: 'auto' })
```

自定义 Worker URL：

```ts
const translator = new Translator({
  workerUrl: new URL('./my-worker.js', import.meta.url),
})
```

### 内置 UI

Toast UI 显示模型下载进度和翻译状态。禁用方式：

```ts
const translator = new Translator({ ui: false })
```

### 浏览器缓存

```ts
import { BrowserCacheAdapter } from '@translation-master/browser'

const cache = new BrowserCacheAdapter('my-cache-name', 'v1')
// 使用浏览器 Cache API，支持基于版本的缓存失效
```

### 事件

```ts
translator.events.on('modelLoad', (e) => {
  console.log(`[${e.state}] ${e.modelId} ${e.progress}%`)
})

translator.events.on('translate', (e) => {
  console.log(`${e.from}→${e.to}: "${e.text}" → "${e.result}"`)
})

translator.events.on('domTranslate', (e) => {
  console.log(`${e.phase}: ${e.translatedGroups}/${e.totalGroups}`)
})

translator.events.on('error', (e) => {
  console.error(e.message)
})
```

### 环境工具

```ts
import { isBrowser, isSSR, isWorker, isWorkerSupported } from '@translation-master/browser'

isBrowser()        // 浏览器主线程中为 true
isSSR()            // Node.js / SSR 中为 true（Web Worker 中为 false）
isWorker()         // Web Worker 上下文中为 true
isWorkerSupported() // 支持 Worker API 时为 true
```

## 架构

```
@translation-master/browser
├── translator.ts        # 浏览器 Translator（继承 core）
├── env.ts               # 环境检测（SSR、WebGPU、Worker）
├── cache.ts             # BrowserCacheAdapter（Cache API + localStorage）
├── ui.ts                # ToastUI 进度指示器
├── dom-translator.ts    # DOM 遍历 & 批量翻译
├── dom-walker.ts        # 从 DOM 收集文本节点
├── dom-renderer.ts      # DOM 还原 & 变更
├── dom-types.ts         # DOM 翻译类型
├── dom-errors.ts        # DOM 相关错误
├── worker-translator.ts # 主线程 ↔ Worker 桥接
└── worker.ts            # Worker 入口（推理端）
```

### 继承关系

```
@translation-master/core  Translator
         │
         └── @translation-master/browser  Translator
               ├── WebGPU 自动检测（resolveDevice()）
               ├── Web Worker 卸载
               ├── DOM 翻译（translatePage / restorePage）
               └── Toast UI
```

## SSR

此包在 SSR 环境中会抛出异常。对于 SSR 框架（Next.js、Nuxt），请确保 `Translator` 仅在客户端实例化：

```ts
// Next.js 示例
'use client'
import { Translator } from '@translation-master/browser'
```

## 许可证

[MIT](../../LICENSE) License
