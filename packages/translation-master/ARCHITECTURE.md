# translation-master 技术架构文档

> 基于 Transformers.js 的纯前端 WASM 翻译库技术方案

## 1. 目标与约束

### 1.1 核心目标

- 纯前端运行，无服务端依赖（模型文件可由 CDN 托管）
- 支持热门语种互相转译：简体中文、繁体中文、英文、日文、韩文等
- 首次加载后可离线使用（模型缓存到浏览器）
- 与现有 `vite-plugin-translate` 生态兼容，可作为高级翻译引擎接入

### 1.2 技术约束

| 约束项 | 说明 |
|--------|------|
| 运行环境 | 现代浏览器（Chrome 90+, Firefox 90+, Safari 16+, Edge 90+） |
| 构建工具 | tsdown（与 monorepo 一致） |
| 包管理 | pnpm workspace |
| 语言 | TypeScript (ESNext) |
| 核心依赖 | `@huggingface/transformers` v3.x |

---

## 2. 模型选型策略

### 2.1 候选模型对比

| 模型 | 参数量 | 模型体积 | 支持语种 | 质量 (BLEU) | 许可证 | 适用场景 |
|------|--------|----------|----------|-------------|--------|----------|
| `Xenova/opus-mt-zh-en` | ~75M | ~60MB | zh→en | 36.1 | Apache-2.0 | 中→英 |
| `Xenova/opus-mt-en-zh` | ~75M | ~60MB | en→zh | ~30 | Apache-2.0 | 英→中 |
| `Xenova/nllb-200-distilled-600M` | 600M | ~1.2GB | 196 语种 | 较高 | CC-BY-NC-4.0 | 多语种互译 |
| `Xenova/m2m100_418M` | 418M | ~800MB | 100 语种 | 中等 | MIT | 多语种互译 |

### 2.2 推荐方案：分层模型架构

采用 **opus-mt 为主 + nllb-200 兜底** 的双层策略：

```
┌─────────────────────────────────────────────────┐
│                 Translator API                   │
├─────────────────────────────────────────────────┤
│              模型路由器 (ModelRouter)              │
│         根据 (source, target) 选择模型             │
├──────────────────┬──────────────────────────────┤
│   Tier 1: 快速通道 │      Tier 2: 通用通道         │
│   opus-mt 系列     │      nllb-200-distilled      │
│   ~60MB/模型       │      ~1.2GB（一次性）          │
│   质量：中等偏上     │      质量：较高                │
│   覆盖：热门语种对   │      覆盖：196 语种            │
└──────────────────┴──────────────────────────────┘
```

**Tier 1（快速通道）** — 热门语种对使用 opus-mt 专用模型，体积小、加载快：

| 语言对 | 模型 ID | 体积 |
|--------|---------|------|
| 简中 → 英文 | `Xenova/opus-mt-zh-en` | ~60MB |
| 英文 → 简中 | `Xenova/opus-mt-en-zh` | ~60MB |

**Tier 2（通用通道）** — opus-mt 不覆盖的语言对，回退到 nllb-200：

| 语言对 | 模型 ID | 语言代码映射 |
|--------|---------|-------------|
| 简中 ↔ 繁中 | `Xenova/nllb-200-distilled-600M` | `zho_Hans` ↔ `zho_Hant` |
| 日文 → 英文 | 同上 | `jpn_Jpan` → `eng_Latn` |
| 韩文 → 英文 | 同上 | `kor_Hang` → `eng_Latn` |
| 任意 ↔ 任意 | 同上 | FLORES-200 代码 |

### 2.3 语言代码映射表

```typescript
// 用户友好的语言代码 → FLORES-200 语言代码
const LANG_TO_FLORES: Record<string, string> = {
  'zh':     'zho_Hans',  // 简体中文
  'zh-CN':  'zho_Hans',
  'zh-TW':  'zho_Hant',  // 繁体中文
  'zh-HK':  'zho_Hant',
  'yue':    'yue_Hant',  // 粤语
  'en':     'eng_Latn',  // 英文
  'ja':     'jpn_Jpan',  // 日文
  'ko':     'kor_Hang',  // 韩文
  'fr':     'fra_Latn',  // 法文
  'de':     'deu_Latn',  // 德文
  'es':     'spa_Latn',  // 西班牙文
  'ru':     'rus_Cyrl',  // 俄文
  'ar':     'arb_Arab',  // 阿拉伯文
  'pt':     'por_Latn',  // 葡萄牙文
  'it':     'ita_Latn',  // 意大利文
  'th':     'tha_Thai',  // 泰文
  'vi':     'vie_Latn',  // 越南文
  'id':     'ind_Latn',  // 印尼文
  'ms':     'zsm_Latn',  // 马来文
  // ... 可扩展到 196 语种
}
```

