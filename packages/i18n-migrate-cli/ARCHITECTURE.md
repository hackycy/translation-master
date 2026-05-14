# @translation-master/i18n-migrate-cli 架构

> 扫描前端项目源码，按 `sourceLocale` 提取可翻译文本，生成可审核 map，再导出 locale 资源或把源码改写为项目约定的 i18n 调用。

## 背景

中文前端项目需要快速上线国际版，传统 i18n 方案（提取 locale 文件、包裹 t() 函数、适配各处调用）工期长、改动大。本工具现在走双轨：

1. **i18n 迁移模式**：`scan -> approve -> convert -> adapt`，用持久化 key 生成 locale，并把源码改写为 `$t(key)` / `t(key)`。
2. **legacy 直接翻译模式**：`scan -> approve -> apply`，把已确认译文直接回写到源码，适合快速英文化或临时过渡。

同一套流程也支持反向场景，例如 playground 中的英文转中文迁移演练。

## 核心流程

```text
项目根目录
    │
    ▼
┌───────────┐
│  Scanner  │  glob 扫描文件，按过滤规则筛选
└─────┬─────┘
      │
┌─────▼─────┐
│ Extractor │  根据文件后缀选择 Parser，提取源语言文本
└─────┬─────┘  记录位置（文件/行/列/上下文）
      │
┌─────▼─────┐
│  Mapping  │  写入 .tmigrate/maps/ 分片映射文件
└─────┬─────┘
      │
  ┌───┴───┐
  ▼       ▼
机器翻译  人工校对
(批量)   (编辑 map 文件)
  └───┬───┘
      │
┌─────▼─────┐
│ Approve   │  确认 translation 和 i18n key
└─────┬─────┘
      │
  ┌───┴─────────┐
  ▼             ▼
Convert       Adapt
生成 locale    改写为 $t()/t()
  │             │
  ▼             ▼
语言包文件      源码

legacy: approve 后也可以走 apply，直接把原文替换为译文。
```

## `.tmigrate` 目录结构

所有翻译相关的元数据和映射文件统一存放在项目根目录的 `.tmigrate/` 文件夹中，与源码隔离。

```text
项目根目录/
├── .tmigrate/
│   ├── config.json              # 全局配置
│   ├── glossary.json            # 术语表（高频词预设翻译）
│   ├── maps/
│   │   └── src/
│   │       ├── views/
│   │       │   ├── login.vue.json           # src/views/login.vue
│   │       │   └── dashboard.vue.json       # src/views/dashboard.vue
│   │       ├── components/
│   │       │   ├── Form.vue.json
│   │       │   └── Table.vue.json
│   │       ├── utils/
│   │       │   └── constant.ts.json         # src/utils/constant.ts
│   │       └── modules/
│   │           ├── order/
│   │           │   ├── OrderList.vue.json
│   │           │   └── OrderDetail.vue.json
│   │           └── user/
│   │               └── UserCenter.vue.json
│   ├── cache/
│   │   └── scan-meta.json       # 文件 hash 缓存，支持增量扫描
│   └── backups/                 # apply 前自动备份，用于 restore 回滚
│       ├── src/
│       │   └── views/
│       │       └── login.vue
│       └── backup-meta.json
├── src/
├── public/
└── package.json
```

### 映射规则

规则只有一条：**在源文件完整文件名后加 `.json`，目录结构保持一致**。

```text
源文件:  src/views/login.vue
映射:    .tmigrate/maps/src/views/login.vue.json
```

```text
源文件:  src/utils/constant.ts
映射:    .tmigrate/maps/src/utils/constant.ts.json
```

这样做的好处：

- 无歧义：`utils.ts`（文件）和 `utils/`（目录）不会冲突，因为 `utils.ts.json` 保留了扩展名
- 路径可逆：去掉 `.json` 后缀再拼上源码根目录，就是原始文件路径
- IDE 友好：在 `.tmigrate/maps/` 下浏览时，目录结构和源码一一对应

## 初始化

使用前先执行 `init`，生成 `.tmigrate/` 目录结构和默认配置：

```bash
tmigrate init
```

生成内容：

```text
.tmigrate/
├── config.json       # 默认配置（可通过交互式问答定制）
├── glossary.json     # 空术语表
└── .gitkeep          # 保证 maps/、cache/、backups/ 目录可被 git 追踪
```

支持选项：

```bash
# 交互式配置（默认进入问答引导，基于 @clack/prompts）
tmigrate init

# 跳过问答，使用默认配置
tmigrate init --yes

# 指定源语言 / 目标语言
tmigrate init --from zh --to en

# 跳过已有文件（不覆盖已存在的 config.json）
tmigrate init --no-overwrite
```

