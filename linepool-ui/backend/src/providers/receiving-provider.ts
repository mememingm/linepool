import type { PoolClient } from 'pg';
import type { CreateOrderInput } from '@linepool/contracts';
import type { PingCodeAdapter } from './pingcode-adapter.js';

/** LINEPOOL operations, not a claimed PingCode HTTP contract. All writes stay in the caller's transaction. */
export abstract class ReceivingProvider {
  abstract readonly source: 'mock';
  abstract readonly reader: PingCodeAdapter;
  abstract reserve(client: PoolClient, input: CreateOrderInput, offer: { capability: string; area_prefix: string }): Promise<string[]>;
  abstract allocate(client: PoolClient, allocation: { userId: string; orderId: string; durationDays: number; numberIds: string[] }): Promise<void>;
}

export function allocationStatus(expiresAt: Date, now = Date.now()): 'ACTIVE' | 'EXPIRED' {
  return expiresAt.getTime() > now ? 'ACTIVE' : 'EXPIRED';
}
