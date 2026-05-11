# @translation-master/i18n-migrate-cli

源码级 i18n 迁移 CLI。扫描前端项目源码，提取指定源语言文本，生成可人工校对的映射文件，再把已确认的译文安全回写到源文件。

适合需要快速把现有项目迁移到另一种界面语言，但暂时不想大规模改造为 `t()` / locale 文件的场景。

## 安装

```bash
pnpm add -D @translation-master/i18n-migrate-cli @huggingface/transformers
```

安装后会提供 `tmigrate` 命令。

```bash
pnpm exec tmigrate --help
```

## 快速开始

```bash
# 1. 初始化 .tmigrate 配置目录
pnpm exec tmigrate init

# 1.5. 可选：初始化内置高频词库，减少机器翻译误译
pnpm exec tmigrate glossary init --preset all

# 2. 扫描源码并生成 .tmigrate/maps 分片映射
pnpm exec tmigrate scan src --to en

# 3. 校对 .tmigrate/maps 下的翻译条目，再批量标记为 approved: true
pnpm exec tmigrate approve

# 3.5. 先统计当前进度，看看还差什么
pnpm exec tmigrate stats

# 4. 预览回写 diff
pnpm exec tmigrate apply --dry-run

# 5. 写回源文件
pnpm exec tmigrate apply

# 6. 如需回滚，从自动备份恢复
pnpm exec tmigrate restore
```

## 工作流

`tmigrate` 采用两阶段流程，避免机器翻译结果直接污染源文件：

1. `scan` 扫描源码，提取源语言文本，结合术语表和翻译器生成 `.tmigrate/maps/**/*.json`。
2. 开发者校对映射文件，修改 `translation`，并通过 `approve` 将确认过的条目标记为 `approved: true`。
3. `apply` 只回写 `approved: true` 且未标记 `skip` 的条目。
4. `apply` 写入前会备份原文件到 `.tmigrate/backups/`，可用 `restore` 回滚。

## 命令

### `init`

创建 `.tmigrate/` 目录、默认配置和术语表。

```bash
tmigrate init
tmigrate init --yes
tmigrate init --from zh --to en
tmigrate init --from en --to zh --no-overwrite
```

常用选项：

| 选项 | 说明 |
|---|---|
| `--interactive` | 强制通过终端问答生成配置 |
| `--yes` | 跳过提示，直接使用默认配置 |
| `--from <locale>` | 源语言，如 `zh`、`en` |
| `--to <locale>` | 目标语言，如 `en`、`zh` |
| `--no-overwrite` | 只创建缺失文件，不覆盖已有配置 |

### `scan`

扫描源码并写入 `.tmigrate/maps/`。

```bash
tmigrate scan src
tmigrate scan src/modules/order --to en
tmigrate scan src --incremental
tmigrate scan src --incremental --clean-deprecated
```

常用选项：

| 选项 | 说明 |
|---|---|
| `[path]` | 要扫描的文件或目录，默认使用配置中的 include |
| `--to <locale>` | 覆盖配置里的目标语言 |
| `--incremental` | 只扫描 hash 发生变化的文件 |
| `--clean-deprecated` | 清理已废弃条目 |

### `glossary init`

把内置高频词库合并到 `.tmigrate/glossary.json`。默认使用项目配置里的 `sourceLocale` / `targetLocale`，目前内置支持 `zh -> en` 和 `en -> zh`。

```bash
tmigrate glossary init
tmigrate glossary init --preset business
tmigrate glossary init --preset all --dry-run
tmigrate glossary init --from en --to zh --preset ui
tmigrate glossary init --preset all --overwrite
```

常用选项：

| 选项 | 说明 |
|---|---|
| `--preset <name>` | 内置词库：`ui`、`business`、`all`，默认 `ui` |
| `--from <locale>` | 覆盖源语言，如 `zh`、`en` |
| `--to <locale>` | 覆盖目标语言，如 `en`、`zh` |
| `--dry-run` | 只预览新增/更新/跳过数量，不写入文件 |
| `--overwrite` | 覆盖已有冲突词条；默认保留现有人工词条 |

### `apply`

把映射文件中已确认的译文回写到源文件。

```bash
tmigrate apply --dry-run
tmigrate apply --path src/views/Login.vue --dry-run
tmigrate apply --path src/modules/order
tmigrate apply
```

常用选项：

| 选项 | 说明 |
|---|---|
| `--dry-run` | 只打印 diff，不写入文件 |
| `--path <path>` | 只处理指定文件或目录 |

执行时会显示阶段式进度提示：准备中、扫描可回写文件、逐个处理文件、写入源文件。

#### 回写转义策略

`apply` 回写的是源码片段，不是纯文本替换。CLI 会根据文本所在上下文对译文重新编码，避免译文里的特殊字符破坏目标文件语法。

例如源代码中有：

```ts
const title = '账号安全'
```

