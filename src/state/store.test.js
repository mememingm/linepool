import { describe, expect, it } from 'vitest'
import { createDemoState, purchasePackage } from './store.js'

describe('purchasePackage', () => {
  it('deducts points and creates a linked order, number and ledger entry', () => {
    const state = createDemoState()
    const next = purchasePackage(state, {
      projectId: 'aurora',
      packageId: 'aurora-pro',
      quantity: 2,
    })

    expect(next.user.points).toBe(11040)
    expect(next.orders).toHaveLength(state.orders.length + 1)
    expect(next.numbers).toHaveLength(state.numbers.length + 2)
    expect(next.ledger[0].amount).toBe(-960)
    expect(next.orders[0].projectId).toBe('aurora')
    expect(next.orders[0].quantity).toBe(2)
  })

  it('rejects a purchase when the point balance is insufficient', () => {
    const state = createDemoState()
    state.user.points = 100

    expect(() =>
      purchasePackage(state, {
        projectId: 'aurora',
        packageId: 'aurora-pro',
        quantity: 1,
      }),
    ).toThrow('积分余额不足')
  })

  it('does not mutate the previous state', () => {
    const state = createDemoState()
    const originalPoints = state.user.points

    purchasePackage(state, {
      projectId: 'aurora',
      packageId: 'aurora-pro',
      quantity: 1,
    })

    expect(state.user.points).toBe(originalPoints)
    expect(state.orders).toHaveLength(2)
  })
})
