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
pnpm exec tmigrate init --from zh --to en

# 2. 扫描源码并生成 .tmigrate/maps 分片映射
pnpm exec tmigrate scan src --to en

# 3. 校对 .tmigrate/maps 下的翻译条目，把需要回写的条目标记为 approved: true

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
2. 开发者校对映射文件，修改 `translation`，并将确认过的条目标记为 `approved: true`。
3. `apply` 只回写 `approved: true` 且未标记 `skip` 的条目。
4. `apply` 写入前会备份原文件到 `.tmigrate/backups/`，可用 `restore` 回滚。

## 命令

### `init`

创建 `.tmigrate/` 目录、默认配置和术语表。

```bash
tmigrate init
tmigrate init --interactive
tmigrate init --from zh --to en
tmigrate init --from en --to zh --no-overwrite
```

常用选项：

| 选项 | 说明 |
|---|---|
| `--interactive` | 通过终端问答生成配置 |
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
  initProject,
  scanProject,
} from '@translation-master/i18n-migrate-cli'

await initProject({ cwd: process.cwd(), from: 'zh', to: 'en', overwrite: false })

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