如果映射文件里的译文是 `Account's secure.`，回写结果会是：

```ts
const title = 'Account\'s secure.'
```

当前会按上下文处理以下风险：

| 上下文 | 处理方式 |
|---|---|
| TS/JS/Vue script 字符串 | 按外层 `'`、`"`、`` ` `` 转义引号、反斜杠、换行和模板字符串反引号 |
| JSON string value | 使用 JSON 字符串编码，保护引号、反斜杠和控制字符 |
| HTML/Vue template 文本 | 转义 `&`、`<`，避免译文被当作标签或实体 |
| HTML 属性 | 在文本转义基础上按属性引号转义 `'` 或 `"` |
| CSS/SCSS/Less `content` | 转义引号、反斜杠和换行 |
| YAML value | 保留已有引号风格；无引号值会写成 JSON 风格双引号标量，避免 `:`、`#`、换行等破坏 YAML |

### `approve`

批量把 `.tmigrate/maps/` 中可回写的译文标记为 `approved: true`，适合大型项目在人工抽检或统一信任机器翻译后批量放行。

```bash
tmigrate approve --dry-run
tmigrate approve --path src/views/Login.vue
tmigrate approve --path src/modules/order
tmigrate approve
```

默认只批准有 `translation`、未标记 `skip`、未标记 `deprecated` 的条目，避免误回写空译文或废弃文案。

常用选项：

| 选项 | 说明 |
|---|---|
| `--dry-run` | 只统计将批准的条目，不写入 map 文件 |
| `--path <path>` | 只处理指定源文件或目录对应的 map |
| `--include-skipped` | 也批准 `skip: true` 的条目 |
| `--include-deprecated` | 也批准 `deprecated: true` 的条目 |
| `--allow-empty` | 也批准空译文条目 |

执行时会显示阶段式进度提示：准备中、扫描 map 文件、逐个处理条目、写入结果。

### `stats`

统计 `.tmigrate/maps/` 的翻译进度，帮助快速看出当前做了什么、还需要做什么。

```bash
tmigrate stats
tmigrate stats src/views/Login.vue
tmigrate stats src/modules/order
```

输出是面向总览的仪表盘，不会默认展开所有 map 文件明细。常见区块包括：

- **总览**：map 总数、可读/损坏数量、当前/孤儿 map、当前条目和风险提示。
- **迁移进度**：译文覆盖率、已批准比例、可回写比例，并用进度条展示。
- **工作队列**：可回写、待校对、待补译、已跳过、已废弃的条目数和占比。
- **译文来源**：glossary / machine / manual 的来源分布。
- **重点文件 Top 5**：只列待补译、待校对或废弃条目最多的文件，避免大项目刷屏。
- **孤儿/损坏 Top 5**：只展示最需要清理或修复的异常 map 文件。
- **建议**：根据当前队列给出补译、校对、回写、清理等建议。

说明：统计口径是 map 条目数，不是源码中的文本出现次数。

### `restore`

从 `.tmigrate/backups/` 恢复 `apply` 前的源文件。

```bash
tmigrate restore --list
tmigrate restore --path src/views/Login.vue
tmigrate restore
```

常用选项：

| 选项 | 说明 |
|---|---|
| `--list` | 列出可恢复的备份 |
| `--path <path>` | 只恢复指定文件 |

执行时会显示阶段式进度提示：准备中、扫描可恢复备份、逐个恢复文件、写入完成。

## 配置

`.tmigrate/config.json` 示例：

```jsonc
{
  "sourceLocale": "zh",
  "targetLocale": "en",
  "include": ["src/**/*.{vue,ts,tsx,js,jsx,json,html,css,scss,less,md,yaml,yml}"],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/i18n/**"
  ],
  "rules": [
    { "type": "skip-context", "value": "console" },
    { "type": "skip-context", "value": "comment" },
    { "type": "skip-context", "value": "enum" },
    { "type": "skip-context", "value": "test" },
    { "type": "skip-pattern", "value": "^[\\d\\s]+$" },
    { "type": "skip-pattern", "value": "^[a-zA-Z]" },
    { "type": "min-length", "value": 2 }
  ],
  "translator": "local",
  "translatorOptions": {
    "modelBaseUrl": "https://cdn.example.com/models",
    "apiKey": "",
    "endpoint": "",
    "timeout": 30000,
    "retries": 3,
    "concurrency": 5
  },
  "batchSize": 20
}
```

## 术语表

`.tmigrate/glossary.json` 用于固定高频 UI 文案的翻译。术语表命中的条目会自动设置为 `approved: true`。

```jsonc
{
  "确定": "OK",
  "取消": "Cancel",
  "提交": "Submit",
  "删除": "Delete",
  "用户名": "Username",
  "密码": "Password"
}
```

英文到中文也可以使用短语组合：