如果 `.tmigrate/` 已存在，默认会提示是否覆盖。`--no-overwrite` 只创建缺失的文件，不覆盖已有配置。

## 工作流

### 阶段一：扫描 + 翻译

扫描项目源码，提取所有源语言文本，机器翻译后写入 `.tmigrate/maps/` 分片文件。

```bash
# 全量扫描
tmigrate scan ./src --to en

# 只扫描指定目录（生成对应分片）
tmigrate scan ./src/modules/order --to en

# 增量扫描（只处理变更文件，依赖 cache/scan-meta.json）
tmigrate scan ./src --incremental

# 增量扫描并清理 deprecated 条目
tmigrate scan ./src --incremental --clean-deprecated
```

### 终端交互流程

`scan` 会按架构阶段持续刷新终端提示，避免本地模型或受管理 Chrome 首次加载、下载时看起来像“卡住”：

```text
Preparing translation workspace
Scanning source files (12 found)
Processing src/views/Login.vue (1/12)
Processing src/views/Login.vue (1/12) · loading local model
Processing src/views/Login.vue · translating 20/46 texts (batch 1/3)
Processing src/views/Login.vue · saving map
Scan finished.
Scanned 12 file(s), skipped 0, extracted 184 text(s).
```

各提示对应的内部阶段：

| 终端提示 | 内部模块 | 说明 |
|----------|----------|------|
| `Preparing translation workspace` | `config.ts` / `glossary.ts` | 读取配置、术语表，并合并命令行参数 |
| `Scanning source files ...` | `scanner.ts` | 根据 include/exclude 和目标路径查找待扫描文件 |
| `Processing ...` | `Extractor` / `Parser` | 解析当前文件并提取源语言文本 |
| `Processing ... loading local model` | `LocalTranslator` / `@translation-master/node` | 本地 ONNX 模型加载或下载中，保持为单一稳定阶段 |
| `Checking installed Google Chrome` / `Google Chrome ready ...` | `@translation-master/chrome` | Chrome 后端查找本机 Google Chrome 138+，并展示实际使用的可执行文件路径 |
| `Processing ... translating ...` | `translator/pipeline.ts` | 展示机器翻译文本数和批次进度；术语表命中的文本不会进入机器翻译 |
| `Processing ... saving map` | `mapping.ts` | 合并旧映射、保留人工修改，并写入 `.tmigrate/maps/` |
| `Scan finished.` | `cli.ts` | 扫描结束，随后打印汇总统计 |

Node 端本地翻译会通过 `@translation-master/node` 收敛 Hugging Face 的底层 warning，并保持终端提示为单一稳定阶段，避免这类日志和 spinner 互相干扰。

当配置为 `translator: "api"` 且提供 `translatorOptions.endpoint` 时，终端仍会展示扫描、翻译批次和写入进度，但不会出现模型加载提示。

### 阶段二：人工确认

开发者校对映射文件中的 `translation` 和 `key`。`translationApproved` 和 `keyApproved` 都确认后，`approved: true` 才表示该条目可以用于 locale 导出和源码改写。

```bash
tmigrate approve --dry-run
tmigrate approve --path src/modules/order
tmigrate approve
```

### 阶段三：转换为 locale 语言包

`convert` 命令读取 `.tmigrate/maps/`，把分片 map 投影成传统前端语言包。它不修改源码，也不依赖 `apply`：

```bash
tmigrate convert src --format ts --namespace admin
tmigrate convert src --output-dir src/locales/langs --target-only
tmigrate convert src --translate-missing
tmigrate convert src --no-translate-missing
```

默认输出目录是 `src/locales/langs`，路径形态为：

```text
源文件:  src/components/Table.vue
源包:    src/locales/langs/zh/admin/components/Table.ts
目标包:  src/locales/langs/en/admin/components/Table.ts
```

生成对象是平铺字典，key 来自 map 中持久化的英文语义 key：

```ts
export default {
  "submit": "提交"
}
```

转换规则：

- 只转换 `approved: true`、未 `skip`、未 `deprecated`，且已确认 key 的条目。
- 源语言包值为原文，目标语言包值为 map 中 `translation`。
- `json` 输出纯 JSON；`js` / `ts` 输出稳定的 `export default {}`。
- `--namespace` 会插入到 `<locale>/` 下一级，用于避开既有语言包。
- 如果同一个输出文件中出现重复 key，`convert` 会失败并报告冲突来源，要求先人工改 key。
- 如果开启 `--translate-missing`，已批准但译文为空的条目会复用 scan 的翻译配置、术语表和翻译器补译后再输出。

当 `.tmigrate/config.json` 中配置了 `convert.outputDir`，`loadConfig` 会把该目录加入扫描排除规则，避免生成的 locale 文件再次被 `scan` 处理。

