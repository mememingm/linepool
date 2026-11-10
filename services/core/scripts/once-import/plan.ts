import { randomUUID } from 'node:crypto';
import { canonicalPhoneNumber, equalJson, factKey, id, integer as n, provenanceKey, text as s, uuid, type Client, type Decisions, type Entity, type Evidence, type Fact, type Identity, type Plan, type Row, type Source, type Target } from './model.js';
import { sourceFinance } from './source-finance.js';

export class ImportPlan {
  readonly plan: Plan = { facts: [], writes: [], blockers: [], notes: [], balances: {} };
  constructor(readonly source: Source, readonly target: Target, readonly decisions: Decisions, readonly client: Client) {}
  rows(table: string): Row[] { return this.target.tables[table] ?? []; }
  async jsonEqual(left: unknown, right: unknown): Promise<boolean> { return equalJson(this.client, left, right); }

  find(entity: Entity, sourceId: unknown): Row { const row = this.source[entity].find(row => row.id === sourceId || row.key === sourceId); if (!row) throw new Error(`Missing ${entity} source reference ${String(sourceId)}`); return row; }
  mapped(entity: string, sourceId: unknown): string {
    const source = s(sourceId);
    if (entity === 'User') { const decision = this.decisions.users[source]; if (!decision) throw new Error(`Explicit user mapping missing: ${source}`); return decision.targetId; }
    if (entity === 'PointAccount') { const decision = this.decisions.accounts[source]; if (!decision) throw new Error(`Explicit wallet mapping missing: ${source}`); return decision.targetId; }
    if (entity === 'PhoneNumber') { const decision = this.decisions.numbers[source]; if (!decision) throw new Error(`Explicit resource/provenance mapping missing: ${source}`); return decision.targetId; }
    return this.decisions.ids[factKey(entity, source)]?.targetId ?? source;
  }
  nullable(entity: string, sourceId: unknown): string | null { return sourceId == null ? null : this.mapped(entity, sourceId); }
  block(code: string, entity: string, sourceId: string, details: Row): void { this.plan.blockers.push({ code, entity, sourceId, details }); }
  async each(entity: Entity, action: (row: Row) => Promise<void>): Promise<void> {
    for (const row of this.source[entity]) { try { await action(row); } catch (error) { this.block('ENTITY_CONVERSION', entity, String(row.id ?? row.key), { message: error instanceof Error ? error.message : 'Conversion failed' }); } }
  }
  evidence(evidence: Evidence[]): Row[] {
    if (!evidence.length) throw new Error('Reviewed source evidence is required');
    return evidence.map(ref => ({ entity: ref.entity, sourceId: ref.sourceId, source: this.find(ref.entity, ref.sourceId) }));
  }
  request(entity: string, row: Row): Row {
    const decision = this.decisions.requests[factKey(entity, id(row))];
    if (!decision || /REVIEW_REQUIRED/.test(decision.reason)) throw new Error(`Original canonical request/evidence missing for ${entity}:${id(row)}`);
    this.evidence(decision.evidence);
    return decision.payload;
  }
  async fact(entity: string, row: Row, targetId: string, decision: unknown = null, extra: Row = {}): Promise<boolean> {
    const sourceId = s(row.id ?? this.decisions.settingIds[s(row.key)]);
    if (!uuid.test(sourceId) || !uuid.test(targetId)) throw new Error('Import registry identities must be reviewed UUIDs');
    const payload = { source: row, decision, ...extra };
    const fact: Fact = { entity, sourceId, targetId, payload };
    const previous = this.rows('once_import_entities').find(r => r.source_system === this.decisions.sourceSystem && r.entity_type === entity && r.source_id === sourceId);
    this.plan.facts.push(fact);
    if (!previous) return true;
    if (previous.batch_id !== this.decisions.batchId) this.block('SOURCE_ALREADY_IMPORTED_IN_OTHER_BATCH', entity, sourceId, { previousBatchId: previous.batch_id });
    if (previous.target_id !== targetId || !await equalJson(this.client, previous.source_payload, payload)) this.block('MODIFIED_SOURCE_FACT', entity, sourceId, { targetId, previousTarget: previous.target_id, previous: previous.source_payload, current: payload });
    return false;
  }
  write(entity: string, row: Row, table: string, values: Row, key: Row = { id: values.id }, merge = false): void {
    const columns = this.target.columns[table] ?? [];
    for (const column of Object.keys(values)) if (!columns.includes(column)) throw new Error(`Required target schema missing ${table}.${column}`);
    this.plan.writes.push({ entity, sourceId: String(row.id ?? row.key), table, key, values, merge });
  }
  provenance(row: Row): { provider: string; accountId: string; externalAccountId: string } {
    const original = provenanceKey(s(row.provider), s(row.providerAccountId));
    const decision = this.decisions.provenance[original];
    if (!decision || /REVIEW_REQUIRED/.test(decision.reason)) throw new Error(`Review original provider/account provenance ${original}`);
    this.evidence(decision.evidence);
    if (decision.provider !== row.provider) throw new Error('Importer never rebrands original provider keys');
    if (row.provider !== 'demo' && decision.externalAccountId !== row.providerAccountId) throw new Error('Original provider account ID cannot be relabeled');
    const account = this.rows('upstream_accounts').find(a => a.provider === decision.provider && a.external_account_id === decision.externalAccountId && a.storefront_id === 'once' && a.historical_only === true && a.owner_kind === 'SELF_SERVICE');
    if (!account) throw new Error('Preprovision a matching historical-only ONCE provenance account; importer never reuses a live connection');
    return { provider: decision.provider, accountId: id(account), externalAccountId: decision.externalAccountId };
  }
  period(leaseId: unknown, time: unknown): Row {
    const timestamp = Date.parse(s(time));
    const candidates = this.plan.writes.filter(w => w.table === 'number_allocations' && w.values.lease_id === this.mapped('Lease', leaseId) && Date.parse(s(w.values.assigned_at)) <= timestamp && timestamp < Math.min(Date.parse(s(w.values.expires_at)), w.values.released_at ? Date.parse(s(w.values.released_at)) : Infinity)).map(w => w.values);
    const existing = this.rows('number_allocations').filter(r => r.lease_id === this.mapped('Lease', leaseId) && Date.parse(s(r.assigned_at)) <= timestamp && timestamp < Math.min(Date.parse(s(r.expires_at)), r.released_at ? Date.parse(s(r.released_at)) : Infinity));
    const distinct = new Map([...candidates, ...existing].map(row => [id(row), row]));
    if (distinct.size !== 1) throw new Error(`Historical occurrence requires exactly one period; lease=${s(leaseId)} time=${s(time)} matches=${distinct.size}`);
    return [...distinct.values()][0];
  }
}

