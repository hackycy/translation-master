export interface MarkdownOptions {
  errFiles: string[]
  lineNumbers: boolean
}

export interface TableScroll {
  x?: number | true | 'max-content'
  y?: number | true
}

const interpolationOpen = '$' + '{'

export const markdownOptions: MarkdownOptions = {
  errFiles: ['', '.md', 'http://example.com/readme.md'],
  lineNumbers: true,
}

export function renderIncome(amount: number): string {
  return `<div style="color: #667eea; font-weight: 600;">经营收入：${amount}</div>`
}

export function createTemplateJson(options: string): string {
  return `JSON.parse(json(${options.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}));`
}

export function normalizeHref(href: unknown, record: Record<string, string>): string {
  if (typeof href === 'string') {
    return href.trim().replace(/\$\{([^}]+)?\}/g, (_source, key) => record[key] ?? '')
  }
  return ''
}

// 商户用户列表
export const userColumns = [
  {
    title: '用户账号',
    dataIndex: 'username',
  },
]

export function getFailureShapeSummary(): string {
  const href = normalizeHref(`/order/${interpolationOpen}id}`, { id: 'SO-3001' })
  return `${userColumns[0]?.title}: ${href}; ${renderIncome(128)}; ${createTemplateJson('{"name":"张三"}')}`
}
