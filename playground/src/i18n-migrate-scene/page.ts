import { getFailureShapeSummary } from './failure-shapes'
import {
  columns,
  getPaymentTitle,
  getReviewTip,
  getSafeDynamicUrl,
  securityTitle,
  uploadTips,
} from './source-code'

const root = document.querySelector<HTMLDivElement>('#migrate-demo')

if (root) {
  const record = { id: 'SO-3001', amount: 128, owner: '张三', status: 'pending' as const }
  const section = document.createElement('section')
  section.className = 'migrate-shell'

  const title = document.createElement('h1')
  title.textContent = securityTitle

  const payment = document.createElement('p')
  payment.textContent = getPaymentTitle(record)

  const review = document.createElement('p')
  review.textContent = getReviewTip(5)

  const upload = document.createElement('button')
  upload.type = 'button'
  upload.title = uploadTips.placeholder
  upload.textContent = uploadTips.defaultText

  const warning = document.createElement('p')
  warning.textContent = uploadTips.sizeWarning

  const failureShapes = document.createElement('p')
  failureShapes.innerHTML = getFailureShapeSummary()

  const table = document.createElement('table')
  table.append(createHeader(columns.map(column => column.title)))

  section.append(title, payment, review, upload, warning, failureShapes, table)
  section.dataset.safeUrl = getSafeDynamicUrl({ getData: '/api/order/' }, { code: record.id })
  root.append(section)
}

function createHeader(labels: string[]): HTMLTableSectionElement {
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
