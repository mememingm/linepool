import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, type SessionRequest } from '../authentication.js';
import { AdminGuard } from '../administration.js';
import { SchemaPipe } from '../http.js';
import { OnceAdmin } from './admin.js';
import { adminId } from './admin-operations.js';
import { OnceIntegration } from './integration.js';

@Controller('once/admin')
@UseGuards(SessionGuard, AdminGuard)
export class OnceAdminController {
  constructor(private readonly admin: OnceAdmin, private readonly integration: OnceIntegration) {}

  @Get('session')
  session(@Req() request: SessionRequest) { return { id: request.user.id, email: request.user.email, role: 'ADMIN' as const }; }
  @Get('summary')
  summary() { return this.admin.summary(); }
  @Get('users')
  users(@Query() query: Record<string, unknown>) { return this.admin.list('users', query); }
  @Get('users/:id')
  user(@Param('id', new SchemaPipe(adminId)) id: string) { return this.admin.detail('users', id); }
  @Post('users/:id/status')
  userStatus(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.userStatus(request.user.id, id, body, key); }
  @Post('users/:id/password')
  password(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.resetPassword(request.user.id, id, body, key); }

  @Get('numbers')
  numbers(@Query() query: Record<string, unknown>) { return this.admin.list('numbers', query); }
  @Get('numbers/stats')
  numberStats() { return this.admin.numberStats(); }
  @Post('numbers')
  createNumber(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.createNumber(request.user.id, body, key); }
  @Post('numbers/import/preview')
  @HttpCode(200)
  previewImport(@Body() body: unknown) { return this.admin.previewImport(body); }
  @Post('numbers/import')
  importNumbers(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.importNumbers(request.user.id, body, key); }
  @Post('numbers/batch')
  batchNumbers(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.batchNumbers(request.user.id, body, key); }
  @Get('numbers/:id')
  number(@Param('id', new SchemaPipe(adminId)) id: string) { return this.admin.detail('numbers', id); }
  @Post('numbers/:id/assign')
  assign(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.assignNumber(request.user.id, id, body, key); }
  @Post('numbers/:id/hold')
  hold(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.holdNumber(request.user.id, id, body, key); }
  @Post('numbers/:id/delete')
  deleteNumber(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.deleteNumber(request.user.id, id, body, key); }
  @Post('numbers/:id')
  updateNumber(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.updateNumber(request.user.id, id, body, key); }

  @Get('plans')
  plans() { return this.admin.plans(); }
  @Post('plans')
  createPlan(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.savePlan(request.user.id, null, body, key); }
  @Post('plans/:id')
  updatePlan(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.savePlan(request.user.id, id, body, key); }
  @Get('settings')
  settings() { return this.admin.settings(); }
  @Post('settings')
  updateSettings(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.updateSettings(request.user.id, body, key); }

  @Get('leases')
  leases(@Query() query: Record<string, unknown>) { return this.admin.list('leases', query); }
  @Get('leases/:id')
  lease(@Param('id', new SchemaPipe(adminId)) id: string) { return this.admin.detail('leases', id); }
  @Post('leases/:id/end')
  endLease(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.endLease(request.user.id, id, body, key); }
  @Post('leases/:id/extend')
  extendLease(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.extendLease(request.user.id, id, body, key); }
  @Get('orders')
  orders(@Query() query: Record<string, unknown>) { return this.admin.list('orders', query); }
  @Get('orders/:id')
  order(@Param('id', new SchemaPipe(adminId)) id: string) { return this.admin.detail('orders', id); }
  @Get('messages')
  messages(@Query() query: Record<string, unknown>) { return this.admin.list('messages', query); }
  @Get('audit')
  audit(@Query() query: Record<string, unknown>) { return this.admin.list('audit', query); }
  @Get('webhooks')
  webhooks(@Query() query: Record<string, unknown>) { return this.admin.list('webhooks', query); }
  @Get('webhooks/summary')
  webhookSummary() { return this.admin.webhookSummary(); }
  @Get('webhooks/:id')
  webhook(@Param('id', new SchemaPipe(adminId)) id: string) { return this.admin.webhookDetail(id); }
  @Post('webhooks/:id/retry')
  retryWebhook(@Req() request: SessionRequest, @Param('id', new SchemaPipe(adminId)) id: string, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.admin.retryWebhook(request.user.id, id, body, key); }

  @Get('integrations/pingcode')
  integrationStatus() { return this.integration.overview(); }
  @Get('integrations/pingcode/numbers')
  integrationNumbers() { return this.integration.numbers(); }
  @Post('integrations/pingcode')
  saveIntegration(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.integration.save(request.user.id, body, key); }
  @Post('integrations/pingcode/check')
  @HttpCode(200)
  checkIntegration(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.integration.check(request.user.id, body, key); }
  @Post('integrations/pingcode/sync')
  syncIntegration(@Req() request: SessionRequest, @Body() body: unknown, @Headers('idempotency-key') key: string) { return this.integration.sync(request.user.id, body, key); }
}
