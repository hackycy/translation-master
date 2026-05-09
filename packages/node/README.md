# @translation-master/node

Node.js 翻译库，基于 [Transformers.js](https://huggingface.co/docs/transformers.js)，使用 ONNX Runtime（CPU）。

## 安装

```bash
pnpm add @translation-master/node @huggingface/transformers
```

## 快速开始

```ts
import { Translator } from '@translation-master/node'

const translator = new Translator()

const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // '你好，世界'

await translator.dispose()
```

## API

### `Translator`

```ts
new Translator(options?: TranslatorOptions)
```

在核心 `Translator` 基础上扩展了 Node.js 默认配置：
- `device` 默认为 `'cpu'`（使用 `onnxruntime-node`）
- `transformersLoader` 自动设置为 `import('@huggingface/transformers')`

**TranslatorOptions：**

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `device` | `'auto' \| 'wasm' \| 'webgpu' \| 'cpu'` | `'cpu'` | 推理后端 |
| `dtype` | `'fp32' \| 'fp16' \| 'q8' \| 'q4'` | 自动 | 量化精度 |
| `models` | `ModelConfig[]` | 内置 | 自定义模型配置 |
| `maxPoolSize` | `number` | `3` | 同时加载的最大模型数 |
| `autoDetect` | `boolean` | `true` | 自动检测源语言 |
| `modelBaseUrl` | `string` | - | 自定义模型文件基础 URL |
| `debug` | `boolean` | `false` | 启用调试模式 |

**方法：**

| 方法 | 返回值 | 说明 |
|---|---|---|
| `translate(text, options)` | `Promise<TranslateResult>` | 翻译单个文本 |
| `translateBatch(texts, options)` | `Promise<TranslateResult[]>` | 批量翻译多个文本 |
| `detect(text)` | `{ lang, confidence }` | 检测文本语言 |
| `preload(from, to)` | `Promise<void>` | 预加载指定语言对的模型 |
| `unload(from, to)` | `Promise<void>` | 卸载指定语言对的模型 |
| `getSupportedLanguages()` | `LanguageInfo[]` | 获取支持的语言列表 |
| `clearCache()` | `void` | 清空内存中的翻译结果缓存 |
| `dispose()` | `Promise<void>` | 释放所有模型和缓存 |
| `stats()` | `PoolStats` | 获取模型池统计信息 |

### 批量翻译

```ts
const translator = new Translator()

const results = await translator.translateBatch(
  ['Hello', 'World', 'How are you?'],
  { to: 'zh' },
)

for (const r of results) {
  console.log(r.text)
}
// 你好
// 世界
// 你好吗？

await translator.dispose()
```

### 预加载模型

```ts
const translator = new Translator()

// 预加载模型，首次 translate() 调用会更快
await translator.preload('en', 'zh')

const result = await translator.translate('Hello', { to: 'zh' })
await translator.dispose()
```

### 自定义模型

```ts
const translator = new Translator({
  models: [
    {
      id: 'custom/my-model',
      type: 'opus-mt',
      pairs: [{ from: 'es', to: 'pt' }],
      priority: 0,
    },
  ],
})
```

### 自定义模型源

```ts
const translator = new Translator({
  modelBaseUrl: '/path/to/local/models',
})
```

模型文件必须遵循 HuggingFace 目录结构：

```
{modelBaseUrl}/Xenova/opus-mt-zh-en/resolve/main/model.onnx
{modelBaseUrl}/Xenova/opus-mt-zh-en/resolve/main/tokenizer.json
{modelBaseUrl}/Xenova/opus-mt-zh-en/resolve/main/config.json
```

### 文件缓存

```ts
import { FileCacheAdapter } from '@translation-master/node'

const cache = new FileCacheAdapter('./my-cache')
// 将缓存的模型数据存储为指定目录中的文件
// 使用 SHA-256 哈希文件名，.cache 扩展名
```

### 事件

```ts
translator.events.on('modelLoad', (e) => {
  console.log(`[${e.state}] ${e.modelId} ${e.progress}%`)
})

translator.events.on('translate', (e) => {
  console.log(`${e.from}→${e.to}: "${e.text}" → "${e.result}" (${e.duration}ms)`)
})

translator.events.on('error', (e) => {
  console.error(e.message)
})
```

### 工具函数

```ts
import {
  detectLanguage,
  getSupportedLanguages,
  ModelRouter,
} from '@translation-master/node'

// 语言检测
detectLanguage('你好世界') // { lang: 'zh', confidence: 0.8 }

// 支持的语言
const langs = getSupportedLanguages()
console.log(langs.map(l => l.code)) // ['en', 'zh', 'ja', 'ko', ...]
```

## 错误

| 错误 | 触发条件 |
|---|---|
| `UnsupportedLanguagePairError` | 没有模型支持该语言对 |
| `ModelLoadError` | 模型加载失败 |
| `TranslationTimeoutError` | 翻译超时 |
| `DeviceNotAvailableError` | 请求的设备不可用 |
| `OutOfMemoryError` | 内存不足以加载模型 |

## 架构

```
@translation-master/node
├── translator.ts   # Node Translator（继承 core，默认 CPU）
├── cache.ts        # FileCacheAdapter（基于文件系统）
└── env.ts          # isNode() 检测
```

### 继承关系

```
@translation-master/core  Translator
         │
         └── @translation-master/node  Translator
               ├── device 默认为 'cpu'（onnxruntime-node）
               └── transformersLoader 自动配置
```

## 许可证

[MIT](../../LICENSE) License