---

## 3. 整体架构

### 3.1 模块结构

```
packages/translation-master/
├── src/
│   ├── index.ts              # 入口，导出公共 API
│   ├── translator.ts         # 核心翻译器类
│   ├── model-router.ts       # 模型路由器
│   ├── model-pool.ts         # 模型实例池（管理多模型生命周期）
│   ├── cache.ts              # 缓存策略层
│   ├── lang.ts               # 语言代码映射与检测
│   ├── types.ts              # 类型定义
│   └── env.ts                # 环境检测与配置
├── docs/
│   └── ARCHITECTURE.md       # 本文档
├── package.json
├── tsconfig.json
└── tsdown.config.ts
```

### 3.2 分层架构图

```
┌──────────────────────────────────────────────────────────────┐
│                       用户调用层                               │
│                                                              │
│  translator.translate('你好', { from: 'zh', to: 'en' })     │
│  translator.translateDOM(element, { to: 'en' })              │
│  translator.detect('Hello')                                  │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     Translator 核心层                          │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ TextTranslate│  │ DOMTranslate │  │ LanguageDetector     │  │
│  │ 文本翻译      │  │ DOM 翻译     │  │ 语言检测             │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────┘  │
│         │                │                     │              │
│         └────────────────┼─────────────────────┘              │
│                          │                                    │
│              ┌───────────▼───────────┐                        │
│              │     ModelRouter       │                        │
│              │  根据语言对选择最优模型   │                        │
│              └───────────┬───────────┘                        │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     模型管理层                                 │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  ModelPool    │  │  ModelLoader  │  │  CacheManager       │ │
│  │  模型实例池    │  │  模型加载器    │  │  缓存管理            │ │
│  │  · 生命周期    │  │  · 按需加载    │  │  · Cache API        │ │
│  │  · LRU 淘汰   │  │  · 进度回调    │  │  · 预下载           │ │
│  │  · 并发控制    │  │  · 错误重试    │  │  · 版本管理         │ │
│  └──────────────┘  └──────────────┘  └─────────────────────┘ │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                   Transformers.js 底层                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  Pipeline     │  │  AutoTokenizer│  │  ONNX Runtime       │ │
│  │  translation  │  │  分词器        │  │  · WASM (默认)      │ │
│  │  任务          │  │              │  │  · WebGPU (可选)    │ │
│  └──────────────┘  └──────────────┘  │  · WebNN (实验)     │ │
│                                      └─────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 核心模块设计

### 4.1 Translator — 核心翻译器

```typescript
interface TranslatorOptions {
  /** 后端设备，默认 'auto'（优先 WebGPU，回退 WASM） */
  device?: 'auto' | 'wasm' | 'webgpu'

  /** 量化精度，默认 'q8' */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4'

  /** 模型来源，默认使用内置模型列表，可自定义 */
  models?: ModelConfig[]

  /** 最大同时加载的模型数，默认 3 */
  maxPoolSize?: number

  /** 模型加载进度回调 */
  onModelLoadProgress?: (event: ModelLoadProgress) => void

  /** 是否自动检测语言，默认 true */
  autoDetect?: boolean

  /** 自定义缓存实现 */
  cache?: CacheAdapter
}

interface TranslateOptions {
  from?: string           // 源语言，省略则自动检测
  to: string              // 目标语言（必填）
  dtype?: string          // 覆盖默认量化精度
  signal?: AbortSignal    // 取消信号
}

interface TranslateResult {
  text: string            // 译文
  from: string            // 检测到的源语言
  to: string              // 目标语言
  model: string           // 使用的模型 ID
  duration: number        // 耗时 (ms)
  confidence?: number     // 语言检测置信度
}
```

**核心类设计：**

```typescript
class Translator {
  private router: ModelRouter
  private pool: ModelPool
  private cache: CacheManager

  constructor(options?: TranslatorOptions)

  /** 文本翻译 */
  async translate(text: string, options: TranslateOptions): Promise<TranslateResult>

