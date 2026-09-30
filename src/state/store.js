import { demoData } from './data.js'

const clone = (value) => JSON.parse(JSON.stringify(value))

export function createDemoState() {
  return clone(demoData)
}

export function purchasePackage(state, { projectId, packageId, quantity = 1 }) {
  const project = state.projects.find((item) => item.id === projectId)
  const selectedPackage = project?.packages.find((item) => item.id === packageId)

  if (!project || !selectedPackage) {
    throw new Error('套餐不存在')
  }

  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)))
  const total = selectedPackage.price * safeQuantity

  if (selectedPackage.stock < safeQuantity) {
    throw new Error('库存不足')
  }

  if (state.user.points < total) {
    throw new Error('积分余额不足')
  }

  const next = clone(state)
  const orderSequence = String(next.orders.length + 21).padStart(2, '0')
  const orderId = `LP-DEMO-${orderSequence}`
  const now = '2026-09-30 11:30'

  next.user.points -= total
  next.orders.unshift({
    id: orderId,
    projectId,
    packageName: selectedPackage.name,
    quantity: safeQuantity,
    total,
    status: '已交付',
    createdAt: now,
  })

  for (let index = 0; index < safeQuantity; index += 1) {
    const suffix = String(2100 + next.numbers.length + index).slice(-4)
    next.numbers.unshift({
      id: `${orderId}-num-${index + 1}`,
      value: `+1 646 *** ${suffix}`,
      projectId,
      status: '待激活',
      expiresAt: '2026-10-30',
    })
  }

  const packageInNextState = next.projects
    .find((item) => item.id === projectId)
    .packages.find((item) => item.id === packageId)
  packageInNextState.stock -= safeQuantity

  next.ledger.unshift({
    id: `ledger-${orderId}`,
    title: `${project.name} · ${selectedPackage.name}`,
    amount: -total,
    time: now,
  })

  return next
}

export function markMessageRead(state, messageId) {
  const next = clone(state)
  const message = next.messages.find((item) => item.id === messageId)
  if (message) message.read = true
  return next
}