```jsonc
{
  "Create": "创建",
  "Reject": "拒绝",
  "current order": "当前订单",
  "pending": "待处理",
  "order": "订单"
}
```

## 映射文件

每个源文件对应一个 map 文件，路径会保留源文件扩展名：

```text
src/views/Login.vue
.tmigrate/maps/src/views/Login.vue.json
```

映射文件示例：

```jsonc
{
  "version": 2,
  "generatedAt": "2026-05-10T08:00:00Z",
  "entries": {
    "请输入用户名": {
      "id": "a1b2c3d4",
      "translation": "Please enter your username",
      "translationSource": "machine",
      "approved": false,
      "skip": false,
      "location": { "line": 12, "column": 8, "context": "template" }
    },
    "提交": {
      "id": "e5f6g7h8",
      "translation": "Submit",
      "translationSource": "glossary",
      "approved": true,
      "skip": false,
      "location": { "line": 28, "column": 12, "context": "template" }
    }
  }
}
```

## 支持的文件

| 文件类型 | 提取范围 |
|---|---|
| `.vue` | template 文本/属性、script 字符串、style `content` |
| `.ts` / `.tsx` | 字符串字面量、模板字面量 |
| `.js` / `.jsx` | 字符串字面量、模板字面量 |
| `.json` | string value |
| `.html` | 文本节点、可翻译属性 |
| `.css` / `.scss` / `.less` | `content` 属性值 |
| `.md` | 段落文本，跳过代码块 |
| `.yaml` / `.yml` | string value |

Vue `{{ expression }}` 和 JavaScript `${expression}` 会在翻译前被占位符保护，回写时再还原。

## 翻译器

默认使用本地翻译器，复用 `@translation-master/node` 和 Transformers.js / ONNX Runtime。

也可以配置外部 API 翻译器：

```jsonc
{
  "translator": "api",
  "translatorOptions": {
    "endpoint": "https://translator.example.test",
    "apiKey": "token",
    "timeout": 30000,
    "retries": 3,
    "concurrency": 5
  }
}
```

API 请求体格式：

```json
{
  "texts": ["提交", "取消"],
  "sourceLocale": "zh",
  "targetLocale": "en",
  "glossary": {}
}
```

响应可以返回字符串数组，或带置信度的对象数组：

```json
{
  "translations": [
    { "source": "提交", "translation": "Submit", "confidence": 0.9 },
    "Cancel"
  ]
}
```

当 `translator` 为 `"api"` 但未配置 `endpoint` 时，会自动回退到本地翻译器。

## API

除 CLI 外，也可以在 Node.js 中直接调用迁移能力：

```ts
import {
  applyTranslations,
  initGlossary,
  initProject,
  scanProject,
} from '@translation-master/i18n-migrate-cli'

await initProject({ cwd: process.cwd(), from: 'zh', to: 'en', overwrite: false })
await initGlossary({ cwd: process.cwd(), preset: 'all' })

await scanProject({
  cwd: process.cwd(),
  path: 'src',
})

await applyTranslations({ cwd: process.cwd(), dryRun: true })
```

常用导出：

| 导出 | 说明 |
|---|---|
| `initProject()` | 初始化 `.tmigrate` |
| `initGlossary()` | 合并内置词库到 `.tmigrate/glossary.json` |
| `scanProject()` | 扫描源码并生成 map |
| `applyTranslations()` | 回写已确认译文 |
| `restoreBackups()` | 从备份恢复 |
| `defineConfig()` / `loadConfig()` | 生成或读取配置 |
| `Extractor` / `Replacer` | 文本提取和源码回写 |
| `translateTexts()` | 术语表、占位符保护、批量翻译流水线 |

## Playground

仓库内的 `playground/src/i18n-migrate-en-demo/` 提供了英文转中文演练代码，覆盖 TypeScript、Vue SFC、JSON 和 Vue 模板插值，页面入口为 `playground/migrate.html`。

```bash
# 构建 CLI bin
pnpm -F @translation-master/i18n-migrate-cli build

# 初始化迁移配置
pnpm --dir playground exec tmigrate init --from en --to zh --no-overwrite

# 扫描演练源码
pnpm --dir playground exec tmigrate scan src/i18n-migrate-en-demo --to zh --clean-deprecated

# 预览指定文件回写
pnpm --dir playground exec tmigrate apply --path src/i18n-migrate-en-demo/page.ts --dry-run

# 实际回写并恢复
pnpm --dir playground exec tmigrate apply --path src/i18n-migrate-en-demo/page.ts
pnpm --dir playground exec tmigrate restore --path src/i18n-migrate-en-demo/page.ts

# 验证增量扫描
pnpm --dir playground exec tmigrate scan src/i18n-migrate-en-demo --incremental --clean-deprecated
```

## 架构

更完整的内部流程、目录结构、解析器接口和风险说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 许可证

[MIT](../../LICENSE) License