export function templateFor(source: Source, sourceIdentity: Identity, targetIdentity: Identity): Decisions {
  const users: Decisions['users'] = {}, accounts: Decisions['accounts'] = {}, numbers: Decisions['numbers'] = {};
  for (const row of source.User) users[id(row)] = { targetId: id(row), mode: 'CREATE', expectedEmail: s(row.email).trim().toLowerCase(), expectedRole: row.role === 'ADMIN' ? 'ADMIN' : 'USER', expectedStatus: row.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE', reason: 'REVIEW_REQUIRED', access: { method: 'ADMIN_RESET', administratorId: '00000000-0000-4000-8000-000000000000', procedure: 'POST /api/once/admin/users/:id/password', reason: 'REVIEW_REQUIRED' } };
  for (const row of source.PointAccount) accounts[id(row)] = { targetId: id(row), reason: 'REVIEW_REQUIRED' };
  for (const row of source.PhoneNumber) numbers[id(row)] = { targetId: id(row), mode: 'CREATE', regionId: s(row.countryCode).toLowerCase(), provider: row.provider === 'demo' ? 'demo' : row.provider === 'pingcode' ? 'pingcode' : 'pingcode-mock', externalAccountId: s(row.providerAccountId), externalNumberId: row.providerNumberId == null ? null : s(row.providerNumberId), resourceStatus: row.providerStatus === 'ONLINE' ? 'ONLINE' : 'LOCAL', reason: 'REVIEW_REQUIRED', evidence: [{ entity: 'PhoneNumber', sourceId: id(row) }] };
  return { version: 1, batchId: randomUUID(), sourceSystem: 'once-legacy', source: sourceIdentity, target: targetIdentity, approvedBy: '00000000-0000-4000-8000-000000000000', reason: 'REVIEW_REQUIRED', users, accounts, numbers, ids: {}, settingIds: {}, periods: [], requests: {}, adminOperations: {}, provenance: {}, settings: null };
}

export async function planIdentities(b: ImportPlan): Promise<void> {
  const d = b.decisions;
  if (/REVIEW_REQUIRED/.test(d.reason) || !b.rows('users').some(u => u.id === d.approvedBy && u.role === 'ADMIN' && u.account_status === 'ACTIVE' && u.auth_kind === 'LOCAL' && u.local_credential_ready === true)) b.block('APPROVAL_ACTOR', 'Decisions', d.batchId, { approvedBy: d.approvedBy, reason: d.reason });
  for (const table of ['once_import_batches', 'once_import_entities', 'lease_plans', 'leases', 'whole_number_reservations', 'outbound_messages', 'refund_orders']) if (!b.target.columns[table]?.length) b.block('TARGET_MIGRATION_MISSING', table, '', { requiredMigrations: '037-040' });
  if (!b.target.columns.upstream_accounts?.includes('historical_only') || !b.target.columns.users?.includes('auth_kind')) b.block('TARGET_MIGRATION_MISSING', 'upstream_accounts', '', { requiredMigrations: '037-041' });
  for (const [entity, mappings] of Object.entries({ User: d.users, PointAccount: d.accounts, PhoneNumber: d.numbers })) for (const [sourceId, decision] of Object.entries(mappings)) if (/REVIEW_REQUIRED/.test(decision.reason)) b.block('UNREVIEWED_MAPPING', entity, sourceId, { decision });
  await b.each('User', async row => {
    const decision = d.users[id(row)];
    const targetId = b.mapped('User', id(row));
    const target = b.rows('users').find(u => u.id === targetId);
    if (s(row.email).trim().toLowerCase() !== decision.expectedEmail || row.role !== decision.expectedRole || row.status !== decision.expectedStatus || !['USER', 'ADMIN'].includes(s(row.role)) || !['ACTIVE', 'DISABLED'].includes(s(row.status))) throw new Error('Source email/role/status is unreviewed');
    const candidates = b.rows('users').filter(u => s(u.email).trim().toLowerCase() === decision.expectedEmail && u.id !== targetId);
    if (candidates.length) throw new Error(`Email belongs to another ONCE identity; importer never merges by email: ${candidates.map(id).join(',')}`);
    if (b.rows('agents').some(a => a.user_id === targetId) || b.rows('customers').some(c => c.user_id === targetId)) throw new Error('Account merge crosses an existing agent/customer ownership boundary');
    const changed = await b.fact('User', row, targetId, decision);
    if (decision.mode === 'EXISTING_ADMIN') {
      if (row.role !== 'ADMIN' || targetId !== id(row) || !target || target.email !== decision.expectedEmail || target.role !== decision.expectedRole || target.account_status !== decision.expectedStatus || target.auth_kind !== 'LOCAL' || target.local_credential_ready !== true || decision.access.method !== 'EXISTING_CORE' || /REVIEW_REQUIRED/.test(decision.access.reason)) throw new Error('Only a pre-provisioned administrator with the same UUID and reviewed existing access may be adopted; ordinary identities are never merged');
    } else {
      if (decision.expectedRole !== 'USER' || row.role !== 'USER') throw new Error('New legacy administrators require an existing protected core recovery path; importer never promotes ADMIN');
      if (decision.expectedStatus !== row.status || decision.access.method !== 'ADMIN_RESET' || decision.access.procedure !== 'POST /api/once/admin/users/:id/password') throw new Error('New users require a reviewed protected administrator reset plan');
      const administrator = b.rows('users').find(u => u.id === decision.access.administratorId && u.role === 'ADMIN' && u.account_status === 'ACTIVE' && u.auth_kind === 'LOCAL' && u.local_credential_ready === true);
      if (!administrator || /REVIEW_REQUIRED/.test(decision.access.reason)) throw new Error('The administrator reset access plan is not available');
      if (changed) b.write('User', row, 'users', { id: targetId, email: decision.expectedEmail, password_hash: '!ONCE_IMPORT_RESET_REQUIRED!', display_name: decision.expectedEmail.split('@')[0].slice(0, 80) || 'ONCE', role: 'USER', account_status: decision.expectedStatus, created_at: row.createdAt });
    }
  });
  await b.each('PointAccount', async row => {
    const targetId = b.mapped('PointAccount', id(row)), userId = b.mapped('User', row.userId);
    const existing = b.rows('point_accounts').find(a => a.user_id === userId);
    const imported = b.rows('once_import_entities').some(f => f.source_system === d.sourceSystem && f.entity_type === 'PointAccount' && f.source_id === id(row) && f.target_id === targetId);
    if (existing && (!imported || existing.id !== targetId)) throw new Error('Wallets may only replay an existing import mapping; no opening balance or existing-wallet merge');
    if (b.rows('point_accounts').some(a => a.id === targetId && a.user_id !== userId)) throw new Error('Wallet ID belongs to another user');
    if (!['ACTIVE', 'REVIEW'].includes(s(row.status))) throw new Error('Unknown source wallet status');
    if (row.status === 'REVIEW' && existing?.status === 'ACTIVE') throw new Error('A reviewed source wallet cannot be merged into an active wallet without a protected status resolution');
    const fresh = await b.fact('PointAccount', row, targetId, d.accounts[id(row)]);
    if (!b.plan.balances[targetId]) b.plan.balances[targetId] = { userId, available: Number(existing?.available_points ?? 0), frozen: Number(existing?.frozen_points ?? 0), addedAvailable: 0, addedFrozen: 0 };
    if (fresh && !existing) b.write('PointAccount', row, 'point_accounts', { id: targetId, user_id: userId, available_points: 0, frozen_points: 0, status: row.status });
  });
  await b.each('Plan', async row => {
    if (n(row.pointsPrice) <= 0) throw new Error('Source plan has no positive configured point price; configure/resolve before import');
    const targetId = b.mapped('Plan', id(row)), mapping = d.ids[factKey('Plan', id(row))];
    if (await b.fact('Plan', row, targetId, mapping ?? null)) b.write('Plan', row, 'lease_plans', { id: targetId, storefront_id: 'once', days: row.days, price_minor: row.priceMinor, points_price: row.pointsPrice, currency: row.currency, version: row.version, label: row.label, note: row.note, active: row.active, sort_order: row.sortOrder, created_at: row.createdAt, updated_at: row.updatedAt }, { id: targetId }, mapping !== undefined);
  });
  await b.each('PhoneNumber', async row => {
    const decision = d.numbers[id(row)], targetId = b.mapped('PhoneNumber', id(row));
    b.evidence(decision.evidence);
    const provenance = b.provenance(row);
    if (decision.provider !== row.provider || decision.provider !== provenance.provider || decision.externalAccountId !== provenance.externalAccountId || decision.externalNumberId !== row.providerNumberId) throw new Error('Resource original provider/account/external ID differs from reviewed provenance; no synthetic binding IDs');
    if (!b.rows('regions').some(r => r.id === decision.regionId) || decision.regionId !== s(row.countryCode).toLowerCase()) throw new Error('countryCode must map to an existing core country, never source state regionId');
    if (row.resourceExpiresAt != null && !Number.isFinite(Date.parse(s(row.resourceExpiresAt)))) throw new Error('Invalid source resource expiry');
    if (row.provider !== 'demo' && !row.providerNumberId) throw new Error('Non-demo resource lacks original external number identity');
    const number = canonicalPhoneNumber(row.number);
    const existing = b.rows('phone_numbers').find(r => r.id === targetId);
    if (decision.mode === 'MERGE' && (!existing || existing.phone_number !== number || existing.upstream_account_id !== provenance.accountId || existing.region_id !== decision.regionId)) throw new Error('Resource merge would change existing phone/account/country identity');
    const changed = await b.fact('PhoneNumber', row, targetId, decision, { provenance, normalizedNumber: number });
    if (changed && decision.mode === 'CREATE') b.write('PhoneNumber', row, 'phone_numbers', { id: targetId, region_id: decision.regionId, phone_number: number, upstream_account_id: provenance.accountId, capability: row.smsEnabled ? 'SEND_RECEIVE' : 'RECEIVE', resource_status: decision.resourceStatus, resource_expires_at: row.resourceExpiresAt, sale_enabled: false, display_metadata: { originalNumber: row.number, countryCode: row.countryCode, countryName: row.countryName, regionId: row.regionId, regionName: row.regionName, source: row.source, note: row.note, provider: row.provider, providerAccountId: row.providerAccountId, providerStatus: row.providerStatus, lastSyncedAt: row.lastSyncedAt }, manual_hold: true, hold_reason: row.holdReason ?? 'Historical import; excluded from live inventory', hold_updated_at: null, created_at: row.createdAt });
    if (changed && decision.externalNumberId !== null) b.write('PhoneNumber', row, 'provider_resource_bindings', { provider: provenance.provider, external_number_id: decision.externalNumberId, number_id: targetId, external_project_id: null, created_at: row.createdAt }, { provider: provenance.provider, external_number_id: decision.externalNumberId }, decision.mode === 'MERGE');
  });
  try { b.plan.blockers.push(...sourceFinance(b.source)); }
  catch (error) { b.block('SOURCE_FINANCE_SHAPE', 'PointAccount', '', { message: error instanceof Error ? error.message : 'Invalid financial source shape' }); }
}
