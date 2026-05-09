# @translation-master/vite-plugin

Vite 插件，用于将 [translate.js](https://github.com/ChunyuPCY/translate.js) 脚本注入 HTML 页面。

## 安装

```bash
pnpm add -D @translation-master/vite-plugin
```

## 使用

```ts
// vite.config.ts
import TranslatePlugin from '@translation-master/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    TranslatePlugin({
      version: '3.18.66',
    }),
  ],
})
```

## 选项

```ts
interface PluginOptions {
  /**
   * 是否自动注入 translate.js 脚本到 HTML 中
   * @default true
   */
  inject?: boolean

  /**
   * translate.js 版本（必填）
   * 支持：'3.18.66' | '4.0.3'
   */
  version: VERSION

  /**
   * 在 translate.js 加载并执行后注入的初始化脚本
   */
  initializeScript?: string
}
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `inject` | `boolean` | `true` | 是否注入脚本 |
| `version` | `'3.18.66' \| '4.0.3'` | 必填 | translate.js 版本 |
| `initializeScript` | `string` | - | translate.js 加载后执行的脚本 |

## 行为

### 开发环境（`vite dev`）

- 从磁盘读取 translate.js 包
- 作为内联 `<script>` 标签注入 HTML
- 可选追加 `initializeScript`

### 生产环境（`vite build`）

- 将 translate.js 包作为带哈希的资源文件输出
- 注入指向该资源的 `<script src="...">` 标签
- 资源文件名包含版本和时间戳，用于缓存失效

### SSR

- 当 `build.ssr` 为 `true` 时不执行任何操作

## 带初始化脚本的示例

```ts
TranslatePlugin({
  version: '3.18.66',
  initializeScript: `
    translate.language.setLocal('chinese_simplified');
    translate.selectLanguageTag.show({ select: 'LanguageSelector' });
    translate.execute();
  `,
})
```

## 许可证

[MIT](../../LICENSE) License