### 阶段四：改写源码为 i18n 调用

`adapt` 读取已批准 map，把源码中的源语言文案改写为项目 i18n 调用：

```bash
tmigrate adapt src
tmigrate adapt src --dry-run
tmigrate adapt src --all
```

默认 `adapt` 每次只处理下一个待执行文件，并在对应 map 中记录本次已执行的批准条目。`--all` 才会一次性处理所有已批准且 key 已确认的待执行文件。

当前安全改写范围：

- Vue template 文本：`提交` -> `{{ $t('submit') }}`
- Vue 静态属性：`tab="消费记录"` -> `:tab="$t('consumptionRecords')"`
- Vue 动态 template 表达式：`:title="'提交'"` -> `:title="$t('submit')"`
- Vue `<script setup>` 字符串：`'账号安全'` -> `t('accountSecurity')`，并自动注入 `useI18n`
- Vue 普通 `<script>` 的 `setup()` 内字符串：自动注入 `useI18n` 后改写为 `t('key')`
- Vue Options API 方法内字符串：`'账号安全'` -> `this.$t('accountSecurity')`
- Vue TSX 文本/属性：`<ElButton title="提交">保存</ElButton>` -> `<ElButton title={t('submit')}>{t('save')}</ElButton>`
- TS / JS 字符串：默认从 `@/i18n` 注入 `t` 后改写为 `t('key')`，也可通过 `adapt.runtime.script.import` 覆盖导入来源
- Vue template 混合插值：`{{ user.name }} 有 {{ stats.total }} 条记录` -> `{{ $t('userRecords', { userName: user.name, statsTotal: stats.total }) }}`

`adapt` 不会在没有可靠运行时上下文的位置强行改写。普通 TS/JS 模块默认使用 `@/i18n` 的 `t`，Vue 普通 `<script>` 顶层字符串默认跳过。

### 阶段五：legacy 人工确认 + 直接回写

开发者校对映射文件中的翻译结果（设置 `approved: true` 或修改 `translation`），确认后回写源文件。

```bash
# 预览 diff（只处理 approved 的条目）
tmigrate apply --dry-run

# 只回写指定目录
tmigrate apply --path src/modules/order

# 实际写入
tmigrate apply
```

回写由 `Replacer` 根据 `TextSegment.start/end` 做倒序区间替换。区间只覆盖源文本内容本身，不覆盖外层语法分隔符；替换前会按上下文编码译文：

- `script`：保留原有字符串分隔符，转义匹配的引号、反斜杠、换行和模板字符串反引号；模板字符串里的 `${...}` 占位符保持为表达式。
- `json-value`：使用 JSON 字符串编码内容，避免生成非法 JSON。
- `template` / `html-text`：转义 `&` 和 `<`，防止译文变成 HTML 标签或实体。
- `html-attr`：按属性引号额外转义 `'` 或 `"`。
- `style`：对 CSS `content` 字符串转义引号、反斜杠和换行。
- `yaml-value`：保留已有单/双引号风格；无引号标量会写成双引号字符串，避免 `:`、`#`、换行等 YAML 语法字符改变结构。

这个策略避免了 `const title = '账号安全'` 回写为 `const title = 'Account's secure.'` 这类编译错误，也覆盖了 HTML、JSON、CSS、YAML 中译文特殊字符造成的结构破坏。

### 阶段六：统计与盘点

`stats` 命令只读取 `.tmigrate/maps/`，不修改任何文件，用来快速判断迁移进度和清理优先级。

```bash
tmigrate stats
tmigrate stats src/views/Login.vue
tmigrate stats src/modules/order
```

统计口径分成两层：

1. **当前工作集**：源码仍存在的 map 文件，统计可回写、待校对、待补译、已跳过、已废弃条目。
2. **孤儿/异常**：源码已不存在的 map 文件，以及损坏无法解析的 map 文件。

命令输出采用仪表盘总览，不再默认列出所有 map 文件。总览区块包括：

- map 健康度：总数、可读数、损坏数、当前 map、孤儿 map
- 当前条目规模：当前条目、活跃条目、已排除条目、孤儿条目
- 迁移进度：译文覆盖率、已批准比例、可回写比例、已 adapt 文件比例
- 工作队列：可回写、待 adapt、待校对、待补译、已跳过、已废弃
- 译文来源：glossary / machine / manual
- 重点文件 Top 5：待补译、待校对或废弃条目最多的当前文件
- 待 adapt 文件 Top 5：已经批准但尚未执行 `adapt` 的当前文件
- 孤儿/损坏 Top 5：最需要清理或修复的异常 map

这样可以直接看出：

