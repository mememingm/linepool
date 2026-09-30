import type { AssignedNumber, OrderSummary, ProjectSummary } from '@linepool/contracts';
import { describe, expect, it } from 'vitest';

import {
  createDemoRandomNumber,
  enrichDemoNumbers,
  filterDemoNumbers,
  summarizeDemoNumbers,
} from '../src/services/demo-number-service.js';

const project = {
  id: '20000000-0000-4000-8000-000000000001',
  name: '美国验证码',
};
const orderId = '10000000-0000-4000-8000-000000000001';

const orders: OrderSummary[] = [{
  id: orderId,
  orderNumber: 'LP-DEMO-0001',
  project,
  plan: {
    id: '30000000-0000-4000-8000-000000000001',
    name: '标准验证包',
  },
  quantity: 1,
  totalPoints: 1_200,
  status: 'COMPLETED',
  createdAt: '2026-09-29T10:00:00.000Z',
}];

function number(overrides: Partial<AssignedNumber> = {}): AssignedNumber {
  return {
    id: '50000000-0000-4000-8000-000000000001',
    phoneNumber: '+15550001001',
    project,
    orderId,
    status: 'ACTIVE',
    assignedAt: '2026-09-30T08:00:00.000Z',
    expiresAt: '2026-10-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('demo number service', () => {
  it('joins plan data without deriving a status from timestamps', () => {
    const records = enrichDemoNumbers([
      number(),
      number({
        id: '50000000-0000-4000-8000-000000000002',
        phoneNumber: '+15550001002',
        assignedAt: '2026-09-28T08:00:00.000Z',
      }),
      number({
        id: '50000000-0000-4000-8000-000000000003',
        phoneNumber: '+15550001003',
        status: 'EXPIRED',
        expiresAt: '2026-10-20T12:00:00.000Z',
      }),
    ], orders);

    expect(records.map((record) => record.status)).toEqual([
      'ACTIVE',
      'ACTIVE',
      'EXPIRED',
    ]);
    expect(records[0]).not.toHaveProperty('displayStatus');
    expect(records[0]?.plan.name).toBe('标准验证包');
    expect(summarizeDemoNumbers(records)).toEqual({
      total: 3,
      active: 2,
      expired: 1,
    });
  });

  it('combines search, project, plan, and status filters', () => {
    const records = enrichDemoNumbers([number()], orders);

    expect(filterDemoNumbers(records, {
      query: '标准',
      projectId: project.id,
      planId: orders[0]!.plan.id,
      status: 'ACTIVE',
    })).toHaveLength(1);
    expect(filterDemoNumbers(records, {
      query: '英国',
      projectId: '',
      planId: '',
      status: '',
    })).toHaveLength(0);
  });

  it('returns a clearly marked non-persistent random number result', () => {
    const projects: ProjectSummary[] = [{
      id: project.id,
      slug: 'us-verification',
      name: project.name,
      countryCode: 'US',
      countryName: '美国',
      description: '演示项目',
      accentColor: '#246bfd',
      isActive: true,
      availableCount: 3,
      minPoints: 1_200,
    }];

    const result = createDemoRandomNumber(projects, project.id, 0.1234567);

    expect(result.project.name).toBe(project.name);
    expect(result.phoneNumber).toMatch(/^\+1/);
    expect(result.isMock).toBe(true);
    expect(result.persisted).toBe(false);
  });
});
