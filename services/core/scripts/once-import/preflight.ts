import { createHash } from 'node:crypto';
import { clean, factKey, id, integer, sameDatabase, text, type Client, type Decisions, type Identity, type Report, type Row, type Source, type Target, type WriteRow } from './model.js';
import { ImportPlan, planIdentities, templateFor } from './plan.js';
import { planBusiness } from './business.js';
import { planFinance } from './finance.js';
import { planMessages } from './messages.js';
import { planAdministration } from './administration.js';
import { targetTables } from './snapshot.js';

/** Stable review digest, independent of JSON object key ordering. No credentials are included. */
export function digest(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)]));
    return item;
  };
  const json = JSON.stringify(canonical(clean(value)));
  if (json === undefined) throw new Error('Cannot review a missing source fact');
  return createHash('sha256').update(json).digest('hex');
}

const uniqueKeys: Record<string, string[][]> = {
  users: [['email']], point_accounts: [['user_id']], lease_plans: [['storefront_id', 'days']],
  phone_numbers: [['phone_number']], provider_resource_bindings: [['provider', 'external_number_id'], ['number_id', 'provider']],
  leases: [['initial_order_id']], orders: [['order_number'], ['user_id', 'idempotency_key']],
  point_reservations: [['account_id', 'kind', 'business_id']],
  point_ledger: [['account_id', 'type', 'business_id'], ['recharge_order_id']],
  recharge_orders: [['order_number'], ['user_id', 'idempotency_key'], ['points_ledger_id'], ['provider_transaction_id'], ['mock_provider_transaction_id']],
  purchase_intents: [['order_id']],
  mock_fulfillment_operations: [['request_id']],
  outbound_messages: [['lease_id', 'idempotency_key'], ['provider', 'provider_message_id']],
  provider_message_receipts: [['provider', 'external_message_id']], provider_event_receipts: [['provider', 'event_id']],
};