- 现在已经能回写多少
- 还差多少人工校对
- 还有多少文本没有翻完
- 有没有历史废弃条目需要清理
- 有没有残留的孤儿 map 需要删除

注意这里统计的是 **map 条目数**，不是源码里重复出现的文本命中次数。因为同一个原文在同一文件里通常只保留一个条目，统计命中次数会误导进度判断。

### 回滚

`apply` 执行时自动将原文件备份到 `.tmigrate/backups/`，保留目录结构。`restore` 命令从备份恢复，不依赖 source map 反向推导。

```bash
# 回滚全部已应用的翻译（从 .tmigrate/backups/ 恢复）
tmigrate restore

# 只回滚指定文件
tmigrate restore --path src/views/login.vue

# 查看备份列表
tmigrate restore --list
```

`.tmigrate/backups/` 目录结构与 `maps/` 一致，每个文件记录备份时间：

```text
.tmigrate/backups/
├── src/
│   └── views/
│       └── login.vue           # apply 前的原始文件
└── backup-meta.json            # 备份时间、对应 apply 批次
```

## 配置文件

项目根目录的 `.tmigrate/config.json`：

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
    { "type": "skip-pattern", "value": "^[\\d\\s]+$" },
    { "type": "skip-pattern", "value": "^[a-zA-Z]" },
    { "type": "min-length", "value": 2 }
  ],
  "translator": "local",
  "convert": {
    "outputDir": "src/locales/langs",
    "format": "json",
    "includeSourceLocale": true,
    "translateMissing": false,
    "legacyTextKey": false
  },
  "adapt": {
    "callee": {
      "vue": "$t",
      "script": "t",
      "default": "t"
    },
    "keyReference": {
      "mode": "local",
      "separator": "."
    },
    "runtime": {
      "vue": {
        "import": {
          "source": "vue-i18n",
          "named": "useI18n"
        },
        "autoImport": true
      },
      "script": {
        "import": {
          "source": "@/i18n",
          "named": "t",
          "local": "t"
        }
      }
    }
  },
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

## 映射文件格式

每个 map 文件对应一个源文件，路径由文件位置唯一确定（如 `src/views/login.vue` → `maps/src/views/login.vue.json`），无需在文件内重复记录源路径。

```jsonc
{
  "version": 2,
  "generatedAt": "2026-05-10T08:00:00Z",
  "adapt": {
    "adaptedAt": "2026-05-10T08:10:00Z",
    "entryRefs": ["e5f6g7h8:submit"],
    "applied": 1,
    "skipped": 0,
    "changed": true
  },
  "entries": {
    "请输入用户名": {
      "id": "a1b2c3d4",
      "translation": "Please enter your username",
      "translationSource": "machine",
      "approved": false,
      "translationApproved": false,
      "key": "enterUsername",
      "keySource": "generated",
      "keyApproved": false,
      "keyCandidates": ["enterUsername"],
      "skip": false,
      "location": { "line": 12, "column": 8, "context": "template" }
    },
    "提交": {
      "id": "e5f6g7h8",
      "translation": "Submit",
      "translationSource": "glossary",
      "approved": true,
      "translationApproved": true,
      "key": "submit",
      "keySource": "generated",
      "keyApproved": true,
      "keyCandidates": ["submit"],
      "skip": false,
      "location": { "line": 28, "column": 12, "context": "template" }
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 稳定 ID，由 `hash(text + filePath)` 生成。不依赖行号，保证增量扫描时 ID 稳定。源文本微小改动时可通过 fuzzy matching 迁移旧 ID |
| `translation` | `string` | 翻译结果，可人工修改 |
| `translationSource` | `string` | 翻译来源：`"machine"`（机器翻译）、`"glossary"`（术语表命中）、`"manual"`（人工填写）。术语表命中的条目可自动 approved |
| `approved` | `boolean` | 统一可迁移标记。`convert`、`adapt`、`apply` 都只消费已批准条目；当 `translation` 被机器重新翻译或 key 变化时会重置为 `false` |
| `translationApproved` | `boolean` | 翻译是否已确认。缺省时兼容旧 map 的 `approved` |
| `key` | `string` | locale 字段名和源码改写使用的 i18n key |
| `keySource` | `string` | key 来源：`"generated"` 或 `"manual"` |
| `keyApproved` | `boolean` | key 是否已确认。`convert` / `adapt` 需要 key 已确认 |
| `keyCandidates` | `string[]` | 自动生成的候选 key，供人工选择或改写 |
| `skip` | `boolean` | 标记为 `true` 则永久跳过该条目（如无需翻译的枚举值） |
| `location` | `Location` | 该文本在当前文件中的位置（每个 map 文件只记录本文件内的出现） |
| `context` | `string` | 出现位置的上下文类型，影响过滤规则的行为 |

### ID 生成算法

```text
id = hash(text + ":" + filePath)
     .slice(0, 8)
