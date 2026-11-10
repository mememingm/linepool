import { factKey, id, integer as n, record, text as s, type Row } from './model.js';
import { ImportPlan } from './plan.js';

const successful = (row: Row) => ['PAID', 'COMPLETED', 'DEMO_CONFIRMED', 'SUCCEEDED'].includes(s(row.status));
const operation = (row: Row) => row.kind === 'RENT' ? 'RENT' : row.kind === 'RENEW' ? 'RENEW' : row.kind === 'ADMIN_ASSIGN' ? 'ADMIN_ASSIGN' : row.kind === 'ADMIN_EXTEND' ? 'ADMIN_EXTEND' : null;
const instant = (value: unknown): number => { const result = Date.parse(s(value)); if (!Number.isFinite(result)) throw new Error('Missing actual timestamp evidence'); return result; };

/** A final Lease.expiresAt is a consistency check, never a period reconstruction input. */
export async function planBusiness(b: ImportPlan): Promise<void> {
  await b.each('Order', async row => {
    const kind = operation(row);
    if (!kind) throw new Error(`Unsupported original order operation ${s(row.kind)}`);
    const number = row.phoneNumberId ? b.find('PhoneNumber', row.phoneNumberId) : b.source.PhoneNumber.find(p => p.number === row.numberSnapshot);
    if (!number) throw new Error('Original order number identity is missing');
    const plan = b.source.Plan.find(p => p.days === row.termDays);
    const administrative = kind === 'ADMIN_ASSIGN' || kind === 'ADMIN_EXTEND';
    const compensation = row.settlementType === 'COMPENSATION';
    if (!['POINTS', 'LEGACY', 'COMPENSATION'].includes(s(row.settlementType))) throw new Error('Unsupported original settlement type');
    if (!plan && !(kind === 'ADMIN_EXTEND')) throw new Error('Original order term has no configured plan');
    const points = row.settlementType === 'POINTS' ? n(row.pointsAmount) : 0;
    if (compensation && (points !== 0 || n(row.amountMinor) !== 0)) throw new Error('Compensation cannot carry a paid amount');
    if (row.settlementType === 'POINTS' && !row.reservationId) throw new Error('Paid order lacks original ORDER reservation');
    const targetId = b.mapped('Order', id(row)), payload = b.request('Order', row);
    const status = successful(row) ? 'SUCCEEDED' : ({ PENDING: 'PENDING', PROCESSING: 'PROCESSING', UNCERTAIN: 'UNCERTAIN', FAILED: 'FAILED', DEMO_FAILED: 'FAILED' } as Record<string, string>)[s(row.status)];
    if (!status) throw new Error(`Unsupported original order status ${s(row.status)}`);
    if (!['SUCCEEDED', 'FAILED'].includes(status) || row.claimUntil != null) throw new Error('Unfinished financial order must settle in source before import');
    if (await b.fact('Order', row, targetId, b.decisions.ids[factKey('Order', id(row))] ?? null, { request: payload })) {
      b.write('Order', row, 'orders', { id: targetId, order_number: `ONCE-${id(row)}`, user_id: b.mapped('User', row.userId), region_id: b.decisions.numbers[id(number)].regionId, service: null, plan: null, plan_name: plan?.label ?? `Administrative ${n(row.termDays)} days`, quantity: 1, unit_points: points, total_points: points, duration_days: row.termDays, idempotency_key: row.idempotencyKey, created_at: row.createdAt, fulfillment_status: status === 'SUCCEEDED' ? 'COMPLETED' : status === 'FAILED' ? 'FAILED' : 'PENDING', completed_at: status === 'SUCCEEDED' ? row.completedAt : null, source_channel: administrative ? 'ADMIN' : 'DIRECT', product_type: 'NUMBER_LEASE', operation_kind: kind, settlement_type: row.settlementType === 'POINTS' ? 'POINTS' : compensation ? 'COMPENSATION' : 'HISTORICAL_NON_POINT', sales_storefront_id: 'once', lease_plan_id: plan ? b.mapped('Plan', id(plan)) : null, lease_id: b.nullable('Lease', row.leaseId), target_number_id: b.mapped('PhoneNumber', id(number)), number_snapshot: row.numberSnapshot ?? number.number, quote_version: row.quoteVersion, amount_minor: row.amountMinor, currency: row.currency, request_payload: payload, point_reservation_id: row.settlementType === 'POINTS' ? b.nullable('PointReservation', row.reservationId) : null, import_batch_id: b.decisions.batchId });
      b.write('Order', row, 'mock_fulfillment_operations', { order_id: targetId, status, request_id: targetId, attempts: row.attempts, claim_until: null, scenario: row.mockScenario ?? 'SUCCESS', provider_order_id: row.providerOrderId, checked_at: row.checkedAt, evidence: JSON.stringify(row.evidence), evidence_data: { source: row, historicalOnly: true }, created_at: row.createdAt, updated_at: row.completedAt ?? row.checkedAt ?? row.createdAt }, { order_id: targetId });
    }
  });
  await b.each('Lease', async lease => {
    const completedOrders = b.source.Order.filter(o => o.leaseId === id(lease) && successful(o));
    if (!completedOrders.length) throw new Error('Lease has no successful initial order evidence');
    if (completedOrders.some(o => o.userId !== lease.userId || o.phoneNumberId !== lease.phoneNumberId)) throw new Error('Lease completion changes immutable user/number identity');
    const periods = b.decisions.periods.filter(p => p.leaseId === id(lease));
    if (periods.length !== completedOrders.length) throw new Error('Every completed initial/renewal/compensation order needs one reviewed period');
    const ordered = periods.map(period => {
      const order = completedOrders.find(o => id(o) === period.orderId);
      if (!order) throw new Error('Reviewed period has no successful source order');
      return { order, period };
    }).sort((a, c) => instant(a.period.assignedAt) - instant(c.period.assignedAt));
    if (new Set(ordered.map(item => id(item.order))).size !== completedOrders.length) throw new Error('Completed order needs exactly one reviewed period');
    const initial = ordered[0]!.order;
    if (!['RENT', 'ADMIN_ASSIGN'].includes(s(initial.kind)) || ordered.slice(1).some(item => !['RENEW', 'ADMIN_EXTEND'].includes(s(item.order.kind)))) throw new Error('Initial/renewal sequence is ambiguous');
    const usedRenewalAudits = new Set<string>();
    let end = 0, serviceEndResolved = false;
    for (const { order, period } of ordered) {
      const evidence = b.evidence(period.evidence);
      if (!period.evidence.some(e => e.entity === 'Order' && e.sourceId === id(order))) throw new Error('Period evidence must include its actual successful order');
      let start: number;
      if (!end) {
        if (!period.evidence.some(e => e.entity === 'Lease' && e.sourceId === id(lease))) throw new Error('Initial period requires original lease start evidence');
        start = instant(lease.startedAt);
      } else if (order.completedAt) {
        start = Math.max(end, instant(order.completedAt));
      } else {
        // An audit before the prior expiry proves continuity without inventing completion time.
        const action = order.kind === 'ADMIN_EXTEND' ? 'LEASE_EXTEND' : 'DEMO_RENEW';
        const audits = evidence.filter(e => e.entity === 'AuditLog').map(e => record(e.source)).filter(a =>
          a.action === action && a.resourceId === id(lease) && instant(a.createdAt) >= instant(order.createdAt) && instant(a.createdAt) <= end);
        if (audits.length !== 1 || usedRenewalAudits.has(id(audits[0]!))) throw new Error('Renewal with unknown completion needs distinct original audit proving renewal before prior expiry');
        usedRenewalAudits.add(id(audits[0]!));
        start = end;
      }
      const expires = start + n(order.termDays) * 86400000;
      if (instant(period.assignedAt) !== start || instant(period.expiresAt) !== expires) throw new Error(`Period does not match source chronology: expected ${new Date(start).toISOString()}..${new Date(expires).toISOString()}`);
      const resolution = period.serviceEndResolution;
      if (resolution) {
        if (period !== ordered.at(-1)!.period || resolution.approvedBy !== b.decisions.approvedBy
          || /REVIEW_REQUIRED/.test(resolution.reason + resolution.approvalReference)
          || !lease.endedAt || instant(lease.expiresAt) !== instant(lease.endedAt)
          || instant(lease.endedAt) <= start || instant(lease.endedAt) >= expires
          || !period.releasedAt || instant(period.releasedAt) !== instant(lease.endedAt) || period.releaseReason !== 'MANUAL') {
          throw new Error('Reviewed service-end resolution must preserve the final purchased term and use the exact recorded source end');
        }
        serviceEndResolved = true;
      }
      if ((period.releasedAt === null) !== (period.releaseReason === null)) throw new Error('Release time and reason must be supplied together');
      if (lease.endedAt && instant(lease.endedAt) < expires && (!period.releasedAt || instant(period.releasedAt) !== Math.max(start, instant(lease.endedAt)))) throw new Error('Ended source service must truncate or cancel every affected purchased period');
      if (period.releasedAt) {
        const release = instant(period.releasedAt);
        if (release < start || release > expires || !period.releaseReason) throw new Error('Invalid actual release boundary');
        if (release < expires && !resolution && (!lease.endedAt || release !== Math.max(start, instant(lease.endedAt)) || !period.evidence.some(e => e.entity === 'AuditLog' && /end|release/i.test(s(b.find('AuditLog', e.sourceId).action)) && b.find('AuditLog', e.sourceId).resourceId === id(lease)))) throw new Error('Early stop/future cancellation lacks original end audit evidence');
      }
      end = expires;
      if (await b.fact('ServicePeriod', { id: period.id, order, leaseId: id(lease) }, period.id, period)) b.write('ServicePeriod', { id: period.id }, 'number_allocations', { id: period.id, number_id: b.mapped('PhoneNumber', lease.phoneNumberId), user_id: b.mapped('User', lease.userId), order_id: b.mapped('Order', id(order)), platform_id: null, allocation_type: 'WHOLE_NUMBER', lease_id: b.mapped('Lease', id(lease)), assigned_at: period.assignedAt, expires_at: period.expiresAt, released_at: period.releasedAt, release_reason: period.releaseReason });
    }
    if (end !== instant(lease.expiresAt) && !serviceEndResolved) throw new Error('Reconstructed purchased periods disagree with original lease expiry');
    const status = ({ ACTIVE: 'ACTIVE', EXPIRED_HELD: 'EXPIRED_HELD', RELEASED: 'RELEASED', ENDED: 'ENDED' } as Record<string, string>)[s(lease.status)];
    if (!status) throw new Error(`Unsupported original lease status ${s(lease.status)}`);
    let releasedAt: string | null = null;
    let lifecycle: Row | null = null;
    if (status === 'RELEASED') {
      lifecycle = b.request('Lease', lease);
      releasedAt = s(lifecycle.releasedAt);
      const evidence = b.evidence(b.decisions.requests[factKey('Lease', id(lease))].evidence);
      const releaseTime = instant(releasedAt);
      const actual = evidence.some(item => item.entity === 'AuditLog' && instant(record(item.source).createdAt) === releaseTime && ((record(item.source).action === 'LEASE_AUTO_RELEASED' && record(item.source).resourceId === id(lease)) || (record(item.source).action === 'NUMBER_RELEASE' && record(item.source).resourceId === lease.phoneNumberId)));
      const next = b.source.Lease.filter(other => other.phoneNumberId === lease.phoneNumberId && id(other) !== id(lease) && instant(other.startedAt) >= instant(lease.expiresAt)).sort((a, c) => instant(a.startedAt) - instant(c.startedAt))[0];
      if (!actual || releaseTime < instant(lease.expiresAt) || (next && releaseTime > instant(next.startedAt))) throw new Error('Released lease requires an original release audit timestamp inside its actual holding interval; endedAt is only the service end');
    }
    if (status === 'ENDED' && !lease.endedAt) throw new Error('Ended lease lacks original end timestamp');
    if (await b.fact('Lease', lease, b.mapped('Lease', id(lease)), null, { lifecycle, ...(serviceEndResolved ? { serviceEndResolution: ordered.at(-1)!.period.serviceEndResolution } : {}) })) b.write('Lease', lease, 'leases', { id: b.mapped('Lease', id(lease)), user_id: b.mapped('User', lease.userId), number_id: b.mapped('PhoneNumber', lease.phoneNumberId), initial_order_id: b.mapped('Order', id(initial)), status, held_at: ['EXPIRED_HELD', 'RELEASED'].includes(status) ? lease.expiresAt : null, released_at: releasedAt, ended_at: status === 'ENDED' ? lease.endedAt : null, created_at: lease.createdAt });
  });
  await b.each('PurchaseIntent', async row => {
    const number = row.number ? b.source.PhoneNumber.find(p => p.number === row.number) : null;
    if (row.kind === 'RENT' && !number) throw new Error('Purchase intent number is missing');
    const payload = b.request('PurchaseIntent', row), targetId = b.mapped('PurchaseIntent', id(row));
    if (await b.fact('PurchaseIntent', row, targetId, null, { request: payload })) b.write('PurchaseIntent', row, 'purchase_intents', { id: targetId, user_id: b.mapped('User', row.userId), storefront_id: 'once', kind: row.kind, number_id: number ? b.mapped('PhoneNumber', id(number)) : null, lease_id: b.nullable('Lease', row.leaseId), number_snapshot: row.number, term: row.termDays, quote_version: row.quoteVersion, points_price: row.pointsPrice, request_payload: payload, order_id: b.nullable('Order', row.orderId), created_at: row.createdAt, expires_at: row.expiresAt });
  });
}
