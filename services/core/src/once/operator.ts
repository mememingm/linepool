import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OnceAdminOperations, adminId, adminKey, adminReason, parse } from './admin-operations.js';
import { OnceIntegration } from './integration.js';
import { OnceLeases } from './leases.js';

const assignment = z.strictObject({ numberId: adminId, userId: adminId,
  term: z.number().int().min(1).max(365), amountMinor: z.literal(0).optional(),
  note: z.string().trim().max(200).optional(), reason: adminReason });

/** Explicit operator commands share the protected admin/domain operations. No HTTP operator routes. */
@Injectable()
export class OnceOperator {
  constructor(private readonly operations: OnceAdminOperations, private readonly integration: OnceIntegration,
    private readonly leases: OnceLeases) {}

  async check(actorId: string, body: unknown, key: unknown) {
    await this.operations.authorize(actorId);
    return this.integration.check(actorId, body, key);
  }

  async sync(actorId: string, body: unknown, key: unknown) {
    await this.operations.authorize(actorId);
    return this.integration.sync(actorId, body, key);
  }

  async assign(actorId: string, body: unknown, key: unknown) {
    const input = parse(assignment, body), acceptedKey = parse(adminKey, key);
    await this.operations.authorize(actorId);
    const { numberId, ...grant } = input;
    return this.leases.adminAssign(actorId, numberId, grant, acceptedKey);
  }
}
