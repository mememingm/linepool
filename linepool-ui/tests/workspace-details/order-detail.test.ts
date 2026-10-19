import { describe, expect, it, vi } from 'vitest';
import { LinepoolApiError } from '../../src/linepool/api/client';
import { loadOrderDetail, type OrderDetailState } from '../../src/linepool/workspace-reference/detail-data';
import type { OrderDetail } from '../../src/linepool/api/contracts';
import { deferred, order, ORDER_ID, OTHER_ORDER_ID } from './fixtures';

describe('order detail loading states', () => {
  it('does not send an invalid UUID to the API', async () => {
    const fetchOrder = vi.fn(async () => order);
    const states: OrderDetailState[] = [];
    await loadOrderDetail('LP202610100001', fetchOrder, state => states.push(state)).completion;
    expect(fetchOrder).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: 'not-found' }]);
  });
  it('loads the addressable UUID even when no local list entry exists', async () => {
    const states: OrderDetailState[] = [];
    const fetchOrder = vi.fn(async () => order);
    const request = loadOrderDetail(ORDER_ID, fetchOrder, state => states.push(state));
    expect(states).toEqual([{ status: 'loading' }]);
    await request.completion;
    expect(fetchOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(states.at(-1)).toEqual({ status: 'ready', order });
    expect(order.numbers).toEqual([]);
  });
  it.each([
    [404, 'ORDER_NOT_FOUND', 'not-found'],
    [401, 'UNAUTHENTICATED', 'expired'],
  ] as const)('classifies %s without a generic network retry', async (status, code, expected) => {
    const states: OrderDetailState[] = [];
    await loadOrderDetail(ORDER_ID, async () => { throw new LinepoolApiError(status, code, 'HTTP failure'); }, state => states.push(state)).completion;
    expect(states).toEqual([{ status: 'loading' }, { status: expected }]);
  });
  it('allows a new attempt after a network/timeout failure', async () => {
    const error = new LinepoolApiError(0, 'REQUEST_TIMEOUT', 'Request timed out');
    const fetchOrder = vi.fn<() => Promise<OrderDetail>>().mockRejectedValueOnce(error).mockResolvedValueOnce(order);
    const states: OrderDetailState[] = [];
    await loadOrderDetail(ORDER_ID, fetchOrder, state => states.push(state)).completion;
    expect(states.at(-1)).toEqual({ status: 'error', error });
    await loadOrderDetail(ORDER_ID, fetchOrder, state => states.push(state)).completion;
    expect(states.at(-1)).toEqual({ status: 'ready', order });
    expect(fetchOrder).toHaveBeenCalledTimes(2);
  });
  it('handles a synchronous adapter failure', async () => {
    const error = new Error('adapter failed');
    const states: OrderDetailState[] = [];
    await loadOrderDetail(ORDER_ID, () => { throw error; }, state => states.push(state)).completion;
    expect(states.at(-1)).toEqual({ status: 'error', error });
  });
  it('does not publish data for a different returned UUID', async () => {
    const states: OrderDetailState[] = [];
    await loadOrderDetail(ORDER_ID, async () => ({ ...order, id: OTHER_ORDER_ID }), state => states.push(state)).completion;
    expect(states.at(-1)).toMatchObject({ status: 'error', error: { code: 'INVALID_RESPONSE' } });
  });
});

describe('route/retry/dispose stale isolation', () => {
  it('ignores a late result from the previous route', async () => {
    const previous = deferred<OrderDetail>();
    const current = deferred<OrderDetail>();
    const states: OrderDetailState[] = [];
    const oldRequest = loadOrderDetail(ORDER_ID, () => previous.promise, state => states.push(state));
    oldRequest.cancel();
    const newRequest = loadOrderDetail(OTHER_ORDER_ID, () => current.promise, state => states.push(state));
    const nextOrder = { ...order, id: OTHER_ORDER_ID };
    current.resolve(nextOrder); await newRequest.completion;
    previous.resolve(order); await oldRequest.completion;
    expect(states).toEqual([{ status: 'loading' }, { status: 'loading' }, { status: 'ready', order: nextOrder }]);
  });
  it('ignores late failures after leaving/unmounting, including 401/404', async () => {
    for (const status of [0, 401, 404]) {
      const response = deferred<OrderDetail>();
      const states: OrderDetailState[] = [];
      const request = loadOrderDetail(ORDER_ID, () => response.promise, state => states.push(state));
      request.cancel();
      response.reject(new LinepoolApiError(status, 'FAILURE', 'Late failure'));
      await request.completion;
      expect(states).toEqual([{ status: 'loading' }]);
    }
  });
  it('a previous attempt cannot replace a newer retry for the same UUID', async () => {
    const previous = deferred<OrderDetail>();
    const states: OrderDetailState[] = [];
    const oldRequest = loadOrderDetail(ORDER_ID, () => previous.promise, state => states.push(state));
    oldRequest.cancel();
    const latest = { ...order, orderNumber: 'LATEST' };
    await loadOrderDetail(ORDER_ID, async () => latest, state => states.push(state)).completion;
    previous.resolve(order); await oldRequest.completion;
    expect(states.at(-1)).toEqual({ status: 'ready', order: latest });
    expect(states).toHaveLength(3);
  });
});