```

ID 只绑定文本内容和文件路径，不依赖行号。这样即使文件内容增减导致行号偏移，同一文本在同一文件中的 ID 保持稳定，增量扫描不会产生冗余条目。

同一原文出现在不同文件中会生成不同 ID，各自独立管理翻译和审批状态。

当源文本发生微小变更时（如修正错别字），通过 fuzzy matching 尝试关联旧 ID，保留已有的翻译和审批状态。匹配策略使用**字符级最长公共子序列（LCS）比例**而非编辑距离，更适合中文：

```text
similarity = 2 * LCS_length(text_a, text_b) / (len(text_a) + len(text_b))

阈值: similarity >= 0.8 视为同一文本，迁移旧 ID
```

中文场景下编辑距离容易误判（如“请输入用户名”与“请输入密码”编辑距离仅为 2），LCS 比率能更准确反映语义相似度。

## 术语表

`.tmigrate/glossary.json` 定义高频词的固定翻译，机器翻译时优先使用：

```jsonc
{
  "确定": "OK",
  "取消": "Cancel",
  "提交": "Submit",
  "删除": "Delete",
  "用户名": "Username",
  "密码": "Password",
  "手机号": "Phone Number",
  "订单/状态/已激活": "Activated",
  "用户/状态/已激活": "Active"
}
```

上下文区分格式：`<模块>/<父级>/<原文>`，优先匹配更具体的规则。

### 匹配策略

术语表匹配按以下优先级依次尝试，命中即停止：

1. 上下文精确匹配：`glossary["订单/状态/已激活"]` 且当前文本所在模块为“订单”
2. 无上下文精确匹配：`glossary["确定"]`
3. 上下文前缀匹配：`glossary["订单/状态/*"]` 匹配“订单”模块下“状态”父级的所有文本
4. 短语术语组合：当整句未命中时，按最长术语组合短 UI 文案，并支持英文大小写、简单复数、插值占位符和少量停用词，例如 `Reject + current order` → `拒绝当前订单`
5. 机器译文术语校正：长句继续走模型翻译；若源文包含术语且模型译文出现已知误译，会按术语表做后处理校正，例如 `orders` 对应 `订单` 时避免输出为“命令/顺序”

术语表命中的条目自动设置 `translationSource: "glossary"` 和 `approved: true`，无需人工确认。机器翻译的条目设置 `translationSource: "machine"` 和 `approved: false`，需人工校对后改为 `true`。

## 文件类型与解析策略

| 文件类型 | 解析器 | 说明 |
|---------|--------|------|
| `.vue` | `@vue/compiler-sfc` + 子解析器 | 拆分为 template/script/style 后分别处理 |
| `.ts` / `.tsx` | `@babel/parser` + 区间解析 | 语法容错校验后提取字符串字面量、模板字面量 |
| `.js` / `.jsx` | `@babel/parser` + 区间解析 | 同上 |
| `.json` | `JSON.parse` + 区间解析 | 校验 JSON 后提取 string value |
| `.html` | HTML 区间解析 | 提取文本节点和可翻译属性 |
| `.css` / `.scss` / `.less` | 正则 | 只处理 `content` 属性值 |
| `.md` | 正则 / remark | 提取段落文本，跳过代码块 |
| `.yaml` / `.yml` | `yaml` 库 | 提取 string value |

## Vue SFC 解析细节

Vue 单文件组件有三种区域，解析方式不同：

```ts
import { parse } from '@vue/compiler-sfc'

const { descriptor } = parse(content, { sourceMap: true })

// template → HTML parser，提取文本节点和属性；含 Vue 插值的混合文本按整句提取
// script / script-setup → TS/JS parser
// style → 只处理 content: "中文" 属性
```

Template 文本节点里的 Vue 插值采用整句提取策略：`{{ owner }} has orders waiting for approval`
会作为一个完整文本段进入翻译流水线，`{{ owner }}` 在翻译前被替换为占位符，翻译后再还原。纯表达式
如 `<p>{{ owner }}</p>` 不包含源语言可见文本，会被过滤规则跳过。

## 占位符保护

含插值的字符串需要保护插值表达式不被翻译：

```text
输入:   "共 ${total} 条记录，已读 ${read} 条"
保护:   "共 __TM_0__ 条记录，已读 __TM_1__ 条"
翻译:   "Total __TM_0__ records, __TM_1__ read"
还原:   "Total ${total} records, ${read} read"
```

支持的插值模式：

- Vue 模板：`{{ expression }}`
- JS 模板字面量：`${expression}`
- 自定义占位符：通过配置扩展

占位符保护发生在机器翻译前，因此 `${owner}`、`${2}`、`{{ owner }}` 这类表达式会整体保留；即使表达式内部是英文变量名，也不会被模型当作普通英文单词翻译。

## 哪些文本该翻译，哪些不该

| 类型 | 示例 | 处理 |
|------|------|------|
| UI 文本 | `"请输入用户名"` | 翻译 |
| 按钮文字 | `<button>提交</button>` | 翻译 |
| 注释 | `// 初始化路由` | 默认跳过，可配置 |
| console 输出 | `console.log('请求失败')` | 默认跳过，可配置 |
| 枚举值 / key | `status: '已激活'` | 跳过（会破坏逻辑） |
| 测试数据 | `expect(result).toBe('成功')` | 跳过 |
| JSON key | `{ "用户名": "..." }` | 可配置 |
| 单字 | `"中"` | 跳过（min-length 过滤） |

