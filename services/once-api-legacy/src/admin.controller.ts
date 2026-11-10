import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Headers, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DbService } from './db.service';
import { AuthedRequest, SessionGuard } from './auth';
import { AdminService } from './admin.service';

type AdminRequest = AuthedRequest & { admin: { id: string; email: string; role: string } };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: DbService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const user = await this.db.user.findUnique({ where: { id: request.account.id }, select: { id: true, email: true, role: true, status: true } });
    if (!user || user.status !== 'ACTIVE' || user.role !== 'ADMIN') {
      throw new ForbiddenException({ message: '当前账号没有管理员权限。', code: 'ADMIN_REQUIRED' });
    }
    request.admin = user;
    return true;
  }
}

@Controller('api/admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('session')
  session(@Req() request: AdminRequest) {
    return { id: request.admin.id, email: request.admin.email, role: 'ADMIN' as const };
  }
  @Get('summary')
  summary() { return this.admin.summary(); }
  @Get('users')
  users(@Query() query: Record<string, unknown>) { return this.admin.list('users', query); }
  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) { return this.admin.detail('users', id); }
  @Get('numbers')
  numbers(@Query() query: Record<string, unknown>) { return this.admin.list('numbers', query); }
  // Fixed paths must stay above the numbers/:id routes.
  @Get('numbers/stats')
  numberStats() { return this.admin.numberStats(); }
  @Post('numbers')
  createNumber(@Req() request: AdminRequest, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.createNumber(request.admin.id, body, key);
  }
  @Post('numbers/import/preview') @HttpCode(200)
  previewImport(@Body() body: Record<string, unknown>) { return this.admin.previewImport(body); }
  @Post('numbers/import')
  importNumbers(@Req() request: AdminRequest, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.importNumbers(request.admin.id, body, key);
  }
  @Post('numbers/batch')
  batchNumbers(@Req() request: AdminRequest, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.batchNumbers(request.admin.id, body, key);
  }
  @Get('plans')
  plans() { return this.admin.plans(); }
  @Post('plans')
  createPlan(@Req() request: AdminRequest, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.createPlan(request.admin.id, body, key);
  }
  @Post('plans/:id')
  updatePlan(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.updatePlan(request.admin.id, id, body, key);
  }
  @Get('settings')
  settings() { return this.admin.settings(); }
  @Post('settings')
  updateSettings(@Req() request: AdminRequest, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.updateSettings(request.admin.id, body, key);
  }
  @Get('numbers/:id')
  number(@Param('id', ParseUUIDPipe) id: string) { return this.admin.detail('numbers', id); }
  @Get('leases')
  leases(@Query() query: Record<string, unknown>) { return this.admin.list('leases', query); }
  @Get('leases/:id')
  lease(@Param('id', ParseUUIDPipe) id: string) { return this.admin.detail('leases', id); }
  @Get('orders')
  orders(@Query() query: Record<string, unknown>) { return this.admin.list('orders', query); }
  @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string) { return this.admin.detail('orders', id); }
  @Get('messages')
  messages(@Query() query: Record<string, unknown>) { return this.admin.list('messages', query); }
  @Get('webhooks')
  webhooks(@Query() query: Record<string, unknown>) { return this.admin.list('webhooks', query); }
  @Get('webhooks/summary')
  webhookSummary() { return this.admin.webhookSummary(); }
  @Get('webhooks/:id')
  webhook(@Param('id', ParseUUIDPipe) id: string) { return this.admin.webhookDetail(id); }
  @Get('audit')
  audit(@Query() query: Record<string, unknown>) { return this.admin.list('audit', query); }

  @Post('users/:id/status')
  userStatus(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.userStatus(request.admin.id, id, body, key);
  }
  @Post('users/:id/password')
  password(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.resetPassword(request.admin.id, id, body, key);
  }
  @Post('numbers/:id/assign')
  assign(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.assignNumber(request.admin.id, id, body, key);
  }
  @Post('numbers/:id/hold')
  hold(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.holdNumber(request.admin.id, id, body, key);
  }
  @Post('leases/:id/end')
  end(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.endLease(request.admin.id, id, body, key);
  }
  @Post('leases/:id/extend')
  extend(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.extendLease(request.admin.id, id, body, key);
  }
  @Post('numbers/:id')
  updateNumber(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.updateNumber(request.admin.id, id, body, key);
  }
  @Post('numbers/:id/delete')
  deleteNumber(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.deleteNumber(request.admin.id, id, body, key);
  }
  @Post('webhooks/:id/retry')
  retryWebhook(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Headers('idempotency-key') key: string) {
    return this.admin.retryWebhook(request.admin.id, id, body, key);
  }
}
