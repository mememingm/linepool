import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  onceMockOrderInputSchema, onceOrderHistoryQuerySchema, onceRentInputSchema,
  onceRenewInputSchema, onceRequestKeySchema,
  type OnceRentInput, type OnceRenewInput, type OnceOrderHistoryQuery,
} from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../authentication.js';
import { Database } from '../database.js';
import { Environment } from '../environment.js';
import { ApiFailure, SchemaPipe } from '../http.js';
import { OnceLeases } from './leases.js';

const uuid = z.uuid();
const stateQuery = z.strictObject({ leaseId: uuid.optional() });
const keyPipe = new SchemaPipe(onceRequestKeySchema);
function selfService(request: SessionRequest) {
  if (request.user.authKind === 'PINCLODE') throw new ApiFailure(403, 'SELF_SERVICE_ACCOUNT_REQUIRED', 'A local self-service account is required');
  return request.user.id;
}

@Controller('once')
export class OnceCatalogController {
  constructor(private readonly leases: OnceLeases, private readonly db: Database, private readonly environment: Environment) {}
  @Get('health')
  async health() {
    await this.db.query('SELECT 1');
    return { status: 'ok', database: 'ok', mode: this.environment.values.PC_MODE, siteId: this.environment.siteId };
  }
  @Get('plans')
  plans() { return this.leases.plans(); }
  @Get('inventory')
  inventory() { return this.leases.inventory(); }
}

@Controller('once')
@UseGuards(SessionGuard)
export class OnceLeaseController {
  constructor(private readonly leases: OnceLeases) {}
  @Get('state')
  state(@Req() request: SessionRequest, @Query(new SchemaPipe(stateQuery)) query: z.infer<typeof stateQuery>) {
    return this.leases.state(selfService(request), query.leaseId);
  }
  @Get('leases')
  list(@Req() request: SessionRequest) { return this.leases.list(selfService(request)); }
  @Get('leases/:id')
  detail(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.detail(selfService(request), id);
  }
  @Post('leases')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  rent(@Req() request: SessionRequest, @Body(new SchemaPipe(onceRentInputSchema)) input: OnceRentInput) {
    return this.leases.rent(selfService(request), input, keyPipe.transform(request.headers['idempotency-key']));
  }
  @Post('leases/:id/renew')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  renew(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string,
    @Body(new SchemaPipe(onceRenewInputSchema)) input: OnceRenewInput) {
    return this.leases.renew(selfService(request), id, input, keyPipe.transform(request.headers['idempotency-key']));
  }
  @Get('purchases/:id')
  purchase(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.purchase(selfService(request), id);
  }
  @Post('purchases/:id/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  check(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.checkPurchase(selfService(request), id);
  }
  @Get('orders')
  orders(@Req() request: SessionRequest) { return this.leases.orders(selfService(request)); }
  @Get('orders/history')
  history(@Req() request: SessionRequest, @Query(new SchemaPipe(onceOrderHistoryQuerySchema)) query: OnceOrderHistoryQuery) {
    return this.leases.orderHistory(selfService(request), query);
  }
  @Post('demo/orders')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  demoOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(onceMockOrderInputSchema)) input: z.infer<typeof onceMockOrderInputSchema>) {
    const { scenario, ...selection } = input;
    return this.leases.demoOrder(selfService(request), selection, keyPipe.transform(request.headers['idempotency-key']), scenario);
  }
  @Get('demo/orders/:id')
  demoPurchase(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.demoPurchase(selfService(request), id);
  }
  @Post('demo/orders/:id/process')
  @HttpCode(200)
  processDemo(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.processDemoPurchase(selfService(request), id);
  }
  @Post('demo/orders/:id/reconcile')
  @HttpCode(200)
  reconcileDemo(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuid)) id: string) {
    return this.leases.processDemoPurchase(selfService(request), id);
  }
}