## 过滤规则

规则在 `config.json` 的 `rules` 数组中定义，按顺序执行，第一个匹配的规则决定处理方式：

```jsonc
{
  "rules": [
    { "type": "skip-context", "value": "console" },
    { "type": "skip-context", "value": "comment" },
    { "type": "skip-pattern", "value": "^[\\d\\s]+$" },
    { "type": "skip-pattern", "value": "^[a-zA-Z]" },
    { "type": "min-length", "value": 2 },
    { "type": "force-pattern", "value": "^(提示|说明|注意)" }
  ]
}
```

| 规则类型 | 说明 |
|---------|------|
| `skip-context` | 跳过指定上下文中的文本（`console`、`comment`、`enum`、`test`） |
| `skip-pattern` | 跳过匹配正则的文本 |
| `force-pattern` | 强制翻译匹配的文本（优先级高于 skip-context） |
| `min-length` | 跳过短于指定长度的源语言文本 |
| `max-length` | 跳过长于指定长度的源语言文本（可能是日志或数据） |

## `.gitignore` 建议

根据团队协作需求选择：

```gitignore
# 方案 A：只提交配置和术语表，映射文件不提交（各人本地生成）
.tmigrate/maps/
.tmigrate/cache/
.tmigrate/backups/

# 方案 B：全部提交（团队共享翻译进度，推荐）
# 不添加额外 gitignore 规则

# 方案 C：只提交已审批的条目（需要 CI 脚本过滤）
# .tmigrate/maps/
# .tmigrate/backups/
```

## 增量扫描机制

`.tmigrate/cache/scan-meta.json` 记录每个源文件的 hash 和最后扫描时间：

```jsonc
{
  "src/views/login.vue": {
    "hash": "a1b2c3d4...",
    "lastScanned": "2026-05-10T08:00:00Z",
    "mapFile": "src/views/login.vue.json"
  }
}
```

`tmigrate scan --incremental` 时：

1. 读取 `scan-meta.json`
2. 计算当前文件 hash
3. 跳过 hash 未变的文件
4. 对变更文件重新提取，合并已有映射（保留 approved 状态和人工修改的 translation）
5. 更新 `scan-meta.json`

合并策略：

- 新增的源语言文本：添加新 entry（`approved: false`，`translationSource: "machine"`）
- 已删除的源语言文本：标记为 `deprecated`（不自动删除，人工确认）
- 文本微小变更：fuzzy matching（LCS 比率 >= 0.8）关联旧 ID，若翻译结果变化则重置 `approved: false`
- 文本完全变更：新 ID，旧 entry 标记 `deprecated`
- 术语表命中：设置 `translationSource: "glossary"`，自动 `approved: true`

`deprecated` 条目不会无限累积。`scan` 命令提供 `--clean-deprecated` 选项，移除所有 deprecated 条目。建议在确认回写完成后执行一次清理：

```bash
tmigrate scan ./src --clean-deprecated
```

## 包结构

