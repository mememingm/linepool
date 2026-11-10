import { Injectable } from '@nestjs/common';
import type { CreateRenewalInput, NumberUsage, RenewalOptions, UsageScenario } from '@linepool/contracts';

export type NumberResource = { id: string; phoneNumber: string; expiresAt: string; allocationId: string };
export type RenewalIntent = CreateRenewalInput & { id: string; number: NumberResource };
export type RenewalAcknowledgement = { source: 'mock' | 'live'; status: 'PENDING' | 'FAILED'; failureReason: string | null };

/** Replace the DI binding with a server-side PingCode adapter once its contract is agreed.
 * Submission is only an acknowledgement. Verified completion must be handled separately,
 * updating renewals and phone_numbers together; a browser can never confirm success.
 */
export abstract class NumberServiceProvider {
  abstract renewalOptions(number: NumberResource): Promise<RenewalOptions>;
  abstract requestRenewal(intent: RenewalIntent): Promise<RenewalAcknowledgement>;
  abstract usage(number: NumberResource, scenario?: UsageScenario): Promise<NumberUsage>;
}

@Injectable()
export class MockNumberServiceProvider extends NumberServiceProvider {
  private readonly snapshotAt = new Date().toISOString();
  async renewalOptions(number: NumberResource): Promise<RenewalOptions> {
    const base = Math.max(Date.now(), Date.parse(number.expiresAt));
    return {
      numberId: number.id, currentExpiresAt: number.expiresAt, source: 'mock',
      options: [7, 30].map(durationDays => ({
        durationDays, totalPoints: null, estimatedExpiresAt: new Date(base + durationDays * 86400000).toISOString(),
      })),
    };
  }
  async requestRenewal(_intent: RenewalIntent): Promise<RenewalAcknowledgement> {
    // No charge, supplier execution, simulated completion, or expiry mutation.
    return { source: 'mock', status: 'PENDING', failureReason: null };
  }
  async usage(number: NumberResource, scenario: UsageScenario = 'standard'): Promise<NumberUsage> {
    const snapshot: NumberUsage = {
      numberId: number.id, source: 'mock', updatedAt: this.snapshotAt,
      sms: { kind: 'metered', total: 100, used: 36, remaining: 64 },
      voice: { kind: 'metered', total: 60, used: 12, remaining: 48 },
      data: { kind: 'metered', total: 1024, used: 256, remaining: 768 },
    };
    if (scenario === 'unlimited') return { ...snapshot, sms: { kind: 'unlimited', used: 136 }, voice: { kind: 'unlimited', used: null }, data: { kind: 'unlimited', used: 2048 } };
    if (scenario !== 'standard') {
      const quota = { kind: scenario };
      return { ...snapshot, updatedAt: scenario === 'error' ? null : snapshot.updatedAt, sms: quota, voice: quota, data: quota };
    }
    return snapshot;
  }
}
