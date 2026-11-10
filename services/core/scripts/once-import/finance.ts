import { factKey, id, integer as n, record, text as s, type Row } from './model.js';
import { ImportPlan } from './plan.js';

export async function planFinance(b: ImportPlan): Promise<void> {
  await b.each('PointReservation', async row => {
    if (row.kind === 'REFUND') {
      // Historical cash reservation stays provenance; it must never become an ORDER freeze.
      await b.fact('PointReservation', row, b.mapped('PointReservation', id(row)), null, { targetStorage: 'source-only historical cash reservation; no wallet action' });
      return;
    }
    const order = b.find('Order', row.businessId), payload = b.request('PointReservation', row);
    if (n(row.points) <= 0) throw new Error('A live ORDER reservation requires a positive original amount; zero/ambiguous reservations need source disposition');
    const history = b.source.PointLedger.filter(l => l.accountId === row.accountId && l.businessId === row.businessId && s(l.kind).startsWith('ORDER_')).sort((a, c) => n(a.sequence) - n(c.sequence));
    const reserve = history.find(l => l.kind === 'ORDER_RESERVE');
    const settled = history.find(l => ['ORDER_CAPTURE', 'ORDER_RELEASE'].includes(s(l.kind)));
    if (!reserve || (row.status !== 'RESERVED' && !settled)) throw new Error('Original reserve/settle timestamps require actual ledger evidence');
    if (await b.fact('PointReservation', row, b.mapped('PointReservation', id(row)), null, { request: payload })) b.write('PointReservation', row, 'point_reservations', { id: b.mapped('PointReservation', id(row)), account_id: b.mapped('PointAccount', row.accountId), kind: 'ORDER', business_id: b.mapped('Order', id(order)), points: row.points, status: row.status, refunded_points: row.refundedPoints, request_payload: payload, created_at: reserve.createdAt, settled_at: settled?.createdAt ?? null, import_batch_id: b.decisions.batchId });
  });
  await b.each('RechargeOrder', async row => {
    const targetId = b.mapped('RechargeOrder', id(row)), payload = b.request('RechargeOrder', row);
    const credits = b.source.PointLedger.filter(l => l.kind === 'RECHARGE' && l.businessId === id(row));
    const receipts = b.source.PaymentReceipt.filter(r => r.rechargeId === id(row));
    const attempts = b.source.PaymentAttempt.filter(a => a.rechargeId === id(row));
    const requestDecision = b.decisions.requests[factKey('RechargeOrder', id(row))]!;
    const fractionDigits = payload.fractionDigits;
    if (typeof fractionDigits !== 'number' || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) throw new Error('Recharge currency precision needs explicit original settings/payment evidence in reviewed request');
    b.evidence(requestDecision.evidence);
    const status = ({ PENDING: 'PENDING', CREATING: 'CHECKING', CHECKING: 'CHECKING', PAID_UNCREDITED: 'PAID_UNCREDITED', PAID: 'PAID', REFUNDING: 'REFUNDING', REFUNDED: 'REFUNDED', FAILED: 'FAILED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED' } as Record<string, string>)[s(row.status)];
    if (!status) throw new Error(`Unknown original recharge state ${s(row.status)}`);
    if (row.creditedAt && credits.length !== 1) throw new Error('Credited recharge needs exactly one original ledger row');
    const receipt = receipts.find(r => r.applied);
    const attempt = attempts[0];
    if (await b.fact('RechargeOrder', row, targetId, null, { request: payload, paymentReferences: { attemptIds: attempts.map(id), receiptIds: receipts.map(id) } })) b.write('RechargeOrder', row, 'recharge_orders', { id: targetId, order_number: `ONCE-${id(row)}`, user_id: b.mapped('User', row.userId), currency: row.currency, fraction_digits: fractionDigits, amount_minor: row.amountMinor, points: row.points, status, payment_method: row.environment === 'DEMO' ? 'MOCK' : 'HISTORICAL', provider_transaction_id: receipt?.transactionId ?? null, points_ledger_id: row.creditedAt ? b.mapped('PointLedger', id(credits[0]!)) : null, created_at: row.createdAt, paid_at: row.paidAt, credited_at: row.creditedAt, idempotency_key: row.idempotencyKey, sales_storefront_id: 'once', purchase_intent_id: b.nullable('PurchaseIntent', row.purchaseIntentId), request_payload: payload, conversion_snapshot: { kind: 'LEGACY_ONCE', amountMinor: row.amountMinor, points: row.points, currency: row.currency, fractionDigits, exchangeAmountMinor: 1, exchangePoints: row.pointsPerMinor, originalEnvironment: row.environment }, expires_at: row.expiresAt, mock_scenario: row.environment === 'DEMO' ? attempt?.scenario ?? null : null, mock_payment_status: row.environment === 'DEMO' ? (receipt ? 'PAID' : attempt?.status ?? 'CREATED') : null, mock_provider_transaction_id: row.environment === 'DEMO' ? receipt?.transactionId ?? null : null, mock_observed_at: row.environment === 'DEMO' ? receipt?.paidAt ?? null : null, last_checked_at: attempt?.checkedAt ?? null, attempts: attempt?.attempts ?? 0, last_error: attempt?.lastError ?? null, import_batch_id: b.decisions.batchId, source_payload: { source: row, paymentReferences: { attemptIds: attempts.map(id), receiptIds: receipts.map(id) } } });
  });
  const ledger = [...b.source.PointLedger].sort((a, c) => s(a.accountId).localeCompare(s(c.accountId)) || n(a.sequence) - n(c.sequence));
  for (const row of ledger) {
    try {
      const account = b.find('PointAccount', row.accountId), accountId = b.mapped('PointAccount', id(account));
      const balance = b.plan.balances[accountId];
      if (!balance) throw new Error('Reviewed wallet mapping is missing');
      let kind = s(row.kind), order: Row | undefined, reservation: Row | undefined, recharge: Row | undefined;
      let businessId = s(row.businessId);
      const payload = b.request('PointLedger', row);
      if (kind.startsWith('ORDER_')) {
        const orderId = kind === 'ORDER_REFUND' ? payload.orderId : row.businessId;
        order = b.find('Order', orderId);
        reservation = b.find('PointReservation', order.reservationId);
        if (reservation.accountId !== row.accountId) throw new Error('Original order/refund ledger belongs to a different wallet');
        if (kind === 'ORDER_REFUND') {
          const evidence = b.evidence(b.decisions.requests[factKey('PointLedger', id(row))].evidence);
          const result = evidence.some(item => item.entity === 'AdminIdempotency' && record(item.source).actorId === row.actorId && record(item.source).key === `points:${s(row.businessId)}` && record(record(item.source).result).ledgerId === id(row));
          const audit = evidence.some(item => item.entity === 'AuditLog' && record(item.source).userId === row.actorId && record(item.source).action === 'ORDER_POINTS_REFUNDED' && record(item.source).resourceId === id(order!) && record(record(item.source).details).points === row.availableDelta);
          if (!result || !audit) throw new Error('Consumption refund lacks original actor/idempotency result and order/amount audit evidence');
        }
        if (kind !== 'ORDER_REFUND') businessId = b.mapped('Order', id(order));
      } else if (kind === 'RECHARGE') {
        recharge = b.source.RechargeOrder.find(r => r.id === row.businessId);
        if (recharge) businessId = b.mapped('RechargeOrder', id(recharge));
        else {
          const lots = b.source.PointLot.filter(l => l.accountId === row.accountId && l.source === 'DEMO' && !l.rechargeId && l.createdAt === row.createdAt && l.issuedPoints === row.availableDelta);
          if (!lots.length || payload.source !== 'DEMO') throw new Error('Unlinked RECHARGE needs actual DEMO lot/source evidence; cannot infer cash');
          kind = 'SEED_CREDIT';
        }
      }
      if (n(row.availableDelta) === 0 && n(row.frozenDelta) === 0) { kind = 'LEGACY_ZERO'; businessId = b.mapped('PointLedger', id(row)); }
      if (!['SEED_CREDIT', 'RECHARGE', 'ORDER_RESERVE', 'ORDER_CAPTURE', 'ORDER_RELEASE', 'ORDER_REFUND', 'COMPENSATION', 'COMPENSATION_REVOKE', 'REFUND_RESERVE', 'REFUND_CAPTURE', 'REFUND_RELEASE', 'LEGACY_ZERO'].includes(kind)) throw new Error(`Unknown original ledger kind ${kind}`);
      const extra = { ...payload, original: row, actorId: b.nullable('User', row.actorId), reason: row.reason };
      if (await b.fact('PointLedger', row, b.mapped('PointLedger', id(row)), null, { request: payload, targetKind: kind, targetBusinessId: businessId })) {
        balance.available += n(row.availableDelta); balance.frozen += n(row.frozenDelta);
        balance.addedAvailable += n(row.availableDelta); balance.addedFrozen += n(row.frozenDelta);
        if (balance.available < 0 || balance.frozen < 0 || balance.available + balance.frozen > 2147483647) throw new Error('Imported wallet overflows core balance limits');
        b.write('PointLedger', row, 'point_ledger', { id: b.mapped('PointLedger', id(row)), account_id: accountId, user_id: balance.userId, type: kind, business_id: businessId, delta: row.availableDelta, frozen_delta: row.frozenDelta, balance_after: balance.available, frozen_after: balance.frozen, description: row.reason || `ONCE ${s(row.kind)}`, reference_id: order ? b.mapped('Order', id(order)) : null, reservation_id: reservation && kind !== 'LEGACY_ZERO' ? b.mapped('PointReservation', id(reservation)) : null, recharge_order_id: recharge && kind !== 'LEGACY_ZERO' ? b.mapped('RechargeOrder', id(recharge)) : null, request_payload: extra, created_at: row.createdAt, import_batch_id: b.decisions.batchId });
      }
    } catch (error) { b.block('LEDGER_CONVERSION', 'PointLedger', id(row), { source: row, message: error instanceof Error ? error.message : 'Ledger conversion failed' }); }
  }
  await b.each('RefundOrder', async row => {
    if (!['SUCCEEDED', 'FAILED', 'REJECTED'].includes(s(row.status))) throw new Error('Pending cash refund must be resolved in source before cutover');
    const recharge = b.find('RechargeOrder', row.rechargeId);
    if (await b.fact('RefundOrder', row, b.mapped('RefundOrder', id(row)))) b.write('RefundOrder', row, 'refund_orders', { id: b.mapped('RefundOrder', id(row)), user_id: b.mapped('User', row.userId), recharge_order_id: b.mapped('RechargeOrder', row.rechargeId), actor_id: b.nullable('User', row.actorId), kind: row.kind, status: row.status, amount_minor: row.amountMinor, currency: recharge.currency, points: row.points, reason: row.reason, source_payload: row, created_at: row.createdAt, updated_at: row.completedAt ?? row.createdAt, completed_at: row.completedAt });
  });
  await b.each('PointException', async row => {
    if (row.status !== 'RESOLVED' || !row.actorId || !row.resolvedAt || typeof row.resolution !== 'string' || row.resolution.trim().length < 2) throw new Error('Financial exception lacks a completed, attributed source resolution');
    const details = record(row.details);
    const rechargeId = details.rechargeId;
    if (await b.fact('PointException', row, b.mapped('PointException', id(row)))) b.write('PointException', row, 'point_exceptions', { id: b.mapped('PointException', id(row)), user_id: b.nullable('User', row.userId), recharge_order_id: rechargeId ? b.mapped('RechargeOrder', rechargeId) : null, kind: row.kind, status: row.status, details: { ...details, source: row }, reason: row.resolution, resolved_by: b.nullable('User', row.actorId), created_at: row.createdAt, updated_at: row.resolvedAt ?? row.createdAt, resolved_at: row.resolvedAt });
  });
  for (const entity of ['PointLot', 'PointAllocation'] as const) await b.each(entity, async row => { await b.fact(entity, row, b.mapped(entity, id(row)), null, { targetStorage: 'historical conversion evidence only; not a live funding source' }); });
  // These three tables remain in the retained legacy database. Registry stores references, never payment table payloads.
  for (const entity of ['PaymentAttempt', 'PaymentReceipt', 'PaymentEvent'] as const) await b.each(entity, async row => { await b.fact(entity, { id: id(row), rechargeId: row.rechargeId ?? null, provider: row.provider, merchant: row.merchant, eventId: row.eventId ?? null, transactionId: row.transactionId ?? null, status: row.status ?? null }, b.mapped(entity, id(row)), null, { targetStorage: 'retained read-only legacy payment evidence' }); });
  await b.each('Payment', async row => { await b.fact('Payment', row, b.mapped('Payment', id(row)), null, { orderId: b.mapped('Order', row.orderId), targetStorage: 'historical non-point order evidence only' }); });
}