```text
packages/i18n-migrate-cli/
├── src/
│   ├── index.ts                 # 公共 API
│   ├── cli.ts                   # CLI 命令注册（commander）
│   ├── prompts.ts               # 终端交互封装（@clack/prompts）
│   ├── init.ts                  # init 命令（目录生成 + 交互式配置）
│   ├── scanner.ts               # 文件扫描（glob + 过滤 + 增量）
│   ├── types.ts                 # 类型定义
│   ├── config.ts                # 配置文件读取与合并
│   ├── parsers/
│   │   ├── parser.ts            # Parser 接口定义
│   │   ├── vue.ts               # Vue SFC 解析器
│   │   ├── script.ts            # TS/JS AST 解析器
│   │   ├── json.ts              # JSON 解析器
│   │   ├── html.ts              # HTML 解析器
│   │   ├── css.ts               # CSS 解析器
│   │   ├── markdown.ts          # Markdown 解析器
│   │   ├── yaml.ts              # YAML 解析器
│   │   └── range.ts             # 区间提取/回写共享工具
│   ├── extractor.ts             # 文本提取编排器
│   ├── translator/
│   │   ├── interface.ts         # Translator 抽象接口
│   │   ├── onnx.ts              # 本地 ONNX 翻译器别名入口
│   │   ├── local.ts             # 复用 @translation-master/node 的本地翻译器
│   │   ├── api.ts               # 外部 API 翻译器适配
│   │   └── pipeline.ts          # 翻译流水线（批量调度、并发控制、重试、进度事件）
│   ├── replacer.ts              # 源码区间回写器
│   ├── apply.ts                 # apply / restore 命令编排
│   ├── backup.ts                # apply 前自动备份 + restore 回滚
│   ├── mapping.ts               # 分片映射文件读写 + 合并
│   ├── cache.ts                 # 增量扫描缓存管理
│   ├── glossary.ts              # 术语表加载与匹配
│   ├── reporter.ts              # 变更报告生成
│   └── utils/
│       ├── placeholder.ts       # 占位符保护/还原
│       ├── chinese-detector.ts  # 中文检测
│       ├── id-generator.ts      # 稳定 ID 生成
│       ├── fuzzy-match.ts       # 中文 fuzzy matching（LCS 比率）
│       └── filter.ts            # 文件/文本过滤规则引擎
├── bin/
│   └── tmigrate.ts              # bin 入口
├── package.json
├── tsconfig.json
└── tsdown.config.ts
```

## Parser 接口

```ts
interface TextSegment {
  /** 稳定 ID，hash(text + filePath) */
  id: string
  /** 原始源语言文本 */
  text: string
  /** 在文件中的位置 */
  start: number
  end: number
  line: number
  column: number
  /** 上下文类型 */
  context: 'template' | 'script' | 'style'
         | 'json-value' | 'html-text' | 'html-attr'
         | 'markdown' | 'yaml-value'
  /** 插值信息（如果文本包含插值表达式） */
  interpolation?: {
    pattern: string
    segments: string[]
  }
  /** AST 节点类型 */
  nodeType: string
}

interface TranslationEntry {
  id: string
  translation: string
  translationSource: 'machine' | 'glossary' | 'manual'
  approved: boolean
  skip: boolean
}

interface FileParser {
  /** 支持的文件扩展名 */
  supportedExtensions: string[]
  /** 从文件内容中提取源语言文本 */
  extract(content: string, filePath: string): TextSegment[]
  /** 将翻译结果回写到文件内容 */
  replace(
    content: string,
    segments: TextSegment[],
    translations: Map<string, TranslationEntry>
  ): { content: string }
}
```

## Translator 接口

翻译器通过统一接口抽象，`pipeline.ts` 负责批量调度、并发控制和失败重试，不关心具体翻译实现。

```ts
interface Translator {
  /** 翻译一批文本 */
  translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]>
}

interface TranslateOptions {
  sourceLocale: string
  targetLocale: string
  /** 术语表，优先使用其中的翻译 */
  glossary?: Record<string, string>
}

interface TranslateResult {
  /** 原文 */
  source: string
  /** 翻译结果 */
  translation: string
  /** 翻译来源：术语表命中 or 机器翻译 */
  translationSource: 'glossary' | 'machine'
  /** 置信度（0-1），用于决定是否自动 approved */
  confidence?: number
}
```

`pipeline.ts` 的职责：

1. 先匹配术语表，命中的条目自动设置 `translationSource: "glossary"` 和 `approved: true`
2. 将剩余待机器翻译文本按 `batchSize` 分片
3. 按 `concurrency` 并发调用 Translator，并通过 `onProgress` 上报批次进度
4. 失败时按 `retries` 重试，超过重试次数的批次标记为失败
5. 对含插值的文本，先调用 `placeholder.ts` 保护，翻译后再还原；Vue template 混合文本同样走这条路径
6. 本地翻译器通过 `@translation-master/node` 的 `modelLoad` 事件向 CLI 上报模型加载进度

## 依赖

```jsonc
{
  "dependencies": {
    "@translation-master/core": "workspace:*",
    "@translation-master/node": "workspace:*",
    "@vue/compiler-sfc": "^3.5",
    "@babel/parser": "^7.26",
    "yaml": "^2.6",
    "tinyglobby": "^0.2",
    "picocolors": "^1.1",
    "commander": "^14.0",
    "@clack/prompts": "^0.11.0"
  }
}
```

`@clack/prompts` 提供终端交互能力，用于以下场景：