export async function createReport(source: Source, target: Target, sourceIdentity: Identity, decisions: Decisions | null, client: Client): Promise<Report> {
  const template = templateFor(source, sourceIdentity, target.identity);
  const reviewed = decisions ?? template;
  const b = new ImportPlan(source, target, reviewed, client);
  const sourceDigest = digest(source), decisionsDigest = decisions ? digest(decisions) : null;
  if (sameDatabase(sourceIdentity, target.identity)) b.block('SOURCE_EQUALS_TARGET', 'Database', '', {});
  if (target.siteId !== 'once') b.block('TARGET_SITE_MISMATCH', 'Database', target.identity.database, { actual: target.siteId, requiredDatabaseSetting: 'app.site_id=once' });
  if (!decisions) b.block('REVIEWED_DECISIONS_REQUIRED', 'Decisions', '', { instruction: 'Review source facts and complete the template; rerun preflight with --decisions' });
  if (digest(reviewed.source) !== digest(sourceIdentity) || digest(reviewed.target) !== digest(target.identity)) b.block('DECISION_DATABASE_IDENTITY', 'Decisions', reviewed.batchId, { expectedSource: sourceIdentity, expectedTarget: target.identity });
  for (const table of targetTables) if (!target.columns[table]?.length) b.block('TARGET_TABLE_MISSING', table, '', { requiredMigrations: '001-026,028-032,037-041' });
  const lpOrders = b.rows('orders').filter(row => row.product_type === 'SMS_CODE' || row.sales_storefront_id === 'linepool');
  const lpNumbers = b.rows('phone_numbers').filter(row => b.rows('upstream_accounts').some(account => account.id === row.upstream_account_id && account.storefront_id === 'linepool'));
  const lpReceipts = b.rows('provider_message_receipts').filter(row => b.rows('upstream_accounts').some(account => account.id === row.upstream_account_id && account.storefront_id === 'linepool'));
  if (lpOrders.length || lpNumbers.length || lpReceipts.length || b.rows('number_allocations').some(row => row.allocation_type === 'PLATFORM')) b.block('TARGET_CONTAINS_LINEPOOL_BUSINESS', 'Database', target.identity.database, { orderIds: lpOrders.map(id), numberIds: lpNumbers.map(id), receiptCount: lpReceipts.length });
  const inspectReasons = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'reason' && (typeof item !== 'string' || /REVIEW_REQUIRED/.test(item))) b.block('UNREVIEWED_DECISION', 'Decisions', path, {});
      else inspectReasons(item, `${path}.${key}`);
    }
  };
  inspectReasons(reviewed, 'decisions');
  // No coalescing distinct legacy identities or wallets, including within a single decision document.
  for (const [entity, mappings] of Object.entries({ User: reviewed.users, PointAccount: reviewed.accounts, PhoneNumber: reviewed.numbers })) {
    const targets = new Map<string, string>();
    for (const [sourceId, mapping] of Object.entries(mappings)) {
      if (targets.has(mapping.targetId)) b.block('MANY_TO_ONE_MAPPING', entity, sourceId, { otherSource: targets.get(mapping.targetId), targetId: mapping.targetId });
      targets.set(mapping.targetId, sourceId);
      if (!source[entity as 'User' | 'PointAccount' | 'PhoneNumber'].some(row => row.id === sourceId)) b.block('UNKNOWN_MAPPING_SOURCE', entity, sourceId, {});
    }
  }
  const emails = new Map<string, string>();
  for (const row of source.User) {
    const email = text(row.email).trim().toLowerCase();
    if (emails.has(email)) b.block('SOURCE_EMAIL_COLLISION', 'User', id(row), { otherSource: emails.get(email), email });
    emails.set(email, id(row));
  }
  for (const [key, decision] of Object.entries(reviewed.ids)) {
    const separator = key.indexOf(':');
    const entity = key.slice(0, separator), sourceId = key.slice(separator + 1);
    if (!(entity in source) || !source[entity as keyof Source].some(row => row.id === sourceId)) b.block('UNKNOWN_ID_REMAP', entity, sourceId, { decision });
    if (['User', 'PointAccount', 'PhoneNumber'].includes(entity)) b.block('COMPETING_ID_REMAP', entity, sourceId, {});
  }
  const provenanceTargets = new Map<string, string>();
  for (const [sourcePair, mapping] of Object.entries(reviewed.provenance)) {
    const targetPair = JSON.stringify([mapping.provider, mapping.externalAccountId]);
    if (provenanceTargets.has(targetPair)) b.block('MANY_TO_ONE_PROVENANCE', 'Decisions', sourcePair, { otherSourcePair: provenanceTargets.get(targetPair), targetPair });
    provenanceTargets.set(targetPair, sourcePair);
  }
  for (const period of reviewed.periods) {
    if (!source.Lease.some(row => row.id === period.leaseId) || !source.Order.some(row => row.id === period.orderId && row.leaseId === period.leaseId)) b.block('UNKNOWN_PERIOD_SOURCE', 'ServicePeriod', period.id, { leaseId: period.leaseId, orderId: period.orderId });
  }
  await planIdentities(b);
  await planBusiness(b);
  await planFinance(b);
  await planMessages(b);
  await planAdministration(b);
  checkFinancialBindings(b);
  await checkWrites(b);
  checkPeriods(b);
  // Every selected source row must survive in an immutable source mapping, including evidence-only entities.
  for (const [entity, rows] of Object.entries(source)) for (const row of rows) {
    const sourceId = row.id ?? reviewed.settingIds[text(row.key)];
    if (!b.plan.facts.some(fact => fact.entity === entity && fact.sourceId === sourceId)) b.block('UNMAPPED_SOURCE_FACT', entity, String(row.id ?? row.key), {});
  }
  return { version: 1, sourceIdentity, targetIdentity: target.identity, source, sourceDigest, targetDigest: digest(target), decisionsDigest, targetSite: target.siteId, template, plan: b.plan, counts: Object.fromEntries(Object.entries(source).map(([entity, rows]) => [entity, rows.length])) };
}

