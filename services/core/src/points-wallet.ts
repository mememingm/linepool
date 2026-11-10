import type { PoolClient } from 'pg';
import { ApiFailure } from './http.js';

export type WalletClient = Pick<PoolClient, 'query'>;
export type PointAccount = {
  id: string;
  user_id: string;
  available_points: number;
  frozen_points: number;
  status: 'ACTIVE' | 'REVIEW';
};
export type PointReservation = {
  id: string;
  account_id: string;
  kind: 'ORDER';
  business_id: string;
  points: number;
  status: 'RESERVED' | 'CAPTURED' | 'RELEASED';
  refunded_points: number;
  request_payload: unknown;
};
export type PointWalletEntry = {
  id: string;
  type: string;
  delta: number;
  balance_after: number;
  frozen_delta: number;
  frozen_after: number;
  reservation_id: string | null;
  reference_id: string | null;
  recharge_order_id: string | null;
  business_id: string;
};

type UserRow = { id: string; account_status: string; auth_kind: 'LOCAL' | 'PINCLODE' };
type BalanceRow = { available_points: number; frozen_points: number };
type LedgerRow = PointWalletEntry;
type ReservationRow = PointReservation;
const MAX_POINTS = 2147483647;

function fail(status: number, code: string, message: string): never {
  throw new ApiFailure(status, code, message);
}
function validPoints(points: number, positive = true) {
  if (!Number.isSafeInteger(points) || (positive ? points <= 0 : points < 0) || points > MAX_POINTS) {
    fail(400, 'INVALID_POINTS', 'Points must be a supported integer amount');
  }
}
function validateNewIdentity(businessId: string, description: string) {
  if (!businessId || !description) fail(400, 'INVALID_WALLET_REQUEST', 'Business ID and description are required');
}
function balances(account: PointAccount, row: BalanceRow) {
  account.available_points = row.available_points;
  account.frozen_points = row.frozen_points;
}

function requireActiveAccount(account: PointAccount) {
  if (account.status !== 'ACTIVE') fail(403, 'ACCOUNT_RESTRICTED', 'Point account is restricted');
}
/** Caller owns and has already begun the transaction. */
export async function lockPointAccount(client: WalletClient, userId: string, allowRestricted = false): Promise<PointAccount> {
  const { rows: [user] } = await client.query<UserRow>(
    'SELECT id,account_status,auth_kind FROM users WHERE id=$1 FOR UPDATE', [userId]);
  if (!user) fail(401, 'UNAUTHENTICATED', 'Login is required');
  if (user.auth_kind !== 'LOCAL') fail(403, 'SELF_SERVICE_REQUIRED', 'Point wallets are available to self-service accounts only');
  const { rows: [account] } = await client.query<PointAccount>(
    'SELECT id,user_id,available_points,frozen_points,status FROM point_accounts WHERE user_id=$1 FOR UPDATE', [userId]);
  if (!account) fail(500, 'POINT_ACCOUNT_MISSING', 'Point account is missing');
  if (!allowRestricted && (user.account_status !== 'ACTIVE' || account.status !== 'ACTIVE')) {
    fail(403, 'ACCOUNT_RESTRICTED', 'Point account is restricted');
  }
  return account;
}

async function ownedReservation(client: WalletClient, account: PointAccount, id: string): Promise<ReservationRow> {
  const { rows: [reservation] } = await client.query<ReservationRow>(
    'SELECT id,account_id,kind,business_id,points,status,refunded_points,request_payload FROM point_reservations WHERE id=$1 FOR UPDATE', [id]);
  if (!reservation) fail(404, 'RESERVATION_NOT_FOUND', 'Point reservation was not found');
  if (reservation.account_id !== account.id || reservation.kind !== 'ORDER') {
    fail(409, 'RESERVATION_OWNERSHIP_MISMATCH', 'Point reservation does not belong to this account');
  }
  return reservation;
}

async function findEntry(client: WalletClient, accountId: string, type: string, businessId: string, payload: unknown) {
  const { rows: [entry] } = await client.query<LedgerRow>(`SELECT id,type,delta,balance_after,frozen_delta,frozen_after,reservation_id,reference_id,recharge_order_id,business_id
    FROM point_ledger WHERE account_id=$1 AND type=$2 AND business_id=$3`, [accountId, type, businessId]);
  if (!entry) return undefined;
  const { rowCount } = await client.query('SELECT 1 FROM point_ledger WHERE id=$1 AND request_payload=$2::jsonb', [entry.id, JSON.stringify(payload)]);
  if (rowCount !== 1) fail(409, 'IDEMPOTENCY_CONFLICT', 'Business ID was already used with different parameters');
  return entry;
}

