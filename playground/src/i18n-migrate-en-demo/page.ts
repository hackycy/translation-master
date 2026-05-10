import copy from './copy.json'

const orders = [
  { id: 'SO-2001', owner: 'Alice', status: 'Pending review' },
  { id: 'SO-2002', owner: 'Bob', status: 'Ready to ship' },
]

const root = document.querySelector<HTMLDivElement>('#migrate-demo')

if (root) {
  const section = document.createElement('section')
  section.className = 'migrate-shell'

  const title = document.createElement('h1')
  title.textContent = copy.title

  const subtitle = document.createElement('p')
  subtitle.textContent = copy.subtitle

  const search = document.createElement('input')
  search.placeholder = 'Enter customer name'

  const action = document.createElement('button')
  action.type = 'button'
  action.title = 'Create a new order'
  action.textContent = 'Create Order'

  const list = document.createElement('ul')
  for (const order of orders) {
    const item = document.createElement('li')
    item.textContent = `${order.owner}: ${order.status}`
    list.append(item)
  }

  section.append(title, subtitle, search, action, list)
  root.append(section)
}
