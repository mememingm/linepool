import type { OrderDetail } from '@linepool/contracts';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../src/services/api-client.js';
import OrderDetailView from '../src/views/OrderDetailView.vue';

const orderId = '10000000-0000-4000-8000-000000000001';

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({ params: { id: orderId } }),
  };
});

vi.mock('../src/services/api-client.js', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

describe('OrderDetailView', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('loads the owned order and renders its purchase fields and numbers', async () => {
    const order: OrderDetail = {
      id: orderId,
      orderNumber: 'LP-DEMO-0001',
      project: {
        id: '20000000-0000-4000-8000-000000000001',
        name: '美国验证码',
      },
      plan: {
        id: '30000000-0000-4000-8000-000000000001',
        name: '标准验证包',
      },
      quantity: 1,
      totalPoints: 1_200,
      status: 'COMPLETED',
      createdAt: '2026-09-30T01:00:00.000Z',
      numbers: [{
        id: '50000000-0000-4000-8000-000000000001',
        phoneNumber: '+15550001001',
        project: {
          id: '20000000-0000-4000-8000-000000000001',
          name: '美国验证码',
        },
        orderId,
        status: 'ACTIVE',
        assignedAt: '2026-09-30T01:00:00.000Z',
        expiresAt: '2026-10-30T01:00:00.000Z',
      }],
    };
    requestMock.mockResolvedValue(order);

    const wrapper = mount(OrderDetailView, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    expect(requestMock).toHaveBeenCalledWith(`/orders/${orderId}`);
    expect(wrapper.get('h1').text()).toContain('LP-DEMO-0001');
    expect(wrapper.text()).toContain('美国验证码');
    expect(wrapper.text()).toContain('标准验证包');
    expect(wrapper.text()).toContain('1,200');
    expect(wrapper.text()).toContain('+15550001001');
  });
});
