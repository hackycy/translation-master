import copy from './copy.json'
import './badge.css'

type OrderStatus = 'pending' | 'paid' | 'cancelled'

const statusLabel: Record<OrderStatus, string> = {
  pending: '待付款',
  paid: '已支付',
  cancelled: '已取消',
}

const orders = [
  { id: 'SO-1001', owner: '张三', status: 'pending' as const, amount: 128 },
  { id: 'SO-1002', owner: '李四', status: 'paid' as const, amount: 560 },
]

const root = document.querySelector<HTMLDivElement>('#migrate-demo')

if (root) {
  const section = document.createElement('section')
  section.className = 'migrate-shell'

  const badge = document.createElement('span')
  badge.className = 'demo-badge'
  badge.textContent = copy.badge

  const title = document.createElement('h1')
  title.textContent = copy.title

  const subtitle = document.createElement('p')
  subtitle.textContent = copy.subtitle

  const header = document.createElement('header')
  header.append(badge, title, subtitle)

  const form = document.createElement('form')
  form.className = 'toolbar'
  form.append(
    field('订单编号', '请输入订单编号'),
    field('客户名称', '请输入客户名称'),
    button('查询', 'button'),
    button('重置', 'reset'),
  )

  const table = document.createElement('table')
  table.append(createTableHead(['订单号', '客户', '状态', '金额', '操作']), createTableBody())
  section.append(header, form, table)
  root.append(section)
}

console.info('i18n 迁移演练页面已加载')

function field(labelText: string, placeholder: string): HTMLLabelElement {
  const label = document.createElement('label')
  label.textContent = labelText
  const input = document.createElement('input')
  input.placeholder = placeholder
  label.append(input)
  return label
}

function button(text: string, type: 'button' | 'reset'): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = type
  element.textContent = text
  return element
}

function createTableHead(labels: string[]): HTMLTableSectionElement {
  const head = document.createElement('thead')
  const row = document.createElement('tr')
  for (const label of labels) {
    const cell = document.createElement('th')
    cell.textContent = label
    row.append(cell)
  }
  head.append(row)
  return head
}

function createTableBody(): HTMLTableSectionElement {
  const body = document.createElement('tbody')
  for (const order of orders) {
    const row = document.createElement('tr')
    const action = button('查看详情', 'button')
    action.title = '查看订单详情'
    for (const value of [order.id, order.owner, statusLabel[order.status], `¥${order.amount}`]) {
      const cell = document.createElement('td')
      cell.textContent = value
      row.append(cell)
    }
    const actionCell = document.createElement('td')
    actionCell.append(action)
    row.append(actionCell)
    body.append(row)
  }
  return body
}