- `init` 默认流程：`select` 选择源语言/目标语言，`multiselect` 选择文件类型，`text` 输入 source root
- 覆盖确认：`.tmigrate` 已存在时通过 `confirm` 确认是否覆盖
- 全局加载状态：`spinner` 已封装为公共 helper，可用于长任务进度展示

与 `commander`（命令解析）互补，不冲突。

## Playground 演练

`playground/src/i18n-migrate-en-demo/` 提供了英文转中文的测试页面源码，覆盖 TypeScript、Vue SFC、JSON 和 Vue 模板插值场景，入口为 `playground/migrate.html`。可在仓库根目录执行：

```bash
# 构建 CLI bin
pnpm -F @translation-master/i18n-migrate-cli build

# 初始化迁移目录
pnpm --dir playground exec tmigrate init --from en --to zh --no-overwrite

# 演练配置默认使用 "local" 模型翻译；如需 API 仅在配置了 endpoint 时启用
# 然后扫描测试页面
pnpm --dir playground exec tmigrate scan src/i18n-migrate-en-demo --to zh --clean-deprecated

# 预览已审批条目的回写 diff
pnpm --dir playground exec tmigrate apply --path src/i18n-migrate-en-demo/page.ts --dry-run

# 实际回写并从备份恢复
pnpm --dir playground exec tmigrate apply --path src/i18n-migrate-en-demo/page.ts
pnpm --dir playground exec tmigrate restore --path src/i18n-migrate-en-demo/page.ts

# 验证增量扫描
pnpm --dir playground exec tmigrate scan src/i18n-migrate-en-demo --incremental --clean-deprecated
```

## 与现有架构的关系

```text
@translation-master/core              ← 复用 Translator 接口, detectLanguage
@translation-master/node              ← 复用 Node Translator (ONNX CPU)，实现 Translator 接口
@translation-master/i18n-migrate-cli  ← 文件扫描/解析/分片映射/回写/备份
```

## 已识别的风险与缓解

### 翻译精度

机器翻译对短 UI 文本表现不佳（“确定” → “OK” vs “Confirm” vs “Determine”）。缓解措施：

- 分阶段工作流允许人工校对 translation 和 key
- 术语表（`glossary.json`）高频词预设翻译，命中自动 approved
- `translationSource` 字段区分翻译来源，术语表命中无需人工确认
- 映射文件可跨项目复用

### 误翻译

源码中的源语言文本并非都是用户可见文本。缓解措施：

- 上下文感知（console/comment/enum 不同处理）
- 可配置的过滤规则
- 默认跳过测试文件

### 插值破坏

直接翻译或改写含插值的字符串会破坏表达式。缓解措施：

- 占位符保护机制
- 源码区间替换保证只改命中的文本范围
- `convert` 输出 `{param}` 消息，`adapt` 生成对应参数对象

### key 冲突

多个条目使用同一个 locale key 会导致语言包字段覆盖。缓解措施：

- `scan` 为同文件冲突 key 自动追加短 hash
- `convert` 发现同一输出文件重复 key 时直接失败并报告冲突来源
- map 中保留 `keyCandidates`，支持人工改 key 后再批准

### 不可逆

源文件直接修改风险高。缓解措施：

- `--dry-run` 模式预览
- `apply` 时自动备份原文件到 `.tmigrate/backups/`，`restore` 从备份恢复
- 映射文件保留原始文本
- `cache/scan-meta.json` 记录文件 hash，可检测非翻译导致的变更

### 大规模项目性能

万级文件扫描和翻译耗时长。缓解措施：

- 增量扫描（`--incremental`），跳过未变更文件
- 分片映射，`apply` 可按目录/模块独立执行
- 批量翻译流水线，可配置 `batchSize`

## 实施阶段

| 阶段 | 内容 | 预估 |
|------|------|------|
| P0 | 文件扫描 + Vue template/JS/TS 提取 + `.tmigrate/maps/` 分片写入 | 2-3 天 |
| P0 | Translator 接口 + ONNX 实现 + pipeline 批量调度 + 术语表匹配 | 2 天 |
| P0 | 源码区间回写（原文做 key）+ dry-run + diff 预览 | 2 天 |
| P0 | apply 自动备份 + restore 回滚 | 0.5 天 |
| P1 | CLI 封装 + `init` 命令 + config.json 配置 | 1 天 |
| P1 | 占位符保护（插值字符串） | 1 天 |
| P1 | JSON / HTML / CSS / Markdown / YAML 解析器 | 1-2 天 |
| P2 | 过滤规则引擎 | 1 天 |
| P2 | 增量扫描 + cache 机制 + deprecated 清理 | 1 天 |
| P2 | 中文 fuzzy matching（LCS 比率）+ ID 迁移 | 1 天 |
| P2 | `translationSource` 追踪 + 术语表自动 approved | 0.5 天 |
