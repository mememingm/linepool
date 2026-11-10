import { quote, text, type Client, type Decisions, type Report, type Row, type Target } from './model.js';
import { digest } from './preflight.js';

// Literal insertion order respects immediate ownership guards; deferred schema FKs close the lease/credit cycles.
const insertionOrder = [
  'users', 'point_accounts', 'lease_plans', 'phone_numbers', 'provider_resource_bindings',
  'point_reservations', 'orders', 'leases', 'mock_fulfillment_operations', 'number_allocations',
  'whole_number_reservations', 'purchase_intents', 'recharge_orders', 'point_ledger', 'refund_orders',
  'point_exceptions', 'admin_audit', 'once_admin_idempotency', 'sms_messages', 'provider_message_receipts',
  'outbound_messages', 'provider_event_receipts', 'provider_event_attempts', 'provider_event_conflicts',
  'once_settings', 'recharge_settings',
] as const;

export function assertReviewedReport(value: unknown, decisions: Decisions): Report {
  if (!value || typeof value !== 'object') throw new Error('Expected a reviewed preflight JSON report');
  const report = value as Report;
  if (report.version !== 1 || report.targetSite !== 'once' || !report.sourceIdentity || !report.targetIdentity || !report.plan || !Array.isArray(report.plan.blockers) || report.plan.blockers.length || !/^[0-9a-f]{64}$/.test(report.sourceDigest) || !/^[0-9a-f]{64}$/.test(report.targetDigest) || report.decisionsDigest !== digest(decisions)) throw new Error('Apply requires a blocker-free preflight report generated from these exact reviewed decisions');
  if (digest(report.sourceIdentity) !== digest(decisions.source) || digest(report.targetIdentity) !== digest(decisions.target)) throw new Error('Reviewed report database identities differ from decisions');
  return report;
}

/** Completed-batch replay is a read-only operation; it never calls a wallet or provider service. */
export function completedReplay(target: Target, decisions: Decisions, sourceDigest: string): boolean {
  const batch = target.tables.once_import_batches?.find(row => row.id === decisions.batchId);
  if (!batch) return false;
  const metadata = batch.metadata as Row | null;
  const facts = target.tables.once_import_entities.filter(row => row.batch_id === decisions.batchId);
  if (batch.status !== 'COMPLETED' || batch.source_name !== decisions.sourceSystem || !metadata || metadata.sourceDigest !== sourceDigest || metadata.decisionsDigest !== digest(decisions) || digest(metadata.source) !== digest(decisions.source) || digest(metadata.target) !== digest(decisions.target) || metadata.factCount !== facts.length) throw new Error('Existing import batch has different/incomplete source facts, decisions, identities or mapping coverage');
  return true;
}

/** Called only inside the target's already locked SERIALIZABLE transaction after a fresh preflight. */
export async function applyPlan(client: Client, report: Report, decisions: Decisions): Promise<void> {
  if (report.plan.blockers.length || report.targetSite !== 'once') throw new Error('Blocked import cannot be applied');
  const metadata = { source: decisions.source, target: decisions.target, sourceDigest: report.sourceDigest, decisionsDigest: digest(decisions), approvedBy: decisions.approvedBy, reason: decisions.reason, factCount: report.plan.facts.length, counts: report.counts, sourceFrozen: true, targetFrozen: true };
  await client.query(`INSERT INTO public.once_import_batches(id,source_name,status,metadata) VALUES($1,$2,'IMPORTING',$3::jsonb)`, [decisions.batchId, decisions.sourceSystem, JSON.stringify(metadata)]);
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  for (const write of report.plan.writes) if (!(insertionOrder as readonly string[]).includes(write.table)) throw new Error(`Unsupported import write table ${write.table}`);
  for (const fact of report.plan.facts) {
    const previous = await client.query(`SELECT target_id,source_payload FROM public.once_import_entities WHERE source_system=$1 AND entity_type=$2 AND source_id=$3`, [decisions.sourceSystem, fact.entity, fact.sourceId]);
    if (previous.rows.length) {
      if (previous.rows[0].target_id !== fact.targetId || digest(previous.rows[0].source_payload) !== digest(fact.payload)) throw new Error('Immutable source mapping changed within apply');
    } else await client.query(`INSERT INTO public.once_import_entities(batch_id,source_system,entity_type,source_id,target_id,source_payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [decisions.batchId, decisions.sourceSystem, fact.entity, fact.sourceId, fact.targetId, JSON.stringify(fact.payload)]);
  }
  for (const table of insertionOrder) {
    for (const write of report.plan.writes.filter(row => row.table === table)) {
      const columns = Object.keys(write.values);
      // Every identifier was checked against information_schema during planning; no caller SQL is accepted.
      const values = columns.map(column => {
        const value = write.values[column];
        return value != null && typeof value === 'object' ? JSON.stringify(value) : value;
      });
      await client.query(`INSERT INTO public.${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, values);
    }
  }
  for (const [accountId, balance] of Object.entries(report.plan.balances)) {
    const result = await client.query(`UPDATE public.point_accounts SET available_points=$2,frozen_points=$3,updated_at=clock_timestamp() WHERE id=$1 AND user_id=$4 AND available_points=$5 AND frozen_points=$6`, [accountId, balance.available, balance.frozen, balance.userId, balance.available - balance.addedAvailable, balance.frozen - balance.addedFrozen]);
    if (result.rowCount !== 1) throw new Error('Wallet changed after preflight or account ownership differs; transaction will roll back');
  }
  // Exercise deferred references before completing the batch, while import eligibility remains active.
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await reconcileApplied(client, report);
  const mapped = await client.query<{ total: string }>('SELECT count(*)::text AS total FROM public.once_import_entities WHERE batch_id=$1', [decisions.batchId]);
  if (Number(mapped.rows[0].total) !== report.plan.facts.length) throw new Error('Import entity coverage differs from the reviewed batch');
  await client.query(`UPDATE public.once_import_batches SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1 AND status='IMPORTING'`, [decisions.batchId]);
}