function checkFinancialBindings(b: ImportPlan): void {
  for (const reservation of b.source.PointReservation.filter(row => row.kind === 'ORDER')) {
    const targetId = b.decisions.ids[factKey('PointReservation', id(reservation))]?.targetId ?? id(reservation);
    const rows = [...b.rows('point_ledger'), ...b.plan.writes.filter(write => write.table === 'point_ledger').map(write => write.values)].filter(row => row.reservation_id === targetId);
    const reserves = rows.filter(row => row.type === 'ORDER_RESERVE'), captures = rows.filter(row => row.type === 'ORDER_CAPTURE'), releases = rows.filter(row => row.type === 'ORDER_RELEASE');
    const refunded = rows.filter(row => row.type === 'ORDER_REFUND').reduce((sum, row) => sum + Number(row.delta), 0);
    const expectedCapture = reservation.status === 'CAPTURED' ? 1 : 0, expectedRelease = reservation.status === 'RELEASED' ? 1 : 0;
    if (reserves.length !== 1 || captures.length !== expectedCapture || releases.length !== expectedRelease || refunded !== reservation.refundedPoints) b.block('RESERVATION_LEDGER_BINDING', 'PointReservation', id(reservation), { reserveIds: reserves.map(id), captureIds: captures.map(id), releaseIds: releases.map(id), refunded, expectedRefunded: reservation.refundedPoints });
    for (const row of rows) {
      const points = integer(reservation.points), delta = Number(row.delta), frozen = Number(row.frozen_delta);
      const valid = row.type === 'ORDER_RESERVE' ? delta === -points && frozen === points : row.type === 'ORDER_CAPTURE' ? delta === 0 && frozen === -points : row.type === 'ORDER_RELEASE' ? delta === points && frozen === -points : row.type === 'ORDER_REFUND' ? delta > 0 && frozen === 0 : false;
      if (!valid) b.block('RESERVATION_LEDGER_VECTOR', 'PointLedger', id(row), { reservationId: id(reservation), delta, frozen, type: row.type });
    }
  }
  for (const account of b.source.PointAccount) {
    const targetId = b.decisions.accounts[id(account)]?.targetId;
    const balance = targetId ? b.plan.balances[targetId] : null;
    if (!balance || balance.available !== account.availablePoints || balance.frozen !== account.frozenPoints) b.block('TARGET_ACCOUNT_TOTAL', 'PointAccount', id(account), { expectedAvailable: account.availablePoints, expectedFrozen: account.frozenPoints, planned: balance ?? null });
  }
  for (const row of b.plan.writes.filter(write => write.table === 'point_ledger')) {
    const value = row.values, delta = Number(value.delta), frozen = Number(value.frozen_delta);
    const valid = value.type === 'LEGACY_ZERO' ? delta === 0 && frozen === 0 : ['REFUND_RESERVE', 'ORDER_RESERVE'].includes(String(value.type)) ? delta < 0 && frozen === -delta : ['REFUND_CAPTURE', 'ORDER_CAPTURE'].includes(String(value.type)) ? delta === 0 && frozen < 0 : ['REFUND_RELEASE', 'ORDER_RELEASE'].includes(String(value.type)) ? delta > 0 && frozen === -delta : ['ORDER_REFUND', 'COMPENSATION'].includes(String(value.type)) ? delta > 0 && frozen === 0 : value.type === 'COMPENSATION_REVOKE' ? delta < 0 && frozen === 0 : ['RECHARGE', 'SEED_CREDIT'].includes(String(value.type)) && delta > 0 && frozen === 0;
    if (!valid) b.block('LEDGER_VECTOR', 'PointLedger', row.sourceId, { type: value.type, delta, frozen });
  }
}

