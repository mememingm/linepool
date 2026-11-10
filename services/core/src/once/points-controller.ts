import { Body, Controller, Get, Headers, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
  type CanActivate, type ExecutionContext } from '@nestjs/common';
import { z } from 'zod';
import { onceAdjustInputSchema, onceConsumptionRefundInputSchema, onceDemoPayInputSchema, onceHistoryQuerySchema,
  onceIntentInputSchema, oncePointRulesInputSchema, onceReasonInputSchema, onceRechargeInputSchema } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../authentication.js';
import { AdminGuard } from '../administration.js';
import { Environment } from '../environment.js';
import { ApiFailure, SchemaPipe } from '../http.js';
import { OncePoints } from './points.js';
import { cashRefundDisabled } from './point-support.js';

const adminHistorySchema = onceHistoryQuerySchema.extend({ userId: z.uuid().optional(), status: z.string().max(40).optional() });
@Injectable()
export class OncePointsGuard implements CanActivate {
  constructor(private readonly environment: Environment) {}
  canActivate(context: ExecutionContext) {
    if (this.environment.siteId !== 'once') throw new ApiFailure(404, 'ONCE_UNAVAILABLE', 'Once is not enabled on this site');
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (request.user.authKind !== 'LOCAL') throw new ApiFailure(403, 'SELF_SERVICE_REQUIRED', 'Points are available to self-service accounts only');
    return true;
  }
}
@Controller('once/points')
@UseGuards(SessionGuard, OncePointsGuard)
export class OncePointsController {
  constructor(private readonly points: OncePoints) {}
  @Get('config') config() { return this.points.config(); }
  @Get('account') account(@Req() req: SessionRequest) { return this.points.account(req.user.id); }
  @Get('ledger') ledger(@Req() req: SessionRequest, @Query(new SchemaPipe(onceHistoryQuerySchema)) query: z.infer<typeof onceHistoryQuerySchema>) { return this.points.history(req.user.id, 'ledger', query.limit, query.cursor); }
  @Get('recharges') recharges(@Req() req: SessionRequest, @Query(new SchemaPipe(onceHistoryQuerySchema)) query: z.infer<typeof onceHistoryQuerySchema>) { return this.points.history(req.user.id, 'recharges', query.limit, query.cursor); }
  @Get('refunds') refunds(@Req() req: SessionRequest, @Query(new SchemaPipe(onceHistoryQuerySchema)) query: z.infer<typeof onceHistoryQuerySchema>) { return this.points.history(req.user.id, 'refunds', query.limit, query.cursor); }
  @Post('intents') intent(@Req() req: SessionRequest, @Body(new SchemaPipe(onceIntentInputSchema)) body: z.infer<typeof onceIntentInputSchema>) { return this.points.createIntent(req.user.id, body); }
  @Get('intents/:id') getIntent(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string) { return this.points.intent(req.user.id, id); }
  @Post('recharges') recharge(@Req() req: SessionRequest, @Body(new SchemaPipe(onceRechargeInputSchema)) body: z.infer<typeof onceRechargeInputSchema>, @Headers('idempotency-key') key: string) { return this.points.createRecharge(req.user.id, body.amountMinor, key, body.purchaseIntentId); }
  @Get('recharges/:id') detail(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string) { return this.points.recharge(req.user.id, id); }
  @Post('recharges/:id/check') @HttpCode(200) check(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string) { return this.points.checkRecharge(req.user.id, id); }
  @Post('recharges/:id/demo-pay') demoPay(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new SchemaPipe(onceDemoPayInputSchema)) body: z.infer<typeof onceDemoPayInputSchema>) { return this.points.demoPay(req.user.id, id, body.scenario); }
  @Post('recharges/:id/refunds') refund() { return cashRefundDisabled(); }
}
@Controller('once/admin/points')
@UseGuards(SessionGuard, AdminGuard, OncePointsGuard)
export class OnceAdminPointsController {
  constructor(private readonly points: OncePoints) {}
  @Get('summary') summary() { return this.points.adminSummary(); }
  @Get('rules') rules() { return this.points.config(); }
  @Post('rules') updateRules(@Req() req: SessionRequest, @Body(new SchemaPipe(oncePointRulesInputSchema)) body: z.infer<typeof oncePointRulesInputSchema>, @Headers('idempotency-key') key: string) {
    const { reason, expectedVersion, ...rules } = body; return this.points.updateRules(req.user.id, rules, reason, expectedVersion, key);
  }
  @Get('recharges') recharges(@Query(new SchemaPipe(adminHistorySchema)) query: z.infer<typeof adminHistorySchema>) { return this.points.adminHistory('recharges', query); }
  @Get('refunds') refunds(@Query(new SchemaPipe(adminHistorySchema)) query: z.infer<typeof adminHistorySchema>) { return this.points.adminHistory('refunds', query); }
  @Get('exceptions') exceptions(@Query(new SchemaPipe(adminHistorySchema)) query: z.infer<typeof adminHistorySchema>) { return this.points.adminHistory('exceptions', query); }
  @Get('users/:id') account(@Param('id', ParseUUIDPipe) id: string) { return this.points.account(id); }
  @Get('users/:id/ledger') ledger(@Param('id', ParseUUIDPipe) id: string, @Query(new SchemaPipe(onceHistoryQuerySchema)) query: z.infer<typeof onceHistoryQuerySchema>) { return this.points.history(id, 'ledger', query.limit, query.cursor); }
  @Post('users/:id/adjust') adjust(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new SchemaPipe(onceAdjustInputSchema)) body: z.infer<typeof onceAdjustInputSchema>, @Headers('idempotency-key') key: string) { return this.points.adjust(req.user.id, id, body.delta, body.reason, key); }
  @Post('orders/:id/refund') refundConsumption(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new SchemaPipe(onceConsumptionRefundInputSchema)) body: z.infer<typeof onceConsumptionRefundInputSchema>, @Headers('idempotency-key') key: string) { return this.points.refundConsumption(req.user.id, id, body.points, body.reason, key); }
  @Post('users/:id/reconcile') reconcile(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new SchemaPipe(onceReasonInputSchema)) body: z.infer<typeof onceReasonInputSchema>, @Headers('idempotency-key') key: string) { return this.points.reconcile(id, req.user.id, body.reason, key); }
  @Post('exceptions/:id/resolve') resolve(@Req() req: SessionRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new SchemaPipe(onceReasonInputSchema)) body: z.infer<typeof onceReasonInputSchema>, @Headers('idempotency-key') key: string) { return this.points.resolveException(req.user.id, id, body.reason, key); }
  @Post('refunds/:id/approve') approve() { return cashRefundDisabled(); }
  @Post('refunds/:id/reject') reject() { return cashRefundDisabled(); }
  @Post('refunds/:id/check') checkRefund() { return cashRefundDisabled(); }
  @Post('recharges/:id/return-uncredited') returnUncredited() { return cashRefundDisabled(); }
}
