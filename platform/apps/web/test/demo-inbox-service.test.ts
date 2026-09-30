import type { AssignedNumber, SmsMessage } from '@linepool/contracts';
import { describe, expect, it } from 'vitest';

import {
  enrichDemoMessages,
  filterDemoMessages,
} from '../src/services/demo-inbox-service.js';

const number: AssignedNumber = {
  id: '50000000-0000-4000-8000-000000000001',
  phoneNumber: '+15550001001',
  project: {
    id: '20000000-0000-4000-8000-000000000001',
    name: '美国验证码',
  },
  orderId: '10000000-0000-4000-8000-000000000001',
  status: 'ACTIVE',
  assignedAt: '2026-09-28T08:00:00.000Z',
  expiresAt: '2026-10-30T08:00:00.000Z',
};

function message(overrides: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    phoneNumberId: number.id,
    phoneNumber: number.phoneNumber,
    sender: 'LINEPOOL Demo',
    body: '您的演示验证码是 482913。',
    verificationCode: '482913',
    receivedAt: '2026-09-30T08:00:00.000Z',
    isRead: false,
    ...overrides,
  };
}

describe('demo inbox service', () => {
  it('joins project data without deriving a view from message age', () => {
    const records = enrichDemoMessages([
      message(),
      message({
        id: '70000000-0000-4000-8000-000000000002',
        receivedAt: '2026-09-28T08:00:00.000Z',
        isRead: true,
      }),
    ], [number]);

    expect(records).toHaveLength(2);
    expect(records[0]).not.toHaveProperty('view');
    expect(records[1]).not.toHaveProperty('view');
    expect(records[0]?.project?.name).toBe('美国验证码');
  });

  it('combines read state, project, number, and keyword filters', () => {
    const records = enrichDemoMessages([
      message(),
      message({
        id: '70000000-0000-4000-8000-000000000002',
        receivedAt: '2026-09-28T08:00:00.000Z',
        isRead: true,
      }),
    ], [number]);

    expect(filterDemoMessages(records, {
      readStatus: 'UNREAD',
      projectId: number.project.id,
      phoneNumberId: number.id,
      keyword: '482913',
    })).toHaveLength(1);
    expect(filterDemoMessages(records, {
      readStatus: 'READ',
      projectId: '',
      phoneNumberId: '',
      keyword: '',
    })).toHaveLength(1);
  });
});
