import type { TranslationEntry } from '../types'
import { describe, expect, it } from 'vitest'
import { defineConfig } from '../config'
import { Extractor } from '../extractor'
import { Replacer } from '../replacer'

const config = defineConfig({
  sourceLocale: 'zh',
  targetLocale: 'en',
  include: [],
  exclude: [],
  rules: [],
  translator: 'local' as const,
  translatorOptions: {
    timeout: 30000,
    retries: 3,
    concurrency: 5,
  },
  batchSize: 20,
})

const expression = `$${'{name}'}`
const plainExpression = `$${'{value}'}`

describe('replacer syntax-aware writeback', () => {
  it('escapes translations for script string delimiters', () => {
    const content = [
      'export const title = \'账号安全\'',
      'export const copy = "保存路径"',
      'export const plain = \'普通字符串\'',
      `export const message = \`你好 ${expression}\``,
    ].join('\n')

    const next = replace(content, 'src/security.ts', [
      ['账号安全', 'Account\'s secure.'],
      ['保存路径', 'C:\\Users\\Tom "Home"'],
      ['普通字符串', `Keep ${plainExpression}'s text`],
      ['你好', 'Hello `team`'],
    ])

    expect(next).toContain('export const title = \'Account\\\'s secure.\'')
    expect(next).toContain('export const copy = "C:\\\\Users\\\\Tom \\"Home\\""')
    expect(next).toContain(`export const plain = 'Keep ${plainExpression}\\'s text'`)
    expect(next).toContain(`export const message = \`Hello \\\`team\\\` ${expression}\``)
  })

  it('does not replace template literal expressions or comments as script text', () => {
    const interpolationOpen = '$' + '{'
    const nestedTitle = [
      'const title = `订单支付 ',
      'amount ? ` - ¥',
      'amount}` : ""}`',
    ].join(interpolationOpen)
    const query = `const query = \`${interpolationOpen}config.url}${interpolationOpen}props.code}\``

    const content = [
      'const amount = 12',
      nestedTitle,
      '// const commented = \'不要翻译注释里的字符串\'',
      query,
    ].join('\n')

    const next = replace(content, 'src/payment.ts', [
      ['订单支付', 'Order Payment'],
      ['不要翻译注释里的字符串', 'Should not appear'],
      ['config.url', 'Should not appear either'],
    ])

    expect(next).toContain(nestedTitle.replace('订单支付', 'Order Payment'))
    expect(next).toContain('// const commented = \'不要翻译注释里的字符串\'')
    expect(next).toContain(query)
  })

  it('skips code-like script strings from real build failure shapes', () => {
    const interpolationOpen = '$' + '{'
    const incomeLine = `const income = \`<div style="color: #667eea; font-weight: 600;">经营收入：${interpolationOpen}amount}</div>\``
    const templateLine = [
      'const template = `JSON.parse(json(',
      'options.replaceAll("\\\\", "\\\\\\\\").replaceAll("\'", "\\\\\'")}));`',
    ].join(interpolationOpen)
    const hrefLine = `href = href.trim().replace(/\\${interpolationOpen}([^}]+)?}/g, (s1, s2) => record[s2])`

    const content = [
      'const markdownOptions = { errFiles: [\'\', \'.md\'], lineNumbers: true }',
      incomeLine,
      templateLine,
      'export type TableScroll = { x?: number | true | \'max-content\'; y?: number | true }',
      hrefLine,
      'const payload = \'{"name":"张三"}\'',
      '// 商户用户列表',
      'const columns = [{ title: "用户账号", dataIndex: "username" }]',
    ].join('\n')

    const segments = new Extractor(config).extract(content, 'src/failure-shapes.ts')

    expect(segments.map(segment => segment.text)).toEqual(['用户账号'])
    expect(replace(content, 'src/failure-shapes.ts', [
      ['经营收入：', 'Operating income: <div style="broken">'],
      ['商户用户列表', 'Commercial User List'],
      ['用户账号', 'User account'],
    ])).toContain('const columns = [{ title: "User account", dataIndex: "username" }]')
  })

  it('escapes translations for data and markup formats', () => {
    expect(replace('{"title":"账号安全"}', 'src/copy.json', [
      ['账号安全', 'Account\'s "secure"\nNow'],
    ])).toBe('{"title":"Account\'s \\"secure\\"\\nNow"}')

    expect(replace('<button title=\'账号安全\'>保存当前值</button>', 'src/App.html', [
      ['账号安全', 'Account\'s <secure> & ready'],
      ['保存当前值', 'Save < current & continue'],
    ])).toBe('<button title=\'Account&#39;s &lt;secure&gt; &amp; ready\'>Save &lt; current &amp; continue</button>')

    expect(replace('.badge::after { content: "账号安全"; }', 'src/badge.css', [
      ['账号安全', 'Account "secure"\nready'],
    ])).toBe('.badge::after { content: "Account \\"secure\\"\\A ready"; }')
  })

  it('uses Vue template ranges when directive values contain greater-than signs', () => {
    const content = [
      '<template>',
      '  <div v-if="showTips">',
      '    <template v-if="fileMax > 1">，最大上传{{ fileMax }}张图片</template>',
      '  </div>',
      '</template>',
    ].join('\n')
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/JImageUpload.vue')

    expect(segments.map(segment => segment.text)).toEqual(['，最大上传{{ fileMax }}张图片'])
    expect(replace(content, 'src/JImageUpload.vue', [
      ['，最大上传{{ fileMax }}张图片', 'with maximum uploads of {{ fileMax }}'],
    ])).toContain('<template v-if="fileMax > 1">with maximum uploads of {{ fileMax }}</template>')
  })

  it('extracts static Vue tab attributes while ignoring dynamic bindings', () => {
    const content = [
      '<template>',
      '  <ATabs>',
      '    <ATabPane key="1" tab="消费记录" />',
      '    <ATabPane key="2" tab="积分明细" />',
      '    <ATabPane key="3" :tab="dynamicTab" />',
      '  </ATabs>',
      '</template>',
    ].join('\n')
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/DetailDrawer.vue')

    expect(segments.map(segment => segment.text)).toEqual(['消费记录', '积分明细'])
    const next = replace(content, 'src/DetailDrawer.vue', [
      ['消费记录', 'Consumption Records'],
      ['积分明细', 'Points Details'],
      ['dynamicTab', 'Should not replace'],
    ])
    expect(next).toContain('tab="Consumption Records"')
    expect(next).toContain('tab="Points Details"')
    expect(next).toContain(':tab="dynamicTab"')
  })

  it('extracts static Vue component props generically without HTML attr whitelist', () => {
    const content = [
      '<template>',
      '  <CustomWidget panel-title="账户安全" emptyText="暂无数据" data-test="测试ID" class="中文类名" :panel-title="dynamicTitle" />',
      '</template>',
    ].join('\n')
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/CustomWidget.vue')

    expect(segments.map(segment => segment.text)).toEqual(['账户安全', '暂无数据'])
    const next = replace(content, 'src/CustomWidget.vue', [
      ['账户安全', 'Account Security'],
      ['暂无数据', 'No Data'],
      ['dynamicTitle', 'Should not replace'],
    ])
    expect(next).toContain('panel-title="Account Security"')
    expect(next).toContain('emptyText="No Data"')
    expect(next).toContain(':panel-title="dynamicTitle"')
  })

  it('extracts and replaces column titles in Vue TSX script setup blocks', () => {
    const content = [
      '<template><BasicTable /></template>',
      '<script lang="tsx" setup>',
      'const columns = [',
      '  { title: "所属景区", dataIndex: "scenicName" },',
      '  {',
      '    title: "订单类型",',
      '    customRender: ({ text }) => <Tag>{text === 1 ? "团队" : "个人"}</Tag>,',
      '  },',
      ']',
      '</script>',
    ].join('\n')
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/Columns.vue')

    expect(segments.map(segment => segment.text)).toEqual(['所属景区', '订单类型', '团队', '个人'])
    expect(replace(content, 'src/Columns.vue', [
      ['所属景区', 'Scenic Area'],
      ['订单类型', 'Order Type'],
    ])).toContain('{ title: "Scenic Area", dataIndex: "scenicName" }')
  })

  it('extracts single-character units in data objects without field-name special cases', () => {
    const content = [
      'export const statList = [',
      '  { title: "销售额", prefix: "元", subPrefix: "单" },',
      '  { title: "销售数量", prefix: "张", unit: "人" },',
      ']',
      'export const showTotal = (total) => "共" + total + "条"',
    ].join('\n')
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/data.ts')

    expect(segments.map(segment => segment.text)).toEqual(['销售额', '元', '单', '销售数量', '张', '人', '共', '条'])
    expect(replace(content, 'src/data.ts', [
      ['元', 'yuan'],
      ['单', 'order'],
      ['张', 'ticket'],
      ['人', 'people'],
    ])).toContain('{ title: "销售额", prefix: "yuan", subPrefix: "order" }')
  })

  it('keeps HTML text ranges after attributes containing greater-than signs', () => {
    const content = '<div><template data-test="fileMax > 1">最大上传{{ fileMax }}张图片</template></div>'
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/template.html')

    expect(segments.map(segment => segment.text)).toEqual(['最大上传{{ fileMax }}张图片'])
    expect(replace(content, 'src/template.html', [
      ['最大上传{{ fileMax }}张图片', 'Maximum uploads {{ fileMax }} images'],
    ])).toContain('data-test="fileMax > 1">Maximum uploads {{ fileMax }} images</template>')
  })

  it('extracts common static HTML attrs including tab', () => {
    const content = '<tab-pane tab="消费记录" :tab="dynamicTab" title="详情"></tab-pane>'
    const extractor = new Extractor(config)
    const segments = extractor.extract(content, 'src/template.html')

    expect(segments.map(segment => segment.text)).toEqual(['消费记录', '详情'])
  })

  it('quotes unsafe yaml translations and preserves quoted yaml scalars', () => {
    expect(replace('title: 账号安全\n', 'src/messages.yaml', [
      ['账号安全', 'Account: secure #1'],
    ])).toBe('title: "Account: secure #1"\n')

    expect(replace('title: \'账号安全\'\n', 'src/messages.yaml', [
      ['账号安全', 'Account\'s secure.'],
    ])).toBe('title: \'Account\'\'s secure.\'\n')
  })
})

function replace(content: string, filePath: string, translations: Array<[string, string]>): string {
  const extractor = new Extractor(config)
  const segments = extractor.extract(content, filePath)
  const entries = new Map(translations.map(([source, translation]) => [source, entry(source, translation)]))
  return new Replacer().replace(content, filePath, segments, entries).content
}

function entry(id: string, translation: string): TranslationEntry {
  return {
    id,
    translation,
    translationSource: 'manual',
    approved: true,
    skip: false,
  }
}
