import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PaymentAttempt, RechargeOrder, RefundOrder } from '@prisma/client';
import { settings } from './config';

export type PaymentResult = {
  status: 'OPEN' | 'FAILED' | 'PAID' | 'UNKNOWN';
  provider: string; merchant: string; transactionId?: string;
  rechargeId: string; amountMinor: number; currency: string; paidAt?: string;
};
export type RefundResult = { status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; externalId?: string };
/** Replace this DI provider with the colleague's verified channel adapter. No browser request may produce a trusted PAID result. */
@Injectable()
export class PaymentGateway {
  readonly provider = 'local-mock';
  readonly merchant = 'once-demo';
  get available() { return settings.demo && !settings.production; }
  private assertLocal() { if (!this.available) throw new ForbiddenException('支付渠道尚未接入，暂不可在线收款或退款。'); }
  async checkout(order: RechargeOrder) {
    this.assertLocal();
    return { provider: this.provider, merchant: this.merchant, externalId: `mock:${order.id}`, checkoutUrl: `/#/app/points?recharge=${order.id}` };
  }
  async queryPayment(order: RechargeOrder, attempt: PaymentAttempt): Promise<PaymentResult> {
    this.assertLocal();
    const status = attempt.status === 'SUBMITTED' ? (attempt.scenario.endsWith('FAILURE') ? 'FAILED' : 'PAID') : 'OPEN';
    return { status, provider: this.provider, merchant: this.merchant, transactionId: status === 'PAID' ? `mock-txn:${order.id}` : undefined,
      rechargeId: order.id, amountMinor: order.amountMinor, currency: order.currency,
      paidAt: status === 'PAID' ? (order.paidAt ?? attempt.checkedAt ?? new Date()).toISOString() : undefined };
  }
  async refund(order: RefundOrder): Promise<RefundResult> {
    this.assertLocal();
    return { status: order.scenario.startsWith('UNKNOWN_') ? 'UNKNOWN' : order.scenario === 'FAILURE' ? 'FAILED' : 'SUCCEEDED', externalId: `mock-refund:${order.id}` };
  }
  async queryRefund(order: RefundOrder): Promise<RefundResult> {
    this.assertLocal();
    return { status: order.scenario.endsWith('FAILURE') ? 'FAILED' : 'SUCCEEDED', externalId: `mock-refund:${order.id}` };
  }
}
