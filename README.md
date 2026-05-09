# translation-master

基于 [Transformers.js](https://huggingface.co/docs/transformers.js) 的模块化、运行时无关的翻译工具包。完全在客户端运行，无需翻译 API 密钥。

## 包

| 包 | 说明 | 环境 |
|---|---|---|
| [`@translation-master/core`](./packages/core) | 运行时无关的翻译核心 | 任意 |
| [`@translation-master/browser`](./packages/browser) | 浏览器翻译，支持 DOM 翻译、WebGPU、Web Worker | 浏览器 |
| [`@translation-master/node`](./packages/node) | Node.js 翻译，使用 ONNX Runtime | Node.js |
| [`@translation-master/vite-plugin`](./packages/vite-plugin) | Vite 插件，注入 translate.js | 构建工具 |

## 架构

```
┌─────────────────────────────────────────────────┐
│              @translation-master/core            │
│                                                  │
│  Translator · ModelRouter · ModelPool · Cache    │
│  Language Detection · Events · Types             │
│  (runtime-agnostic, no DOM/Node APIs)            │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
┌─────────▼──────────┐   ┌─────────▼──────────┐
│  @translation-master│   │ @translation-master │
│      /browser       │   │       /node         │
│                     │   │                     │
│  WebGPU / WASM      │   │  CPU (onnxruntime)  │
│  Web Worker         │   │  FileCacheAdapter   │
│  DOM Translation    │   │                     │
│  Toast UI           │   │                     │
│  BrowserCacheAdapter│   │                     │
└─────────────────────┘   └─────────────────────┘

┌─────────────────────────────────────────────────┐
│          @translation-master/vite-plugin         │
│  (injects translate.js into HTML via Vite)       │
└─────────────────────────────────────────────────┘
```

### Core (`@translation-master/core`)

核心层提供所有翻译逻辑，不依赖任何运行时特定 API：

- **Translator** — 主入口，接受运行时包提供的 `TransformersLoader` 函数
- **ModelRouter** — 将语言对解析为最佳可用模型（opus-mt → nllb 回退）
- **ModelPool** — 共享模型池，支持引用计数和 LRU 淘汰
- **TranslationResultCache** — 内存 LRU 翻译结果缓存
- **语言工具** — 检测、标准化、FLORES 编码、中文变体检测
- **事件系统** — 类型化发射器，支持 `modelLoad`、`translate`、`error`、`domTranslate` 事件

### Browser (`@translation-master/browser`)

在核心基础上扩展浏览器特有功能：

- **WebGPU 自动检测** — 优先使用 WebGPU，回退到 WASM
- **Web Worker** — 将模型推理卸载到 Worker 线程（默认自动）
- **DOM 翻译** — `translatePage()` 遍历 DOM、批量翻译文本节点、支持还原
- **Toast UI** — 内置进度指示器（可禁用）
- **BrowserCacheAdapter** — 使用 Cache API + localStorage 进行模型缓存

### Node.js (`@translation-master/node`)

在核心基础上扩展 Node.js 默认配置：

- **CPU 设备** — 使用 `onnxruntime-node` 进行推理
- **FileCacheAdapter** — 基于文件系统的缓存，SHA-256 哈希文件名
- 自动配置 `transformersLoader`（无需手动设置）

### Vite 插件 (`@translation-master/vite-plugin`)

在 Vite 构建/开发期间将 [translate.js](https://github.com/ChunyuPCY/translate.js) 注入 HTML 页面。支持版本 `3.18.66` 和 `4.0.3`。

## 快速开始

### 浏览器

```ts
import { Translator } from '@translation-master/browser'

const translator = new Translator()

// 翻译文本
const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // '你好，世界'

// 翻译整个页面
await translator.translatePage({ to: 'zh' })

await translator.dispose()
```

### Node.js

```ts
import { Translator } from '@translation-master/node'

const translator = new Translator()

const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // '你好，世界'

await translator.dispose()
```

## 支持的语言

通过 opus-mt 和 NLLB 模型内置支持 100+ 语言对。包括：en、zh、zh-TW、ja、ko、fr、de、es、pt、ru、ar、th、hi、vi 等。

## 许可证

[MIT](./LICENSE) License © [hackycy](https://github.com/hackycy)