  /** 批量翻译 */
  async translateBatch(
    texts: string[],
    options: TranslateOptions
  ): Promise<TranslateResult[]>

  /** 检测语言 */
  async detect(text: string): Promise<{ lang: string; confidence: number }>

  /** 预加载指定语言对的模型 */
  preload(from: string, to: string): Promise<void>

  /** 获取支持的语言列表 */
  getSupportedLanguages(): LanguageInfo[]

  /** 释放指定模型 */
  unload(from: string, to: string): Promise<void>

  /** 释放所有模型 */
  dispose(): Promise<void>
}
```

### 4.2 ModelRouter — 模型路由器

职责：根据 (source, target) 语言对，选择最优的模型。

```typescript
interface ModelConfig {
  id: string                           // HuggingFace 模型 ID
  type: 'opus-mt' | 'nllb' | 'm2m100' | 'custom'
  pairs: Array<{ from: string; to: string }>
  priority: number                     // 优先级，数值越小越优先
  requiresLangPrefix?: boolean         // nllb/m2m100 需要 src_lang/tgt_lang
  langCodeMap?: Record<string, string> // 自定义语言代码映射
}

class ModelRouter {
  private configs: ModelConfig[]

  /** 注册模型配置 */
  register(config: ModelConfig): void

  /**
   * 根据语言对查找最优模型
   * 选择逻辑：
   * 1. 精确匹配 (from, to) 的 opus-mt 模型 → Tier 1
   * 2. 回退到 nllb-200 通用模型 → Tier 2
   * 3. 都没有 → 抛出 UnsupportedLanguagePairError
   */
  resolve(from: string, to: string): ResolvedModel

  /** 获取语言对的翻译路径（支持中转翻译） */
  resolvePath(from: string, to: string): ResolvedModel[]
}
```

**路由决策流程：**

```
translate('你好', { from: 'zh', to: 'en' })
    │
    ▼
┌─ ModelRouter.resolve('zh', 'en') ──────────────────┐
│                                                     │
│  1. 查找精确匹配: opus-mt-zh-en ✓                   │
│     → 返回 { modelId: 'Xenova/opus-mt-zh-en' }     │
│                                                     │
│  2. 若无精确匹配: 回退 nllb-200                      │
│     → 返回 {                                          │
│         modelId: 'Xenova/nllb-200-distilled-600M',  │
│         src_lang: 'zho_Hans',                        │
│         tgt_lang: 'eng_Latn'                         │
│       }                                              │
│                                                     │
│  3. 若目标语言不在 nllb 支持范围:                      │
│     → 尝试中转路径: zh → en → target                  │
│     → 抛出 UnsupportedLanguagePairError              │
└─────────────────────────────────────────────────────┘
```

### 4.3 ModelPool — 模型实例池

管理多个 pipeline 实例的生命周期，防止内存溢出。

```typescript
class ModelPool {
  private pool: Map<string, PoolEntry>
  private maxSize: number        // 最大实例数，默认 3
  private accessOrder: string[]  // LRU 淘汰队列

  /** 获取或创建 pipeline 实例 */
  async acquire(modelId: string, options: PipelineOptions): Promise<Pipeline>

  /** 释放指定模型 */
  release(modelId: string): Promise<void>

  /** 释放所有模型 */
  dispose(): Promise<void>

  /** 获取当前池状态 */
  stats(): PoolStats
}

interface PoolEntry {
  pipeline: Pipeline
  refCount: number
  lastAccess: number
  loading: Promise<Pipeline> | null  // 正在加载中的 Promise（防重复加载）
}

interface PoolStats {
  active: number       // 已加载的模型数
  loading: number      // 正在加载的模型数
  maxSize: number      // 最大容量
  models: Array<{
    id: string
    refCount: number
    lastAccess: number
  }>
}
```

**关键设计：**

- **LRU 淘汰**：池满时淘汰最久未使用的模型，释放内存
- **引用计数**：同一模型被多个翻译请求共享，引用计数归零后可被淘汰
- **防重复加载**：多个请求同时加载同一模型时，共用同一个 Promise
- **加载锁**：`acquire()` 内部使用 Promise 缓存，保证同一模型只触发一次 `pipeline()` 调用

### 4.4 CacheManager — 缓存管理

在 Transformers.js 内置 Cache API 之上，增加业务层缓存控制。

```typescript
interface CacheAdapter {
  get(key: string): Promise<ArrayBuffer | null>
  set(key: string, data: ArrayBuffer): Promise<void>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

class CacheManager {
  /** 预下载模型文件到浏览器缓存 */
  async prefetchModel(modelId: string): Promise<void>

