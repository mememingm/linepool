import { createHash } from 'node:crypto';
import type { PcCapability, PcConnection, PcPlan } from '@linepool/contracts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type ConnectionRow = {
  id: string; provider: string; external_account_id: string; storefront_id: 'linepool' | 'once';
  owner_kind: 'SELF_SERVICE' | 'AGENT'; agent_id: string | null; status: string;
  application_id: string | null; issuer: string | null; subject: string | null;
  auth_status: PcConnection['status']; capabilities: PcCapability[]; enabled_capabilities: PcCapability[];
  access_token: string | null; refresh_token: string | null; access_expires_at: Date | null; refresh_expires_at: Date | null;
  token_version: string; refresh_claim_id: string | null; refresh_claim_deadline: Date | null;
  poll_claim_id: string | null; poll_claim_deadline: Date | null; poll_version: string; message_cursor: string;
  message_checkpoint?: PcMessageCheckpoint | null;
  last_synced_at: Date | null; next_poll_at: Date | null; problem: string | null;
};
export type PlanRow = { id: string; name: string; duration_days: number; amount_minor: string; currency: string;
  capability: PcCapability; enabled: boolean };
export const connectionView = (row: ConnectionRow, moduleEnabled: boolean): PcConnection => ({
  id: row.id, ownerKind: row.owner_kind, agentId: row.agent_id, externalAccountId: row.external_account_id,
  siteId: row.storefront_id, status: row.auth_status, capabilities: moduleEnabled ? row.capabilities : [], enabledCapabilities: moduleEnabled ? row.enabled_capabilities : [],
  accessExpiresAt: row.access_expires_at?.toISOString() ?? null, refreshExpiresAt: row.refresh_expires_at?.toISOString() ?? null,
  lastSyncedAt: row.last_synced_at?.toISOString() ?? null, nextPollAt: row.next_poll_at?.toISOString() ?? null, problem: row.problem,
});
export const planView = (row: PlanRow): PcPlan => ({ id: row.id, name: row.name, durationDays: row.duration_days,
  amountMinor: Number(row.amount_minor), currency: row.currency, capability: row.capability, enabled: row.enabled });
export type AuthState = { state_hash: string; browser_hash: string; site_id: string; application_id: string; issuer: string;
  callback_url: string; purpose: 'AGENT_LOGIN' | 'REAUTHORIZE' | 'SELF_SERVICE'; requested_user_id: string | null;
  expected_connection_id: string | null; expected_subject: string | null; expected_external_account_id: string | null;
  expires_at: Date; consumed_at: Date | null; code_verifier?: string | null };
export type PcMessageCheckpoint = { version: 1; completedThrough: string | null;
  scan: { createdAfter: string | null; cursor: string; headCreatedAt: string | null } | null };
export type PcResource = Omit<MockResource, 'phone_number' | 'resource_expires_at'> & {
  phone_number: string | null; resource_expires_at: Date | null;
};
export type MockFixture = { site_id: string; application_id: string; issuer: string; fixture_key: string; subject: string;
  external_account_id: string; display_name: string; application_enabled: boolean; owner_kind: 'SELF_SERVICE' | 'AGENT';
  capabilities: PcCapability[]; created_at: Date };
export type MockTokens = { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date };
export type MockResource = { external_number_id: string; phone_number: string; region_id: string;
  external_project_id: string | null; platform_id: string | null; capabilities: PcCapability[];
  source_available: boolean; resource_expires_at: Date };
export type MockSnapshotProgress = { complete: boolean; pageSize: number; successfulPages: number; fetchedCount: number;
  failedPage: number | null; pages: {
    cursor: string | null; nextCursor: string | null; fetchedCount: number; status: 'SUCCEEDED' | 'FAILED';
  }[] };
