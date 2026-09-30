import type {
  AssignedNumber,
  OrderSummary,
  ProjectSummary,
} from '@linepool/contracts';

import { apiPaginatedRequest } from './api-client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoNumberStatus = '' | AssignedNumber['status'];

export interface DemoNumberRecord extends AssignedNumber {
  plan: { id: string; name: string };
}

export interface DemoNumberFilters {
  query: string;
  projectId: string;
  planId: string;
  status: DemoNumberStatus;
}

export interface DemoNumberWorkspace {
  records: DemoNumberRecord[];
  projects: ProjectSummary[];
}

export interface DemoRandomNumberResult {
  phoneNumber: string;
  project: { id: string; name: string };
  expiresAt: string;
  isMock: true;
  persisted: false;
}

export function enrichDemoNumbers(
  numbers: AssignedNumber[],
  orders: OrderSummary[],
): DemoNumberRecord[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return numbers.map((number) => ({
    ...number,
    plan: orderById.get(number.orderId)?.plan ?? { id: '', name: '未知套餐' },
  }));
}

export function filterDemoNumbers(
  records: DemoNumberRecord[],
  filters: DemoNumberFilters,
): DemoNumberRecord[] {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN');
  return records.filter((record) => {
    const searchable = [record.phoneNumber, record.project.name, record.plan.name]
      .join(' ')
      .toLocaleLowerCase('zh-CN');
    return (!query || searchable.includes(query))
      && (!filters.projectId || record.project.id === filters.projectId)
      && (!filters.planId || record.plan.id === filters.planId)
      && (!filters.status || record.status === filters.status);
  });
}

export function summarizeDemoNumbers(
  records: DemoNumberRecord[],
): { total: number; active: number; expired: number } {
  return {
    total: records.length,
    active: records.filter((record) => record.status === 'ACTIVE').length,
    expired: records.filter((record) => record.status === 'EXPIRED').length,
  };
}

export async function loadDemoNumberWorkspace(): Promise<DemoNumberWorkspace> {
  const [numberResponse, orderResponse, projectResponse] = await Promise.all([
    apiPaginatedRequest<AssignedNumber>('/numbers?page=1&pageSize=100'),
    apiPaginatedRequest<OrderSummary>('/orders?page=1&pageSize=100'),
    apiPaginatedRequest<ProjectSummary>('/projects?page=1&pageSize=100'),
  ]);
  return {
    records: enrichDemoNumbers(numberResponse.data, orderResponse.data),
    projects: projectResponse.data,
  };
}

export function createDemoRandomNumber(
  projects: ProjectSummary[],
  projectId = '',
  randomValue = Math.random(),
): DemoRandomNumberResult {
  const candidates = projects.filter((project) =>
    project.availableCount > 0 && (!projectId || project.id === projectId));
  const project = candidates[Math.min(
    candidates.length - 1,
    Math.floor(Math.max(0, randomValue) * candidates.length),
  )];
  if (!project) throw new Error('当前没有可用于演示随机取码的项目');

  const dialCode = {
    US: '+1',
    GB: '+44',
    CA: '+1',
    AU: '+61',
    SG: '+65',
  }[project.countryCode] ?? '+999';
  const suffix = Math.floor(Math.max(0, randomValue) * 10_000_000)
    .toString()
    .padStart(7, '0');

  return {
    phoneNumber: `${dialCode}555${suffix}`,
    project: { id: project.id, name: project.name },
    expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    isMock: true,
    persisted: false,
  };
}