  /** 检查模型是否已缓存 */
  async isModelCached(modelId: string): Promise<boolean>

  /** 获取缓存大小 */
  async getCacheSize(): Promise<{ total: number; byModel: Record<string, number> }>

  /** 清除指定模型缓存 */
  async clearModel(modelId: string): Promise<void>

  /** 清除所有模型缓存 */
  async clearAll(): Promise<void>
}
```

**缓存层级：**

```
┌─────────────────────────────────────────────┐
│ Layer 1: Transformers.js 内置缓存            │
│ · Cache API (浏览器) / Filesystem (Node)     │
│ · 自动缓存模型权重、tokenizer、config         │
│ · 由 env.useBrowserCache 控制                │
├─────────────────────────────────────────────┤
│ Layer 2: Translator 业务缓存                 │
│ · 管理预下载、缓存清理、容量查询               │
│ · 可选的自定义 CacheAdapter                   │
│ · 翻译结果短期缓存（可选，LRU）               │
└─────────────────────────────────────────────┘
```

### 4.5 LangDetector — 语言检测

```typescript
class LangDetector {
  /**
   * 检测文本语言
   * 策略：
   * 1. 基于 Unicode 范围的启发式检测（快速，零成本）
   * 2. 可选：使用 Transformers.js 的 text-classification pipeline（更准，需加载模型）
   */
  detect(text: string): { lang: string; confidence: number }

  /**
   * 启用基于模型的高精度检测
   * 模型: papluca/xlm-roberta-base-language-detection (~560MB)
   * 通常不需要，启发式检测对热门语种已足够
   */
  enableModelDetection(): Promise<void>
}
```

**启发式检测规则（零成本，覆盖 95% 场景）：**

| Unicode 范围 | 语言 |
|--------------|------|
| `一-鿿` | 简体中文 |
| `㐀-䶿` | 繁体中文（扩展 A） |
| `぀-ゟ` | 日文平假名 |
| `゠-ヿ` | 日文片假名 |
| `가-힯` | 韩文 |
| `Ѐ-ӿ` | 俄文 |
| `؀-ۿ` | 阿拉伯文 |
| `฀-๿` | 泰文 |
| Latin 基础范围 | 英文/法文/德文/...（需词频辅助） |

**简繁区分策略：**

```typescript
// 简体特有字符
const SIMPLIFIED_CHARS = new Set('国东车书学门问题...')
// 繁体特有字符
const TRADITIONAL_CHARS = new Set('國東車書學門問題...')

function distinguishZhVariant(text: string): 'zh-CN' | 'zh-TW' {
  let simplified = 0
  let traditional = 0
  for (const char of text) {
    if (SIMPLIFIED_CHARS.has(char)) simplified++
    if (TRADITIONAL_CHARS.has(char)) traditional++
  }
  return simplified >= traditional ? 'zh-CN' : 'zh-TW'
}
```

---

## 5. 运行时流程

### 5.1 首次翻译流程

```
用户调用: translator.translate('你好世界', { to: 'en' })
    │
    ▼
┌─ 1. 语言检测 ──────────────────────┐
│  LangDetector.detect('你好世界')     │
│  → { lang: 'zh', confidence: 1.0 } │
└─────────────┬──────────────────────┘
              │
              ▼
┌─ 2. 模型路由 ──────────────────────────────────┐
│  ModelRouter.resolve('zh', 'en')               │
│  → { modelId: 'Xenova/opus-mt-zh-en' }        │
└─────────────┬──────────────────────────────────┘
              │
              ▼
┌─ 3. 模型获取 ──────────────────────────────────┐
│  ModelPool.acquire('Xenova/opus-mt-zh-en')     │
│  → 缓存未命中，触发加载                          │
│  → onModelLoadProgress 回调进度事件              │
│  → 创建 pipeline('translation', modelId)        │
│  → 存入池中，返回 pipeline                       │
└─────────────┬──────────────────────────────────┘
              │
              ▼
┌─ 4. 执行翻译 ──────────────────────────────────┐
│  pipeline('你好世界')                            │
│  → { translation_text: 'Hello World' }         │
└─────────────┬──────────────────────────────────┘
              │
              ▼
┌─ 5. 返回结果 ──────────────────────────────────┐
│  {                                              │
│    text: 'Hello World',                         │
│    from: 'zh',                                  │
│    to: 'en',                                    │
│    model: 'Xenova/opus-mt-zh-en',               │
│    duration: 1234                               │
│  }                                              │
└─────────────────────────────────────────────────┘
```

### 5.2 后续翻译流程（模型已缓存）

```
translate('今天天气很好', { to: 'en' })
    │
    ▼
  1. detect → 'zh'
  2. route  → 'Xenova/opus-mt-zh-en'
  3. pool.acquire → 命中池中已有实例（跳过加载）
  4. pipeline('今天天气很好')
  5. → { text: 'The weather is nice today', ... }
```

耗时：步骤 3-4 约 50-200ms（取决于文本长度和设备性能）

---

## 6. WebGPU 降级策略

```typescript
async function resolveDevice(requested: 'auto' | 'wasm' | 'webgpu'): Promise<string> {
  if (requested !== 'auto') return requested

  // 1. 检测 WebGPU 可用性
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {}
  }

