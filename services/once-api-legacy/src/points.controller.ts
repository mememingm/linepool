import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthedRequest, AuthService, SessionGuard } from './auth';
import { AdminGuard } from './admin.controller';
import { HistoryQuery } from './dto';
import { PointsService } from './points.service';

class RechargeDto {
  @IsInt() @Min(1) @Max(1000000000) amountMinor!: number;
  @IsOptional() @IsUUID() purchaseIntentId?: string;
}
class IntentDto {
  @IsIn(['RENT', 'RENEW']) kind!: 'RENT' | 'RENEW';
  @IsOptional() @IsString() @MaxLength(40) number?: string;
  @IsOptional() @IsUUID() leaseId?: string;
  @IsInt() @Min(1) @Max(365) term!: number;
  @IsInt() @Min(1) quoteVersion!: number;
}
class ReasonDto {
  @IsString() @MinLength(2) @MaxLength(500) @Matches(/\S/) reason!: string;
}
class RefundDto extends ReasonDto {
  @IsInt() @Min(1) @Max(1000000000) amountMinor!: number;
}
class DemoPayDto {
  @IsIn(['SUCCESS', 'FAILURE', 'UNKNOWN_SUCCESS', 'UNKNOWN_FAILURE']) scenario!: string;
}
class ApprovalDto extends ReasonDto {
  @IsOptional() @IsIn(['SUCCESS', 'FAILURE', 'UNKNOWN_SUCCESS', 'UNKNOWN_FAILURE']) scenario?: string;
}
class AdjustDto extends ReasonDto {
  @IsInt() @Min(-1000000000) @Max(1000000000) delta!: number;
}
class ConsumptionRefundDto extends ReasonDto {
  @IsInt() @Min(1) @Max(1000000000) points!: number;
}
class RulesDto extends ReasonDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(1000000000) minMinor!: number;
  @IsInt() @Min(1) @Max(1000000000) maxMinor!: number;
  @IsInt() @Min(1) @Max(1000000000) dailyMinor!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsInt({ each: true }) presetsMinor!: number[];
}
export class PointAdminQuery extends HistoryQuery {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
}
@Controller('api/points')
@UseGuards(SessionGuard)
export class PointsController {
  constructor(private readonly points: PointsService, private readonly auth: AuthService) {}
  @Get('config') config() { return this.points.config(); }
  @Get('account') account(@Req() req: AuthedRequest) { return this.points.account(req.account.id); }
  @Get('ledger') ledger(@Req() req: AuthedRequest, @Query() query: HistoryQuery) { return this.points.history(req.account.id, 'ledger', query.limit, query.cursor); }
  @Get('recharges') recharges(@Req() req: AuthedRequest, @Query() query: HistoryQuery) { return this.points.history(req.account.id, 'recharges', query.limit, query.cursor); }
  @Get('refunds') refunds(@Req() req: AuthedRequest, @Query() query: HistoryQuery) { return this.points.history(req.account.id, 'refunds', query.limit, query.cursor); }
  @Post('intents') intent(@Req() req: AuthedRequest, @Body() body: IntentDto) { return this.points.createIntent(req.account.id, body); }
  @Get('intents/:id') getIntent(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.points.intent(req.account.id, id); }
  @Post('recharges') recharge(@Req() req: AuthedRequest, @Body() body: RechargeDto, @Headers('idempotency-key') key: string) {
    this.auth.throttle('recharge:' + req.account.id);
    return this.points.createRecharge(req.account.id, body.amountMinor, key, body.purchaseIntentId);
  }
  @Get('recharges/:id') detail(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.points.recharge(req.account.id, id); }
  @Post('recharges/:id/check') check(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.auth.throttle('payment-check:' + req.account.id);
    return this.points.checkRecharge(req.account.id, id);
  }
  @Post('recharges/:id/demo-pay') demoPay(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: DemoPayDto) {
    this.auth.throttle('demo-payment:' + req.account.id);
    return this.points.demoPay(req.account.id, id, body.scenario);
  }
  @Post('recharges/:id/refunds') requestRefund(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefundDto, @Headers('idempotency-key') key: string) {
    this.auth.throttle('refund-request:' + req.account.id);
    return this.points.requestRefund(req.account.id, id, body.amountMinor, body.reason, key);
  }
}
@Controller('api/admin/points')
@UseGuards(SessionGuard, AdminGuard)
export class AdminPointsController {
  constructor(private readonly points: PointsService) {}
  @Get('summary') summary() { return this.points.adminSummary(); }
  @Get('rules') rules() { return this.points.config(); }
  @Post('rules') updateRules(@Req() req: AuthedRequest, @Body() body: RulesDto) { const { reason, ...rules } = body; return this.points.updateRules(req.account.id, rules, reason); }
  @Get('recharges') recharges(@Query() query: PointAdminQuery) { return this.points.adminHistory('recharges', query); }
  @Get('refunds') refunds(@Query() query: PointAdminQuery) { return this.points.adminHistory('refunds', query); }
  @Get('exceptions') exceptions(@Query() query: PointAdminQuery) { return this.points.adminHistory('exceptions', query); }
  @Get('users/:id') account(@Param('id', ParseUUIDPipe) id: string) { return this.points.account(id); }
  @Get('users/:id/ledger') ledger(@Param('id', ParseUUIDPipe) id: string, @Query() query: HistoryQuery) { return this.points.history(id, 'ledger', query.limit, query.cursor); }
  @Post('users/:id/adjust') adjust(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: AdjustDto, @Headers('idempotency-key') key: string) { return this.points.adjust(req.account.id, id, body.delta, body.reason, key); }
  @Post('orders/:id/refund') refundConsumption(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConsumptionRefundDto, @Headers('idempotency-key') key: string) { return this.points.refundConsumption(req.account.id, id, body.points, body.reason, key); }
  @Post('refunds/:id/approve') approve(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApprovalDto) { return this.points.approveRefund(req.account.id, id, body.reason, body.scenario); }
  @Post('refunds/:id/reject') reject(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) { return this.points.rejectRefund(req.account.id, id, body.reason); }
  @Post('refunds/:id/check') check(@Param('id', ParseUUIDPipe) id: string, @Body() _body: ReasonDto) { return this.points.runRefund(id); }
  @Post('users/:id/reconcile') reconcile(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) { return this.points.reconcile(id, req.account.id, body.reason); }
  @Post('recharges/:id/return-uncredited') returnUncredited(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) { return this.points.returnUncredited(req.account.id, id, body.reason); }
  @Post('exceptions/:id/resolve') resolve(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) { return this.points.resolveException(req.account.id, id, body.reason); }
}
