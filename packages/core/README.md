# @translation-master/core

基于 [Transformers.js](https://huggingface.co/docs/transformers.js) 的运行时无关翻译核心。这是 `@translation-master/browser` 和 `@translation-master/node` 的共享基础。

## 安装

```bash
pnpm add @translation-master/core @huggingface/transformers
```

> 通常不直接使用此包。请使用 `@translation-master/browser` 或 `@translation-master/node`。

## 使用

```ts
import { Translator, detectLanguage, getSupportedLanguages } from '@translation-master/core'

// Core 需要显式传入 transformers loader
const translator = new Translator({
  transformersLoader: () => import('@huggingface/transformers'),
  device: 'wasm',
})

const result = await translator.translate('Hello world', { to: 'zh' })
console.log(result.text) // '你好，世界'

await translator.dispose()
```

## API

### `Translator`

```ts
new Translator(options?: TranslatorOptions)
```

**TranslatorOptions：**

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `device` | `'auto' \| 'wasm' \| 'webgpu' \| 'cpu'` | `'wasm'` | 推理后端 |
| `dtype` | `'fp32' \| 'fp16' \| 'q8' \| 'q4'` | 自动 | 量化精度 |
| `models` | `ModelConfig[]` | 内置 | 自定义模型配置 |
| `maxPoolSize` | `number` | `3` | 同时加载的最大模型数 |
| `autoDetect` | `boolean` | `true` | 自动检测源语言 |
| `modelBaseUrl` | `string` | - | 自定义模型文件基础 URL（CDN 或本地） |
| `debug` | `boolean` | `false` | 启用调试模式 |
| `transformersLoader` | `() => Promise<Transformers>` | - | Transformers.js 模块加载器（core 必填） |

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

### 工具函数

```ts
import {
  detectLanguage,
  getSupportedLanguages,
  normalizeLang,
  toFloresCode,
  fromFloresCode,
  distinguishZhVariant,
} from '@translation-master/core'

// 语言检测
detectLanguage('你好世界') // { lang: 'zh', confidence: 0.8 }

// 语言标准化（处理别名）
normalizeLang('English')  // 'en'
normalizeLang('Japanese') // 'ja'
normalizeLang('French')   // 'fr'

// FLORES 编码转换（NLLB 模型使用）
toFloresCode('zh')   // 'zho_Hans'
fromFloresCode('zho_Hans') // 'zh'

// 中文变体检测
distinguishZhVariant('國東車書') // 'zh-TW'（繁体）
distinguishZhVariant('国东车书') // 'zh-CN'（简体）
```

### 事件

```ts
translator.events.on('modelLoad', (e) => {
  console.log(e.modelId, e.progress, e.state)
})

translator.events.on('translate', (e) => {
  console.log(e.text, e.result, e.duration, e.cached)
})

translator.events.on('error', (e) => {
  console.error(e.message, e.cause)
})
```

### 自定义模型

```ts
const translator = new Translator({
  models: [
    {
      id: 'custom/my-model',
      type: 'opus-mt',
      pairs: [{ from: 'es', to: 'pt' }],
      priority: 0, // 数值越小优先级越高
    },
  ],
})
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
@translation-master/core
├── translator.ts       # 核心 Translator 类，TransformersLoader 模式
├── model-router.ts     # 语言对 → 模型解析（opus-mt / nllb）
├── model-pool.ts       # 共享模型池，引用计数 & LRU 淘汰
├── cache.ts            # 内存 LRU 翻译结果缓存
├── lang.ts             # 语言检测、标准化、FLORES 编码
├── event-emitter.ts    # 类型化事件系统（modelLoad, translate, error, domTranslate）
├── errors.ts           # 类型化错误类
└── types.ts            # 所有共享接口
```

## 许可证

[MIT](../../LICENSE) License