  // 2. 回退到 WASM（所有现代浏览器都支持）
  return 'wasm'
}
```

**设备选择决策树：**

```
device: 'auto'
    │
    ├─ WebGPU 可用? ─── Yes ──→ device: 'webgpu' (GPU 加速)
    │
    └─ No ──→ device: 'wasm' (CPU, 兼容所有浏览器)
```

**WebGPU 特性检测细节：**

```typescript
async function isWebGPUAvailable(): Promise<boolean> {
  if (!navigator.gpu) return false
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}
```

---

## 7. 内存管理策略

### 7.1 模型内存占用估算

| 模型 | 加载后内存占用 | 说明 |
|------|--------------|------|
| opus-mt (q8) | ~80-120MB | 模型权重 + ONNX Runtime 上下文 |
| opus-mt (q4) | ~50-70MB | 量化后更小 |
| nllb-200-600M (q8) | ~800MB-1GB | 大模型，谨慎加载 |
| nllb-200-600M (q4) | ~500-600MB | 量化后可接受 |

### 7.2 内存控制策略

```typescript
class ModelPool {
  private maxPoolSize = 3       // 默认最多 3 个模型同时在内存
  private maxMemoryMB = 1024    // 默认最大 1GB 内存（可配置）

  async acquire(modelId: string): Promise<Pipeline> {
    // 检查池是否已满
    while (this.pool.size >= this.maxPoolSize) {
      const victim = this.findLRU()
      if (victim && victim.refCount === 0) {
        await this.evict(victim)
      } else {
        break // 所有模型都在使用中，无法淘汰
      }
    }

    // 加载模型
    return this.load(modelId)
  }
}
```

### 7.3 大模型特殊处理

当用户请求的语言对需要 nllb-200（~1.2GB）时：

```typescript
async function handleLargeModel(modelId: string): Promise<void> {
  // 1. 提示用户
  console.warn(`模型 ${modelId} 体积较大（~1.2GB），首次加载需要较长时间`)

  // 2. 可选：释放其他模型腾出内存
  await this.pool.evictAll()

  // 3. 使用更激进的量化
  return pipeline('translation', modelId, { dtype: 'q4' })
}
```

---

## 8. 错误处理

### 8.1 错误类型定义

```typescript
/** 不支持的语言对 */
class UnsupportedLanguagePairError extends Error {
  constructor(from: string, to: string) {
    super(`Unsupported language pair: ${from} → ${to}`)
    this.name = 'UnsupportedLanguagePairError'
    this.from = from
    this.to = to
  }
}

/** 模型加载失败 */
class ModelLoadError extends Error {
  constructor(modelId: string, cause: Error) {
    super(`Failed to load model "${modelId}": ${cause.message}`)
    this.name = 'ModelLoadError'
    this.modelId = modelId
    this.cause = cause
  }
}

/** 翻译超时 */
class TranslationTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Translation timed out after ${timeout}ms`)
    this.name = 'TranslationTimeoutError'
  }
}

/** 设备不支持 */
class DeviceNotAvailableError extends Error {
  constructor(device: string) {
    super(`Device "${device}" is not available in this environment`)
    this.name = 'DeviceNotAvailableError'
  }
}

/** 内存不足 */
class OutOfMemoryError extends Error {
  constructor(modelId: string) {
    super(`Insufficient memory to load model "${modelId}"`)
    this.name = 'OutOfMemoryError'
  }
}
```

