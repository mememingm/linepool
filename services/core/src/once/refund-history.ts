import { Injectable } from '@nestjs/common';
import { Database } from '../database.js';
import { cashRefundDisabled } from './point-support.js';

export const refundHistoryFields = `r.id,r.user_id AS "userId",r.recharge_order_id AS "rechargeId",
  r.recharge_order_id AS "rechargeOrderId",r.actor_id AS "actorId",r.kind,r.status,
  r.amount_minor::float8 AS "amountMinor",r.currency,c.fraction_digits AS "fractionDigits",r.points,r.reason,
  r.created_at AS "createdAt",r.updated_at AS "updatedAt",r.completed_at AS "completedAt"`;
@Injectable()
export class OnceRefundHistory {
  constructor(private readonly db: Database) {}
  async totals() {
    const { rows } = await this.db.query(`SELECT r.currency,c.fraction_digits AS "fractionDigits",r.status,
      count(*)::int AS count,sum(r.amount_minor)::text AS "amountMinor"
      FROM refund_orders r JOIN recharge_orders c ON c.id=r.recharge_order_id
      WHERE c.sales_storefront_id='once' GROUP BY r.currency,c.fraction_digits,r.status
      ORDER BY r.currency,c.fraction_digits,r.status`);
    return { historical: true, cashRefundAvailable: false, totals: rows };
  }
  disabled(): never { return cashRefundDisabled(); }
}
