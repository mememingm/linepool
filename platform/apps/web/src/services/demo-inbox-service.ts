import type { AssignedNumber, SmsMessage } from '@linepool/contracts';

import { apiPaginatedRequest, apiRequest } from './api-client.js';

export type DemoReadStatus = '' | 'UNREAD' | 'READ';

export interface DemoInboxRecord extends SmsMessage {
  project: { id: string; name: string } | null;
}

export interface DemoInboxFilters {
  readStatus: DemoReadStatus;
  projectId: string;
  phoneNumberId: string;
  keyword: string;
}

export function enrichDemoMessages(
  messages: SmsMessage[],
  numbers: AssignedNumber[],
): DemoInboxRecord[] {
  const numberById = new Map(numbers.map((number) => [number.id, number]));
  return messages.map((message) => ({
    ...message,
    project: numberById.get(message.phoneNumberId)?.project ?? null,
  }));
}

export function filterDemoMessages(
  records: DemoInboxRecord[],
  filters: DemoInboxFilters,
): DemoInboxRecord[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase('zh-CN');
  return records.filter((record) => {
    const searchable = [
      record.sender,
      record.body,
      record.verificationCode ?? '',
      record.phoneNumber,
      record.project?.name ?? '',
    ].join(' ').toLocaleLowerCase('zh-CN');
    const matchesReadState = filters.readStatus === ''
      || (filters.readStatus === 'READ' ? record.isRead : !record.isRead);
    return matchesReadState
      && (!filters.projectId || record.project?.id === filters.projectId)
      && (!filters.phoneNumberId || record.phoneNumberId === filters.phoneNumberId)
      && (!keyword || searchable.includes(keyword));
  });
}

export async function loadDemoInboxWorkspace(): Promise<DemoInboxRecord[]> {
  const [messageResponse, numberResponse] = await Promise.all([
    apiPaginatedRequest<SmsMessage>('/inbox?page=1&pageSize=100'),
    apiPaginatedRequest<AssignedNumber>('/numbers?page=1&pageSize=100'),
  ]);
  return enrichDemoMessages(messageResponse.data, numberResponse.data);
}

export async function markAllDemoMessagesRead(
  records: DemoInboxRecord[],
): Promise<SmsMessage[]> {
  return Promise.all(records
    .filter((record) => !record.isRead)
    .map((record) => apiRequest<SmsMessage>(`/inbox/${record.id}/read`, {
      method: 'POST',
    })));
}