async function checkWrites(b: ImportPlan): Promise<void> {
  const kept: WriteRow[] = [];
  for (const write of b.plan.writes) {
    const sameKey = (row: Row) => Object.entries(write.key).every(([key, value]) => row[key] === value);
    const previous = kept.find(other => other.table === write.table && sameKey(other.values));
    if (previous) {
      const receipts = write.table === 'provider_message_receipts';
      const equal = receipts ? await b.jsonEqual([previous.values.normalized_payload, previous.values.upstream_account_id, previous.values.message_id], [write.values.normalized_payload, write.values.upstream_account_id, write.values.message_id]) : await b.jsonEqual(previous.values, write.values);
      if (!equal) b.block('PLANNED_KEY_CONFLICT', write.entity, write.sourceId, { table: write.table, key: write.key });
      continue;
    }
    const existing = b.rows(write.table).find(sameKey);
    if (existing) {
      if (!write.merge) b.block('TARGET_ID_COLLISION', write.entity, write.sourceId, { table: write.table, key: write.key });
      else {
        const columns = write.table === 'provider_resource_bindings' ? ['provider', 'external_number_id', 'external_project_id', 'number_id'] : Object.keys(write.values).filter(column => !['created_at', 'updated_at', 'updated_by', 'version'].includes(column));
        if (!await b.jsonEqual(Object.fromEntries(columns.map(column => [column, existing[column]])), Object.fromEntries(columns.map(column => [column, write.values[column]])))) b.block('TARGET_CONFIGURATION_CONFLICT', write.entity, write.sourceId, { table: write.table, key: write.key });
      }
      // A reviewed existing binding/identical setting is adopted without any UPDATE.
      continue;
    }
    for (const keys of [['id'], ...(uniqueKeys[write.table] ?? [])]) {
      if (keys.some(key => write.values[key] == null)) continue;
      const collision = [...b.rows(write.table), ...kept.filter(other => other.table === write.table).map(other => other.values)].find(row => keys.every(key => row[key] === write.values[key]));
      if (collision) b.block('BUSINESS_KEY_COLLISION', write.entity, write.sourceId, { table: write.table, columns: keys, values: Object.fromEntries(keys.map(key => [key, write.values[key]])), existingId: collision.id ?? null });
    }
    kept.push(write);
  }
  b.plan.writes = kept;
}

function checkPeriods(b: ImportPlan): void {
  const periods = [...b.rows('number_allocations'), ...b.plan.writes.filter(write => write.table === 'number_allocations').map(write => write.values)].filter(row => row.allocation_type === 'WHOLE_NUMBER');
  const byNumber = new Map<string, Row[]>();
  for (const period of periods) {
    const start = Date.parse(text(period.assigned_at)), end = Math.min(Date.parse(text(period.expires_at)), period.released_at == null ? Infinity : Date.parse(text(period.released_at)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) b.block('INVALID_PERIOD', 'ServicePeriod', id(period), {});
    const previous = byNumber.get(text(period.number_id)) ?? [];
    if (end > start) for (const other of previous) {
      const otherEnd = Math.min(Date.parse(text(other.expires_at)), other.released_at == null ? Infinity : Date.parse(text(other.released_at)));
      if (start < otherEnd && Date.parse(text(other.assigned_at)) < end) b.block('WHOLE_PERIOD_OVERLAP', 'ServicePeriod', id(period), { otherPeriodId: id(other), numberId: period.number_id });
    }
    previous.push(period); byNumber.set(text(period.number_id), previous);
  }
  const held = new Map<string, string>();
  for (const lease of [...b.rows('leases'), ...b.plan.writes.filter(write => write.table === 'leases').map(write => write.values)].filter(row => ['ACTIVE', 'EXPIRED_HELD'].includes(String(row.status)))) {
    const number = text(lease.number_id);
    if (held.has(number)) b.block('MULTIPLE_HELD_LEASES', 'Lease', id(lease), { otherLeaseId: held.get(number), numberId: number });
    held.set(number, id(lease));
  }
}