async function reconcileApplied(client: Client, report: Report): Promise<void> {
  for (const [accountId, balance] of Object.entries(report.plan.balances)) {
    const { rows } = await client.query(`WITH chain AS (
      SELECT id,sequence,balance_after,frozen_after,
        sum(delta::bigint) OVER(ORDER BY sequence) AS expected_available,
        sum(frozen_delta::bigint) OVER(ORDER BY sequence) AS expected_frozen
      FROM public.point_ledger WHERE account_id=$1
    ) SELECT a.user_id,a.available_points,a.frozen_points,
      COALESCE((SELECT sum(delta::bigint) FROM public.point_ledger WHERE account_id=$1),0)::text AS available_sum,
      COALESCE((SELECT sum(frozen_delta::bigint) FROM public.point_ledger WHERE account_id=$1),0)::text AS frozen_sum,
      (SELECT count(*) FROM chain WHERE balance_after::bigint<>expected_available OR frozen_after::bigint<>expected_frozen OR expected_available<0 OR expected_frozen<0)::text AS bad_chain,
      COALESCE((SELECT sum(points::bigint) FROM public.point_reservations WHERE account_id=$1 AND status='RESERVED'),0)::text AS reserved_sum
      FROM public.point_accounts a WHERE a.id=$1`, [accountId]);
    const row = rows[0];
    if (!row || row.user_id !== balance.userId || row.available_points !== balance.available || row.frozen_points !== balance.frozen || Number(row.available_sum) !== balance.available || Number(row.frozen_sum) !== balance.frozen || Number(row.bad_chain) !== 0 || Number(row.reserved_sum) !== balance.frozen) throw new Error('Applied wallet/ledger/reservation reconciliation failed; transaction will roll back');
  }
  // Compare every inserted fact using PostgreSQL JSONB, so SQL timestamps and bigint encodings are canonical.
  for (const write of report.plan.writes) {
    const columns = Object.keys(write.values).filter(column => column !== 'password_hash');
    const parameters: unknown[] = Object.values(write.key);
    const where = Object.keys(write.key).map((column, index) => `${quote(column)} IS NOT DISTINCT FROM $${index + 1}`).join(' AND ');
    const { rows } = await client.query(`SELECT to_jsonb(t) AS actual FROM (SELECT ${columns.map(quote).join(',')} FROM public.${quote(write.table)} WHERE ${where}) t`, parameters);
    if (rows.length !== 1) throw new Error(`Applied ${write.table} fact is missing or duplicated`);
    const actual = rows[0].actual as Row;
    const expected = { ...write.values };
    if (write.table === 'point_accounts') {
      const balance = report.plan.balances[text(write.values.id)];
      expected.available_points = balance.available; expected.frozen_points = balance.frozen;
    }
    // SQL performs the cast through the target row type; ISO timestamp representation does not change facts.
    const comparison = await client.query<{ equal: boolean }>(`SELECT $1::jsonb = (SELECT to_jsonb(v) FROM (SELECT ${columns.map(column => `r.${quote(column)}`).join(',')} FROM jsonb_populate_record(NULL::public.${quote(write.table)},$2::jsonb) r) v) AS equal`, [JSON.stringify(actual), JSON.stringify(expected)]);
    if (comparison.rows[0].equal !== true) throw new Error(`Applied ${write.table} facts differ from the planned source conversion`);
  }
}