### 8.2 错误处理策略

| 错误场景 | 处理策略 |
|----------|----------|
| WebGPU 不可用 | 自动降级到 WASM |
| 模型下载失败 | 重试 3 次，间隔指数退避 |
| 模型加载超时 | 抛出 TranslationTimeoutError |
| 内存不足 | 淘汰 LRU 模型后重试 |
| 不支持的语言对 | 抛出 UnsupportedLanguagePairError |
| 网络离线 | 若模型已缓存则正常工作，否则抛出错误 |

---

## 9. 性能优化

### 9.1 模型预加载

```typescript
// 用户可选择预加载常用语言对
await translator.preload('zh', 'en')  // 预加载中→英模型
await translator.preload('en', 'zh')  // 预加载英→中模型

// 或在页面空闲时预加载
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => translator.preload('zh', 'en'))
}
```

### 9.2 翻译结果缓存（可选）

```typescript
class TranslationCache {
  private cache = new Map<string, { result: string; timestamp: number }>()
  private maxSize = 1000
  private ttl = 5 * 60 * 1000  // 5 分钟

  get(text: string, from: string, to: string): string | null {
    const key = `${from}:${to}:${text}`
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }
    return entry.result
  }
}
```

### 9.3 批量翻译优化

```typescript
// 对于多段文本，复用同一 pipeline 实例，减少上下文切换开销
async translateBatch(texts: string[], options: TranslateOptions) {
  const resolved = this.router.resolve(from, to)
  const pipe = await this.pool.acquire(resolved.modelId)

  // 串行执行（pipeline 内部已优化），避免内存峰值
  const results = []
  for (const text of texts) {
    results.push(await pipe(text, pipeOptions))
  }
  return results
}
```

### 9.4 Web Worker 支持

将推理过程移到 Worker 线程，避免阻塞主线程：

```typescript
// main.ts
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

worker.postMessage({ type: 'translate', text: '你好', from: 'zh', to: 'en' })
worker.onmessage = (e) => {
  console.log(e.data) // { text: 'Hello', ... }
}

// worker.ts
import { Translator } from './translator'
const translator = new Translator()

self.onmessage = async (e) => {
  const { text, from, to } = e.data
  const result = await translator.translate(text, { from, to })
  self.postMessage(result)
}
```

> **注意：** Transformers.js 在 Worker 中运行时，Cache API 不可用（Worker 中无 `caches` 全局对象）。需要使用 `env.useCustomCache` 或 Service Worker 代理缓存。

---

## 10. 与 vite-plugin-translate 集成

### 10.1 集成方式

`translation-master` 包作为独立的翻译引擎，`vite-plugin-translate` 可选择使用它：

```typescript
// vite-plugin-translate 的新配置项
interface PluginOptions {
  // ...现有配置
  engine?: 'translate.js' | 'translation-master'  // 翻译引擎选择
  translatorOptions?: TranslatorOptions   // translation-master 引擎配置
}
```

### 10.2 渐进迁移路径

```
Phase 1: translation-master 作为独立包发布
    → 用户可直接 import { Translator } from 'translation-master'
    → 与 vite-plugin-translate 无耦合

Phase 2: vite-plugin-translate 增加 engine 选项
    → engine: 'translate.js' (默认，现有行为)
    → engine: 'translation-master' (新 WASM 引擎)

Phase 3: 统一 API 抽象
    → 定义通用 TranslateEngine 接口
    → translate.js 和 translation-master 均实现该接口
```

---

## 11. 构建与发布

### 11.1 package.json

```json
{
  "name": "translation-master",
  "version": "0.0.1",
  "description": "Pure frontend WASM translation library powered by Transformers.js",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./worker": {
      "import": "./dist/worker.mjs"
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.cts",
  "files": ["dist"],
  "sideEffects": false,
  "dependencies": {
    "@huggingface/transformers": "^3.8.0"
  },
  "peerDependencies": {},
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "lint": "eslint",
    "test": "vitest",
    "typecheck": "tsc"
  }
}
```

### 11.2 tsdown 配置

