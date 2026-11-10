import { id, integer as n, text as s, type Issue, type Row, type Source } from './model.js';

/** Source equations match points-ledger.ts and PointsService.reconcile(), including the source's account-local sequence. */
export function sourceFinance(source: Source): Issue[] {
  const issues: Issue[] = [];
  const fail = (code: string, entity: string, sourceId: string, details: Row) => issues.push({ code, entity, sourceId, details });
  for (const account of source.PointAccount) {
    const accountId = id(account);
    if (account.status !== 'ACTIVE') fail('UNRESOLVED_WALLET_REVIEW', 'PointAccount', accountId, { status: account.status });
    const ledger = source.PointLedger.filter(row => row.accountId === accountId).sort((a, b) => n(a.sequence) - n(b.sequence));
    let available = 0, frozen = 0, sequence = 0;
    for (const row of ledger) {
      sequence++;
      available += n(row.availableDelta); frozen += n(row.frozenDelta);
      if (n(row.sequence) !== sequence || n(row.availableAfter) !== available || n(row.frozenAfter) !== frozen || available < 0 || frozen < 0)
        fail('SOURCE_LEDGER_CHAIN', 'PointLedger', id(row), { accountId, expectedSequence: sequence, expectedAvailable: available, expectedFrozen: frozen, stored: row });
    }
    if (sequence !== n(account.sequence) || available !== n(account.availablePoints) || frozen !== n(account.frozenPoints))
      fail('SOURCE_ACCOUNT_TOTAL', 'PointAccount', accountId, { account, ledger: { sequence, available, frozen } });
    const lots = source.PointLot.filter(row => row.accountId === accountId);
    const lotAvailable = lots.reduce((sum, row) => sum + n(row.availablePoints), 0), lotFrozen = lots.reduce((sum, row) => sum + n(row.frozenPoints), 0);
    if (lotAvailable !== available || lotFrozen !== frozen) fail('SOURCE_LOT_TOTAL', 'PointAccount', accountId, { available, frozen, lotAvailable, lotFrozen, lotIds: lots.map(id) });
    const reservations = source.PointReservation.filter(row => row.accountId === accountId);
    const held = reservations.filter(row => row.status === 'RESERVED').reduce((sum, row) => sum + n(row.points), 0);
    if (held !== frozen) fail('SOURCE_RESERVATION_TOTAL', 'PointAccount', accountId, { held, frozen, reservations });
    for (const lot of lots) {
      if (n(lot.availablePoints) < 0 || n(lot.frozenPoints) < 0 || n(lot.availablePoints) + n(lot.frozenPoints) > n(lot.issuedPoints)) fail('SOURCE_LOT_SHAPE', 'PointLot', id(lot), { lot });
      const heldByAllocations = source.PointAllocation.filter(a => a.lotId === id(lot) && reservations.some(r => id(r) === a.reservationId && r.status === 'RESERVED')).reduce((sum, a) => sum + n(a.points), 0);
      if (heldByAllocations !== n(lot.frozenPoints)) fail('SOURCE_LOT_FROZEN', 'PointLot', id(lot), { heldByAllocations, lot });
      if (lot.rechargeId && !source.RechargeOrder.some(r => id(r) === lot.rechargeId && r.userId === account.userId && n(r.points) === n(lot.issuedPoints))) fail('SOURCE_LOT_RECHARGE', 'PointLot', id(lot), { lot });
    }
    for (const reservation of reservations) {
      const allocations = source.PointAllocation.filter(row => row.reservationId === id(reservation));
      if (reservation.status === 'RESERVED') fail('UNFINISHED_RESERVATION', 'PointReservation', id(reservation), { reservation });
      if (!['RESERVED', 'CAPTURED', 'RELEASED'].includes(s(reservation.status))) fail('UNKNOWN_RESERVATION_STATUS', 'PointReservation', id(reservation), { reservation });
      const allocated = allocations.reduce((sum, row) => sum + n(row.points), 0), refunded = allocations.reduce((sum, row) => sum + n(row.refundedPoints), 0);
      if (allocated !== n(reservation.points) || refunded !== n(reservation.refundedPoints) || refunded < 0 || refunded > allocated || (reservation.status !== 'CAPTURED' && refunded !== 0) || allocations.some(a => !lots.some(l => id(l) === a.lotId))) fail('SOURCE_ALLOCATION_TOTAL', 'PointReservation', id(reservation), { reservation, allocated, refunded, allocations });
      if (reservation.kind === 'ORDER') {
        const order = source.Order.find(row => row.reservationId === id(reservation));
        const funds = reservation.status === 'RESERVED' ? ['RESERVED'] : reservation.status === 'RELEASED' ? ['RELEASED'] : ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
        if (!order || order.id !== reservation.businessId || order.userId !== account.userId || order.pointsAmount !== reservation.points || !funds.includes(s(order.fundsStatus))) fail('SOURCE_ORDER_RESERVATION_IDENTITY', 'PointReservation', id(reservation), { reservation, order: order ?? null, accountUser: account.userId });
        if (order && ((reservation.status === 'CAPTURED' && !['PAID', 'COMPLETED', 'DEMO_CONFIRMED', 'SUCCEEDED'].includes(s(order.status))) || (reservation.status === 'RELEASED' && !['FAILED', 'DEMO_FAILED'].includes(s(order.status))))) fail('SOURCE_ORDER_SETTLEMENT_STATE', 'Order', id(order), { status: order.status, reservationStatus: reservation.status });
        const prefix = 'ORDER_';
        const rows = ledger.filter(row => s(row.kind).startsWith(prefix) && (row.businessId === reservation.businessId || (row.kind === 'ORDER_REFUND' && source.AuditLog.some(a => a.resourceId === reservation.businessId && a.details && JSON.stringify(a.details).includes(id(row))))));
        const returns = rows.filter(row => row.kind === 'ORDER_REFUND').reduce((sum, row) => sum + n(row.availableDelta), 0);
        // Refund identities may use actor:key; the converter separately requires their explicit original-order mapping.
        if (returns > n(reservation.refundedPoints)) fail('SOURCE_REFUND_TOTAL', 'PointReservation', id(reservation), { returns, refundedPoints: reservation.refundedPoints });
      } else if (reservation.kind === 'REFUND') {
        const refund = source.RefundOrder.find(row => row.reservationId === id(reservation));
        const recharge = refund ? source.RechargeOrder.find(row => row.id === refund.rechargeId) : null;
        if (!refund || !recharge || refund.id !== reservation.businessId || refund.userId !== account.userId || recharge.userId !== account.userId || refund.points !== reservation.points || (refund.status === 'SUCCEEDED' ? reservation.status !== 'CAPTURED' : !['FAILED', 'REJECTED'].includes(s(refund.status)) || reservation.status !== 'RELEASED')) fail('SOURCE_CASH_RESERVATION_IDENTITY', 'PointReservation', id(reservation), { reservation, refund: refund ?? null });
        const rows = ledger.filter(row => row.businessId === reservation.businessId && s(row.kind).startsWith('REFUND_'));
        const reserve = rows.filter(row => row.kind === 'REFUND_RESERVE'), capture = rows.filter(row => row.kind === 'REFUND_CAPTURE'), release = rows.filter(row => row.kind === 'REFUND_RELEASE');
        if (reserve.length !== 1 || capture.length !== (reservation.status === 'CAPTURED' ? 1 : 0) || release.length !== (reservation.status === 'RELEASED' ? 1 : 0)) fail('SOURCE_CASH_RESERVATION_LEDGER', 'PointReservation', id(reservation), { ledgerIds: rows.map(id) });
      } else fail('SOURCE_RESERVATION_KIND', 'PointReservation', id(reservation), { reservation });
    }
  }
  for (const refund of source.RefundOrder) {
    if (['REQUESTED', 'APPROVED', 'PROCESSING', 'UNKNOWN'].includes(s(refund.status))) fail('PENDING_CASH_REFUND', 'RefundOrder', id(refund), { refund, recharge: source.RechargeOrder.find(r => r.id === refund.rechargeId), receipt: source.PaymentReceipt.find(r => r.id === refund.receiptId) });
    const recharge = source.RechargeOrder.find(row => row.id === refund.rechargeId);
    const receipt = refund.receiptId ? source.PaymentReceipt.find(row => row.id === refund.receiptId) : null;
    if (!recharge || recharge.userId !== refund.userId || (refund.receiptId && (!receipt || receipt.rechargeId !== refund.rechargeId))) fail('SOURCE_CASH_REFUND_IDENTITY', 'RefundOrder', id(refund), { refund });
    if (['SUCCEEDED', 'FAILED', 'REJECTED'].includes(s(refund.status)) && !refund.completedAt) fail('SOURCE_CASH_REFUND_COMPLETION', 'RefundOrder', id(refund), { refund });
  }
  for (const recharge of source.RechargeOrder) {
    const attempts = source.PaymentAttempt.filter(row => row.rechargeId === id(recharge));
    const receipts = source.PaymentReceipt.filter(row => row.rechargeId === id(recharge));
    const pending = ['PENDING', 'CREATING', 'CHECKING', 'EXPIRED', 'PAID_UNCREDITED'].includes(s(recharge.status));
    if (['PENDING', 'CREATING', 'CHECKING', 'PAID_UNCREDITED', 'REFUNDING'].includes(s(recharge.status))) fail('UNFINISHED_RECHARGE', 'RechargeOrder', id(recharge), { recharge, attempts, receipts });
    if (recharge.environment === 'LIVE' && pending || recharge.status === 'PAID_UNCREDITED' || n(recharge.refundReservedMinor) !== 0)
      fail('PENDING_CASH_RECHARGE', 'RechargeOrder', id(recharge), { recharge, attempts, receipts });
    if (recharge.environment === 'LIVE' && attempts.some(a => ['CREATED', 'CREATING', 'PENDING', 'CHECKING', 'UNKNOWN'].includes(s(a.status)))) fail('PENDING_LIVE_CHECKOUT', 'RechargeOrder', id(recharge), { recharge, attempts });
    const applied = receipts.filter(row => row.applied);
    const ledger = source.PointLedger.filter(row => row.kind === 'RECHARGE' && row.businessId === id(recharge));
    if (recharge.creditedAt && (ledger.length !== 1 || ledger[0].availableDelta !== recharge.points || ledger[0].frozenDelta !== 0 || source.PointAccount.find(a => a.id === ledger[0].accountId)?.userId !== recharge.userId || applied.length !== 1 || applied[0].amountMinor !== recharge.amountMinor || applied[0].currency !== recharge.currency)) fail('SOURCE_RECHARGE_CREDIT', 'RechargeOrder', id(recharge), { recharge, ledger, applied });
    if (!recharge.creditedAt && ledger.length) fail('SOURCE_UNCREDITED_LEDGER', 'RechargeOrder', id(recharge), { recharge, ledger });
    const returned = source.RefundOrder.filter(r => r.rechargeId === id(recharge) && r.status === 'SUCCEEDED').reduce((sum, r) => sum + n(r.amountMinor), 0);
    if (returned !== n(recharge.refundedMinor)) fail('SOURCE_CASH_REFUND_TOTAL', 'RechargeOrder', id(recharge), { returned, refundedMinor: recharge.refundedMinor });
    for (const receipt of receipts.filter(r => !r.applied)) {
      if (!source.RefundOrder.some(r => r.receiptId === id(receipt) && r.status === 'SUCCEEDED')) fail('UNAPPLIED_CASH_RECEIPT', 'PaymentReceipt', id(receipt), { receipt, rechargeId: id(recharge) });
    }
  }
  for (const event of source.PaymentEvent) if (['RECEIVED', 'RETRY', 'PROCESSING', 'UNKNOWN', 'QUARANTINED'].includes(s(event.status)) || n(event.conflictCount) > 0) fail('PENDING_PAYMENT_EVENT', 'PaymentEvent', id(event), { event });
  for (const exception of source.PointException) if (exception.status === 'OPEN') fail('OPEN_FINANCIAL_EXCEPTION', 'PointException', id(exception), { exception });
  for (const order of source.Order) if (!['PAID', 'COMPLETED', 'DEMO_CONFIRMED', 'SUCCEEDED', 'FAILED', 'DEMO_FAILED'].includes(s(order.status))) fail('UNFINISHED_ORDER', 'Order', id(order), { order });
  for (const attempt of source.PaymentAttempt) if (attempt.claimUntil != null) fail('PAYMENT_CLAIM_NOT_CLEARED', 'PaymentAttempt', id(attempt), { claimUntil: attempt.claimUntil });
  for (const refund of source.RefundOrder) if (refund.claimUntil != null) fail('REFUND_CLAIM_NOT_CLEARED', 'RefundOrder', id(refund), { claimUntil: refund.claimUntil });
  for (const payment of source.Payment) if (!['PAID', 'COMPLETED', 'SUCCEEDED', 'DEMO_CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(s(payment.status))) fail('UNFINISHED_LEGACY_PAYMENT', 'Payment', id(payment), { payment });
  for (const row of source.PointLedger.filter(row => s(row.kind).startsWith('REFUND_'))) if (!source.PointReservation.some(reservation => reservation.kind === 'REFUND' && reservation.accountId === row.accountId && reservation.businessId === row.businessId)) fail('ORPHAN_CASH_LEDGER', 'PointLedger', id(row), { row });
  return issues;
}
