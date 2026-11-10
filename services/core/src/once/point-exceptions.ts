import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure } from '../http.js';
import { lockPointAccount, type PointAccount, type WalletClient } from '../points-wallet.js';
import { adminPointReplay, pointAudit, pointReason, saveAdminPointResult } from './point-support.js';

@Injectable()
export class OncePointExceptions implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private reconciling = false;
  private afterUserId: string | null = null;
  constructor(private readonly db: Database, private readonly environment: Environment) {}
  private requireSite() {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'ONCE_UNAVAILABLE', 'Once is not enabled on this site');
  }
  async record(client: WalletClient, userId: string, kind: string, details: unknown, rechargeId: string | null = null) {
    const { rows: [prior] } = await client.query<{ id: string }>(`SELECT id FROM point_exceptions WHERE user_id=$1 AND kind=$2 AND recharge_order_id IS NOT DISTINCT FROM $3::uuid AND status='OPEN' FOR UPDATE`, [userId, kind, rechargeId]);
    if (prior) {
      await client.query('UPDATE point_exceptions SET details=$2::jsonb,updated_at=now() WHERE id=$1', [prior.id, JSON.stringify(details)]);
      return prior.id;
    }
    const { rows: [row] } = await client.query<{ id: string }>('INSERT INTO point_exceptions(user_id,recharge_order_id,kind,details) VALUES($1,$2,$3,$4::jsonb) RETURNING id', [userId, rechargeId, kind, JSON.stringify(details)]);
    return row!.id;
  }
  async inspect(client: WalletClient, account: PointAccount) {
    const { rows: [totals] } = await client.query<{ available: string; frozen: string; broken_chain: number }>(`WITH chain AS (
      SELECT balance_after,frozen_after,sum(delta::bigint) OVER (ORDER BY sequence ROWS UNBOUNDED PRECEDING) AS available,
        sum(frozen_delta::bigint) OVER (ORDER BY sequence ROWS UNBOUNDED PRECEDING) AS frozen
      FROM point_ledger WHERE account_id=$1)
      SELECT coalesce((SELECT sum(delta::bigint) FROM point_ledger WHERE account_id=$1),0)::text AS available,
        coalesce((SELECT sum(frozen_delta::bigint) FROM point_ledger WHERE account_id=$1),0)::text AS frozen,
        count(*) FILTER (WHERE balance_after::bigint<>available OR frozen_after::bigint<>frozen)::int AS broken_chain FROM chain`, [account.id]);
    const { rows: [reserved] } = await client.query<{ points: string; invalid: number }>(`WITH funding AS (
      SELECT reservation_id,count(*) FILTER(WHERE type='ORDER_DEBIT') AS debits,
        count(*) FILTER(WHERE type='ORDER_RESERVE') AS reserves,count(*) FILTER(WHERE type='ORDER_CAPTURE') AS captures,
        count(*) FILTER(WHERE type='ORDER_RELEASE') AS releases,
        coalesce(sum(delta::bigint) FILTER(WHERE type='ORDER_REFUND' OR (type='ADJUSTMENT' AND reverses_ledger_id IS NOT NULL)),0) AS refunded
      FROM point_ledger WHERE account_id=$1 AND reservation_id IS NOT NULL GROUP BY reservation_id)
      SELECT coalesce(sum(r.points::bigint) FILTER (WHERE r.status='RESERVED'),0)::text AS points,
      count(*) FILTER (WHERE o.id IS NULL OR o.user_id IS DISTINCT FROM $2::uuid OR r.kind<>'ORDER'
        OR r.business_id IS DISTINCT FROM o.id::text OR r.points IS DISTINCT FROM o.total_points
        OR r.refunded_points<0 OR r.refunded_points>r.points OR r.refunded_points::bigint IS DISTINCT FROM coalesce(f.refunded,0)
        OR NOT coalesce((r.status='RESERVED' AND f.reserves=1 AND f.debits=0 AND f.captures=0 AND f.releases=0)
          OR (r.status='CAPTURED' AND ((f.debits=1 AND f.reserves=0 AND f.captures=0 AND f.releases=0)
            OR (f.debits=0 AND f.reserves=1 AND f.captures=1 AND f.releases=0)))
          OR (r.status='RELEASED' AND f.debits=0 AND f.reserves=1 AND f.captures=0 AND f.releases=1),false)
        OR EXISTS(SELECT 1 FROM point_ledger l WHERE l.reservation_id=r.id AND
          (l.account_id<>r.account_id OR l.user_id<>$2::uuid OR l.reference_id IS DISTINCT FROM o.id
          OR (l.type IN ('ORDER_DEBIT','ORDER_RESERVE') AND -l.delta::bigint<>r.points::bigint)
          OR (l.type IN ('ORDER_CAPTURE','ORDER_RELEASE') AND -l.frozen_delta::bigint<>r.points::bigint))))::int AS invalid
      FROM point_reservations r LEFT JOIN orders o ON o.point_reservation_id=r.id LEFT JOIN funding f ON f.reservation_id=r.id
      WHERE r.account_id=$1`, [account.id, account.user_id]);
    const { rows: [recharge] } = await client.query<{ invalid: number }>(`SELECT count(*)::int AS invalid FROM recharge_orders r WHERE r.user_id=$1 AND (
      (r.points_ledger_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.id=r.points_ledger_id
        AND l.recharge_order_id=r.id AND l.account_id=$2 AND l.user_id=r.user_id AND l.type='RECHARGE' AND l.delta=r.points AND l.frozen_delta=0)
        OR r.status NOT IN ('SUCCEEDED','PAID','REFUNDING','REFUNDED') OR r.paid_at IS NULL OR r.credited_at IS NULL))
      OR (r.status='SUCCEEDED' AND r.points_ledger_id IS NULL)
      OR (SELECT count(*) FROM point_ledger l WHERE l.recharge_order_id=r.id)>1
      OR EXISTS(SELECT 1 FROM point_ledger l WHERE l.recharge_order_id=r.id AND l.id IS DISTINCT FROM r.points_ledger_id))`, [account.user_id, account.id]);
    const { rows: [unbound] } = await client.query<{ invalid: number }>(`SELECT count(*)::int AS invalid FROM orders o LEFT JOIN point_reservations r ON r.id=o.point_reservation_id
      WHERE o.user_id=$1 AND o.settlement_type='POINTS' AND (r.id IS NULL OR r.account_id IS DISTINCT FROM $2::uuid OR r.points IS DISTINCT FROM o.total_points OR r.business_id IS DISTINCT FROM o.id::text OR r.kind IS DISTINCT FROM 'ORDER')`, [account.user_id, account.id]);
    const balanced = totals!.available === String(account.available_points) && totals!.frozen === String(account.frozen_points)
      && reserved!.points === String(account.frozen_points) && totals!.broken_chain === 0 && reserved!.invalid === 0 && recharge!.invalid === 0 && unbound!.invalid === 0;
    return { balanced, availablePoints: account.available_points, frozenPoints: account.frozen_points, ledgerAvailable: totals!.available,
      ledgerFrozen: totals!.frozen, reservedPoints: reserved!.points, brokenRunningBalances: totals!.broken_chain,
      invalidReservations: reserved!.invalid, invalidRechargeCredits: recharge!.invalid, invalidOrderFunding: unbound!.invalid,
      sequenceBasis: 'GLOBAL_ORDER_PER_ACCOUNT' as const };
  }
  async reconcile(userId: string, actorId: string, reason: string, key: string) {
    this.requireSite(); reason = pointReason(reason);
    const action = 'ONCE_POINTS_RECONCILE', payload = { action, targetId: userId, actorId, reason };
    return this.db.transaction(async client => {
      const prior = await adminPointReplay(client, actorId, action, key, payload); if (prior) return prior.result;
      const account = await lockPointAccount(client, userId, true), details = await this.inspect(client, account);
      await client.query('UPDATE point_accounts SET status=$2,updated_at=now() WHERE id=$1', [account.id, details.balanced ? 'ACTIVE' : 'REVIEW']);
      if (!details.balanced) await this.record(client, userId, 'ACCOUNT_INVARIANT', details);
      else await client.query(`UPDATE point_exceptions SET status='RESOLVED',reason=$2,resolved_by=$3,resolved_at=now(),updated_at=now()
        WHERE user_id=$1 AND kind='ACCOUNT_INVARIANT' AND status='OPEN'`, [userId, reason, actorId]);
      await pointAudit(client, actorId, action, userId, reason, details);
      await saveAdminPointResult(client, actorId, action, key, userId, payload, details);
      return details;
    });
  }
  async resolve(actorId: string, id: string, reason: string, key: string) {
    this.requireSite(); reason = pointReason(reason);
    const action = 'ONCE_POINT_EXCEPTION_RESOLVE', payload = { action, targetId: id, actorId, reason };
    return this.db.transaction(async client => {
      const prior = await adminPointReplay(client, actorId, action, key, payload); if (prior) return prior.result;
      const { rows: [owner] } = await client.query<{ user_id: string | null }>('SELECT user_id FROM point_exceptions WHERE id=$1', [id]);
      if (!owner) throw new ApiFailure(404, 'POINT_EXCEPTION_NOT_FOUND', 'Point exception was not found');
      const account = owner.user_id ? await lockPointAccount(client, owner.user_id, true) : null;
      const { rows: [row] } = await client.query<{ kind: string; status: string; recharge_order_id: string | null }>('SELECT kind,status,recharge_order_id FROM point_exceptions WHERE id=$1 FOR UPDATE', [id]);
      if (row!.status !== 'RESOLVED') {
        if (row!.kind === 'ACCOUNT_INVARIANT' && account) {
          const details = await this.inspect(client, account);
          if (!details.balanced) throw new ApiFailure(409, 'ACCOUNT_INVARIANT_UNRESOLVED', 'Account must balance before resolving this exception', details);
        } else if (row!.kind === 'PAID_UNCREDITED' && row!.recharge_order_id && account) {
          const { rowCount } = await client.query(`SELECT 1 FROM recharge_orders r JOIN point_ledger l ON l.id=r.points_ledger_id AND l.recharge_order_id=r.id
            WHERE r.id=$1 AND r.user_id=$2 AND r.sales_storefront_id='once' AND r.status='SUCCEEDED' AND r.paid_at IS NOT NULL AND r.credited_at IS NOT NULL
              AND l.user_id=r.user_id AND l.account_id=$3 AND l.delta=r.points AND l.frozen_delta=0 AND l.type='RECHARGE'`, [row!.recharge_order_id, account.user_id, account.id]);
          if (rowCount !== 1) throw new ApiFailure(409, 'PAYMENT_EXCEPTION_UNRESOLVED', 'Observed payment has not been credited to its original account');
        } else throw new ApiFailure(409, 'POINT_EXCEPTION_REQUIRES_EVIDENCE', 'This exception needs original payment or source evidence; it cannot be closed by acknowledgement');
        await client.query("UPDATE point_exceptions SET status='RESOLVED',reason=$2,resolved_by=$3,resolved_at=now(),updated_at=now() WHERE id=$1", [id, reason, actorId]);
      }
      const result = { id, status: 'RESOLVED' as const };
      await pointAudit(client, actorId, action, id, reason, result);
      await saveAdminPointResult(client, actorId, action, key, id, payload, result);
      return result;
    });
  }
  async recover() {
    if (this.reconciling || !this.environment.isWorker || this.environment.siteId !== 'once') return;
    this.reconciling = true;
    try {
      const { rows } = await this.db.query<{ user_id: string }>(`SELECT a.user_id FROM point_accounts a JOIN users u ON u.id=a.user_id
        WHERE u.auth_kind='LOCAL' AND ($1::uuid IS NULL OR a.user_id>$1::uuid) ORDER BY a.user_id LIMIT 50`, [this.afterUserId]);
      for (const row of rows) {
        try {
          await this.db.transaction(async client => {
            const account = await lockPointAccount(client, row.user_id, true), details = await this.inspect(client, account);
            if (!details.balanced) {
              await client.query("UPDATE point_accounts SET status='REVIEW',updated_at=now() WHERE id=$1", [account.id]);
              await this.record(client, row.user_id, 'ACCOUNT_INVARIANT', details);
            }
          });
        } catch { console.error('Once wallet reconciliation failed'); }
      }
      this.afterUserId = rows.length === 50 ? rows.at(-1)!.user_id : null;
    } finally { this.reconciling = false; }
  }
  onModuleInit() {
    if (!this.environment.isWorker || this.environment.siteId !== 'once') return;
    const reconcile = () => { void this.recover().catch(() => console.error('Once wallet reconciliation recovery failed')); };
    this.timer = setInterval(reconcile, 60000); this.timer.unref(); reconcile();
  }
  onModuleDestroy() { clearInterval(this.timer); }
}