```typescript
// tsdown.config.ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/worker.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // 不打包 @huggingface/transformers，作为 external 依赖
  external: ['@huggingface/transformers'],
})
```

---

## 12. 公共 API 导出

```typescript
// src/index.ts
export { Translator } from './translator'
export type {
  TranslatorOptions,
  TranslateOptions,
  TranslateResult,
  ModelConfig,
  LanguageInfo,
  ModelLoadProgress,
  CacheAdapter,
} from './types'

export {
  UnsupportedLanguagePairError,
  ModelLoadError,
  TranslationTimeoutError,
} from './errors'
```

**使用示例：**

```typescript
import { Translator } from 'translation-master'

const translator = new Translator({
  device: 'auto',
  dtype: 'q8',
  maxPoolSize: 3,
  onModelLoadProgress: (event) => {
    console.log(`加载模型: ${event.progress}%`)
  },
})

// 简单翻译
const result = await translator.translate('你好世界', { to: 'en' })
console.log(result.text) // "Hello World"

// 指定源语言
const result2 = await translator.translate('Hello World', {
  from: 'en',
  to: 'zh-TW',
})

// 批量翻译
const results = await translator.translateBatch(
  ['你好', '世界', '天气'],
  { to: 'en' }
)

// 预加载（页面空闲时）
translator.preload('zh', 'en')

// 清理
await translator.dispose()
```

---

## 13. 测试策略

| 层级 | 测试内容 | 工具 |
|------|----------|------|
| 单元测试 | 语言检测、模型路由、缓存逻辑 | vitest |
| 集成测试 | 完整翻译流程（Node.js 环境） | vitest + onnxruntime-node |
| 浏览器测试 | WASM/WebGPU 后端、Cache API | vitest + playwright |
| 性能基准 | 翻译延迟、内存占用、模型加载时间 | 自定义 benchmark |

**关键测试用例：**

```typescript
describe('Translator', () => {
  it('zh → en 翻译', async () => {
    const result = await translator.translate('你好', { to: 'en' })
    expect(result.text).toMatch(/hello/i)
    expect(result.from).toBe('zh')
  })

  it('自动检测语言', async () => {
    const result = await translator.translate('Hello', { to: 'zh' })
    expect(result.from).toBe('en')
  })

  it('简繁区分', async () => {
    const result = await translator.translate('國', { to: 'zh' })
    expect(result.from).toBe('zh-TW')
  })

  it('不支持的语言对抛出错误', async () => {
    await expect(
      translator.translate('test', { from: 'xx', to: 'yy' })
    ).rejects.toThrow(UnsupportedLanguagePairError)
  })

  it('取消翻译', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)
    await expect(
      translator.translate('很长的文本...', { to: 'en', signal: controller.signal })
    ).rejects.toThrow()
  })
})
```

---

## 14. 已知限制与风险

| 风险项 | 影响 | 缓解方案 |
|--------|------|----------|
| opus-mt 翻译质量中等 | 不如商业翻译 API | 文档明确说明适用场景；后续可接入更高质量模型 |
| nllb-200 模型体积大 (~1.2GB) | 首次加载慢，内存占用高 | 默认不加载；使用 q4 量化压缩；明确提示用户 |
| nllb-200 许可证 CC-BY-NC-4.0 | 仅限非商业用途 | 商业场景需使用 opus-mt 或 m2m100 |
| Safari WebGPU 支持不完整 | Safari 用户只能用 WASM | 自动降级，WASM 性能对翻译模型已足够 |
| 简繁区分依赖启发式 | 特定文本可能误判 | 可选启用模型检测；用户可手动指定 from |
| 模型文件跨域 | HuggingFace CDN 可能在某些地区不可用 | 支持自定义模型路径/CDN |
| Worker 环境无 Cache API | 模型无法在 Worker 中缓存 | 使用 Service Worker 代理或主线程缓存 |

---

## 15. 后续演进

| 阶段 | 内容 |
|------|------|
| v0.1 | 核心翻译功能：opus-mt 中英互译 + 基础 API |
| v0.2 | nllb-200 通用模型支持 + 简繁互转 |
| v0.3 | Web Worker 支持 + 模型预加载 + 缓存管理 |
| v0.4 | 与 vite-plugin-translate 集成 |
| v1.0 | 稳定 API + 性能优化 + 文档完善 |
| 未来 | 自定义微调模型支持 / WebNN 后端 / DOM 整体翻译 |