async function writeLedger(client: WalletClient, account: PointAccount, input: {
  type: string; delta: number; frozenDelta: number; businessId: string; payload: unknown;
  description: string; referenceId?: string | null; reservationId?: string | null;
  rechargeOrderId?: string | null; ledgerId?: string; createdAt?: Date;
}): Promise<PointWalletEntry> {
  const { rows: [after] } = await client.query<BalanceRow>(`UPDATE point_accounts
    SET available_points=(available_points::bigint+$2::bigint)::integer,
        frozen_points=(frozen_points::bigint+$3::bigint)::integer, updated_at=now()
    WHERE id=$1 AND available_points::bigint+$2::bigint BETWEEN 0 AND $4::bigint
      AND frozen_points::bigint+$3::bigint BETWEEN 0 AND $4::bigint
      AND available_points::bigint+$2::bigint+frozen_points::bigint+$3::bigint<=$4::bigint
    RETURNING available_points,frozen_points`, [account.id, input.delta, input.frozenDelta, MAX_POINTS]);
  if (!after) fail(409, 'POINT_BALANCE_LIMIT', 'Wallet balance is insufficient or exceeds the supported range');
  balances(account, after);
  const { rows: [entry] } = await client.query<LedgerRow>(`INSERT INTO point_ledger
    (id,account_id,user_id,type,delta,balance_after,frozen_delta,frozen_after,description,reference_id,recharge_order_id,reservation_id,business_id,request_payload,created_at)
    VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,COALESCE($15::timestamptz,now()))
    RETURNING id,type,delta,balance_after,frozen_delta,frozen_after,reservation_id,reference_id,recharge_order_id,business_id`,
  [input.ledgerId ?? null, account.id, account.user_id, input.type, input.delta, after.available_points,
    input.frozenDelta, after.frozen_points, input.description, input.referenceId ?? null,
    input.rechargeOrderId ?? null, input.reservationId ?? null, input.businessId, JSON.stringify(input.payload), input.createdAt ?? null]);
  return entry!;
}

export async function creditPoints(client: WalletClient, account: PointAccount, input: {
  points: number; type: 'SEED_CREDIT' | 'RECHARGE'; businessId: string; description: string;
  rechargeOrderId?: string; ledgerId?: string; createdAt?: Date;
}): Promise<PointWalletEntry> {
  requireActiveAccount(account);
  validPoints(input.points);
  validateNewIdentity(input.businessId, input.description);
  if ((input.type === 'RECHARGE') !== Boolean(input.rechargeOrderId)) {
    fail(400, 'INVALID_WALLET_REQUEST', 'Recharge credits require a recharge order ID and seed credits must not have one');
  }
  const payload = { points: input.points, type: input.type, rechargeOrderId: input.rechargeOrderId ?? null, description: input.description };
  const prior = await findEntry(client, account.id, input.type, input.businessId, payload);
  if (prior) return prior;
  return writeLedger(client, account, { type: input.type, delta: input.points, frozenDelta: 0,
    businessId: input.businessId, payload, description: input.description,
    rechargeOrderId: input.rechargeOrderId ?? null, ledgerId: input.ledgerId, createdAt: input.createdAt });
}

export async function reserveOrderPoints(client: WalletClient, account: PointAccount, input: {
  orderId: string; points: number; description?: string; createdAt?: Date;
}): Promise<PointReservation> {
  requireActiveAccount(account);
  validPoints(input.points);
  validateNewIdentity(input.orderId, input.description ?? 'Order points reservation');
  const payload = { orderId: input.orderId, points: input.points };
  const { rows: [existing] } = await client.query<ReservationRow>(`SELECT id,account_id,kind,business_id,points,status,refunded_points,request_payload
    FROM point_reservations WHERE account_id=$1 AND kind='ORDER' AND business_id=$2 FOR UPDATE`, [account.id, input.orderId]);
  if (existing) {
    const { rowCount } = await client.query('SELECT 1 FROM point_reservations WHERE id=$1 AND request_payload=$2::jsonb', [existing.id, JSON.stringify(payload)]);
    if (!rowCount) fail(409, 'IDEMPOTENCY_CONFLICT', 'Order reservation was already created with different parameters');
    return existing;
  }
  const { rows: [reservation] } = await client.query<ReservationRow>(`INSERT INTO point_reservations(account_id,kind,business_id,points,request_payload,created_at)
    VALUES($1,'ORDER',$2,$3,$4::jsonb,COALESCE($5::timestamptz,now()))
    RETURNING id,account_id,kind,business_id,points,status,refunded_points,request_payload`,
  [account.id, input.orderId, input.points, JSON.stringify(payload), input.createdAt ?? null]);
  const row = reservation!;
  await writeLedger(client, account, { type: 'ORDER_RESERVE', delta: -input.points, frozenDelta: input.points,
    businessId: input.orderId, payload, description: input.description ?? 'Order points reservation',
    referenceId: input.orderId, reservationId: row.id, createdAt: input.createdAt });
  return row;
}

