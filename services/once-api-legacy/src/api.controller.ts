import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService, AuthedRequest, SessionGuard } from './auth';
import { ChangePasswordDto, CredentialsDto, ForgotPasswordDto, ResetPasswordDto, RentDto, RenewDto, HistoryQuery, OrderHistoryQuery, MockOrderDto, MockEventDto, SendSmsDto } from './dto';
import { FulfillmentService } from './fulfillment.service';
import { EventsService } from './events.service';
import { DbService } from './db.service';
import { LeasesService } from './leases.service';
import { settings } from './config';
import { OutboundService } from './outbound.service';

class SnapshotQuery { @IsOptional() @IsUUID() leaseId?: string; }

@Controller('api')
export class ApiController {
  constructor(private readonly auth:AuthService,private readonly leases:LeasesService,private readonly db:DbService,
    private readonly fulfillment:FulfillmentService,private readonly events:EventsService,private readonly outbound:OutboundService) {}
  @Get('health')
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return {ok:true,database:'postgresql',demo:settings.demo};
  }
  @Post('auth/register')
  register(@Body() body:CredentialsDto,@Req() req:Request,@Res({passthrough:true}) res:Response) {
    this.auth.throttle('register:'+req.ip);
    return this.auth.register(body,res);
  }
  @Post('auth/login')
  login(@Body() body:CredentialsDto,@Req() req:Request,@Res({passthrough:true}) res:Response) {
    this.auth.throttle('login-ip:'+req.ip);
    this.auth.throttle('login-email:'+body.email.toLowerCase());
    return this.auth.login(body,res);
  }
  @Post('auth/forgot-password') @HttpCode(200)
  forgotPassword(@Body() body:ForgotPasswordDto,@Req() req:Request) {
    this.auth.throttle('forgot-ip:'+req.ip);
    this.auth.throttle('forgot-email:'+body.email.toLowerCase());
    return this.auth.forgotPassword(body);
  }
  @Post('auth/reset-password') @HttpCode(200)
  resetPassword(@Body() body:ResetPasswordDto,@Req() req:Request) {
    this.auth.throttle('reset-ip:'+req.ip);
    return this.auth.resetPassword(body);
  }
  @Post('auth/password') @HttpCode(200) @UseGuards(SessionGuard)
  changePassword(@Req() req:AuthedRequest,@Body() body:ChangePasswordDto) {
    this.auth.throttle('password:'+req.account.id);
    return this.auth.changePassword(req,body);
  }
  @Post('auth/logout')
  logout(@Req() req:Request,@Res({passthrough:true}) res:Response) { return this.auth.logout(req,res); }
  @Get('auth/me') @UseGuards(SessionGuard)
  me(@Req() req:AuthedRequest) { return req.account; }
  @Get('plans')
  plans() { return this.leases.plans(); }
  @Get('inventory')
  inventory() { return this.leases.inventory(); }
  @Get('state') @UseGuards(SessionGuard)
  state(@Req() req:AuthedRequest,@Query() query:SnapshotQuery) { return this.leases.snapshot(req.account.id,query.leaseId); }
  @Get('leases') @UseGuards(SessionGuard)
  list(@Req() req:AuthedRequest) { return this.leases.list(req.account.id); }
  @Get('leases/:id') @UseGuards(SessionGuard)
  detail(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.leases.owned(req.account.id,id).then(({userId,...lease})=>lease); }
  @Post('leases') @UseGuards(SessionGuard)
  rent(@Req() req:AuthedRequest,@Body() body:RentDto,@Headers('idempotency-key') key:string) { return this.leases.rent(req.account.id,body.number,body.term,key,body.quoteVersion,body.purchaseIntentId); }
  @Post('leases/:id/renew') @UseGuards(SessionGuard)
  renew(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:RenewDto,@Headers('idempotency-key') key:string) { return this.leases.renew(req.account.id,id,body.term,key,body.quoteVersion,body.purchaseIntentId); }
  @Get('leases/:id/messages') @UseGuards(SessionGuard)
  messages(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.leases.messages(req.account.id,id); }
  @Post('leases/:id/outbound') @HttpCode(202) @UseGuards(SessionGuard)
  sendSms(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() body:SendSmsDto,@Headers('idempotency-key') key:string) {
    this.auth.throttle('send:'+req.account.id);
    return this.outbound.send(req.account.id,id,body.to,body.content,key);
  }
  @Get('leases/:id/outbound') @UseGuards(SessionGuard)
  outboundHistory(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Query() query:HistoryQuery) {
    return this.outbound.list(req.account.id,id,query.limit,query.cursor);
  }
  @Get('leases/:id/outbound/:messageId') @UseGuards(SessionGuard)
  outboundDetail(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string) {
    return this.outbound.get(req.account.id,id,messageId);
  }
  @Post('leases/:id/demo-message') @UseGuards(SessionGuard)
  simulate(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) {
    this.auth.throttle('simulate:'+req.account.id);
    return this.leases.simulate(req.account.id,id);
  }
  @Get('purchases/:id') @UseGuards(SessionGuard)
  purchase(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.fulfillment.get(req.account.id,id); }
  @Post('purchases/:id/check') @UseGuards(SessionGuard)
  checkPurchase(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.fulfillment.run(req.account.id,id,true); }
  @Get('orders') @UseGuards(SessionGuard)
  orders(@Req() req:AuthedRequest) { return this.leases.orders(req.account.id); }
  @Get('leases/:id/messages/history') @UseGuards(SessionGuard)
  messageHistory(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string,@Query() query:HistoryQuery) {
    return this.leases.messageHistory(req.account.id,id,query.limit,query.cursor);
  }
  @Get('orders/history') @UseGuards(SessionGuard)
  orderHistory(@Req() req:AuthedRequest,@Query() query:OrderHistoryQuery) {
    return this.leases.orderHistory(req.account.id,query.limit,query.cursor,query.leaseId);
  }
  @Post('demo/orders') @UseGuards(SessionGuard)
  createMockOrder(@Req() req:AuthedRequest,@Body() body:MockOrderDto,@Headers('idempotency-key') key:string) {
    return this.fulfillment.create(req.account.id,body.number,body.term,body.scenario,key);
  }
  @Get('demo/orders/:id') @UseGuards(SessionGuard)
  mockOrder(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.fulfillment.get(req.account.id,id); }
  @Post('demo/orders/:id/process') @UseGuards(SessionGuard)
  processMockOrder(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.fulfillment.run(req.account.id,id); }
  @Post('demo/orders/:id/reconcile') @UseGuards(SessionGuard)
  reconcileMockOrder(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.fulfillment.run(req.account.id,id,true); }
  @Post('demo/events') @UseGuards(SessionGuard)
  receiveMockEvent(@Req() req:AuthedRequest,@Body() body:MockEventDto) {
    const {eventId,...payload}=body;
    return this.events.receive(req.account.id,eventId,payload);
  }
  @Get('demo/events/:id') @UseGuards(SessionGuard)
  mockEvent(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.events.get(req.account.id,id); }
  @Post('demo/events/:id/retry') @UseGuards(SessionGuard)
  retryMockEvent(@Req() req:AuthedRequest,@Param('id',ParseUUIDPipe) id:string) { return this.events.process(req.account.id,id); }
}