export async function settleOrderPoints(client: WalletClient, account: PointAccount, reservationId: string,
  outcome: 'CAPTURED' | 'RELEASED'): Promise<PointReservation> {
  const reservation = await ownedReservation(client, account, reservationId);
  if (reservation.status === outcome) return reservation;
  if (reservation.status !== 'RESERVED') fail(409, 'RESERVATION_SETTLED', 'Point reservation has already reached a different terminal state');
  if (outcome === 'CAPTURED' && reservation.refunded_points !== 0) fail(409, 'RESERVATION_STATE_INVALID', 'An unspent reservation cannot have refunded points');
  const { rowCount } = await client.query('UPDATE point_reservations SET status=$2,settled_at=now() WHERE id=$1 AND status=\'RESERVED\'', [reservation.id, outcome]);
  if (rowCount !== 1) fail(409, 'RESERVATION_STATE_CHANGED', 'Point reservation changed during settlement');
  await writeLedger(client, account, { type: outcome === 'CAPTURED' ? 'ORDER_CAPTURE' : 'ORDER_RELEASE',
    delta: outcome === 'CAPTURED' ? 0 : reservation.points, frozenDelta: -reservation.points,
    businessId: reservation.business_id, payload: { reservationId: reservation.id, outcome },
    description: outcome === 'CAPTURED' ? 'Order points captured' : 'Order points released',
    referenceId: reservation.business_id, reservationId: reservation.id });
  reservation.status = outcome;
  return reservation;
}

export async function refundOrderPoints(client: WalletClient, account: PointAccount, input: {
  reservationId: string; points: number; businessId: string; description: string; actorId?: string;
}): Promise<PointWalletEntry> {
  validPoints(input.points);
  validateNewIdentity(input.businessId, input.description);
  const reservation = await ownedReservation(client, account, input.reservationId);
  const payload = { reservationId: reservation.id, points: input.points, description: input.description, actorId: input.actorId ?? null };
  const prior = await findEntry(client, account.id, 'ORDER_REFUND', input.businessId, payload);
  if (prior) {
    if (prior.reservation_id !== reservation.id || prior.reference_id !== reservation.business_id || prior.delta !== input.points) {
      fail(409, 'IDEMPOTENCY_CONFLICT', 'Refund business ID was already used with different parameters');
    }
    return prior;
  }
  if (reservation.status !== 'CAPTURED') fail(409, 'RESERVATION_NOT_REFUNDABLE', 'Only captured order points can be refunded');
  if (reservation.refunded_points + input.points > reservation.points) fail(409, 'REFUND_LIMIT_EXCEEDED', 'Refund exceeds the captured order points');
  const { rowCount } = await client.query(`UPDATE point_reservations SET refunded_points=refunded_points+$2
    WHERE id=$1 AND status='CAPTURED' AND refunded_points+$2<=points`, [reservation.id, input.points]);
  if (rowCount !== 1) fail(409, 'REFUND_LIMIT_EXCEEDED', 'Refund exceeds the captured order points');
  return writeLedger(client, account, { type: 'ORDER_REFUND', delta: input.points, frozenDelta: 0,
    businessId: input.businessId, payload, description: input.description,
    referenceId: reservation.business_id, reservationId: reservation.id });
}

/** Protected administrative caller owns the user/account locks and transaction. */
export async function compensatePoints(client: WalletClient, account: PointAccount, input: {
  points: number; actorId: string; reason: string; businessId: string;
}): Promise<PointWalletEntry> {
  validPoints(input.points);
  validateNewIdentity(input.businessId, input.reason);
  if (input.reason.trim().length < 2 || input.reason.length > 500) fail(400, 'REASON_REQUIRED', 'A reason of 2–500 characters is required');
  const { rowCount } = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='ADMIN' AND account_status='ACTIVE' AND auth_kind='LOCAL'", [input.actorId]);
  if (rowCount !== 1) fail(403, 'ADMIN_REQUIRED', 'Active administrator access is required');
  const payload = { points: input.points, actorId: input.actorId, reason: input.reason };
  const prior = await findEntry(client, account.id, 'COMPENSATION', input.businessId, payload);
  if (prior) return prior;
  return writeLedger(client, account, { type: 'COMPENSATION', delta: input.points, frozenDelta: 0,
    businessId: input.businessId, payload, description: input.reason });
}
