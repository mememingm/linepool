import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  accountProfileInputSchema, createOrderInputSchema, inboxQuerySchema, listQuerySchema, loginInputSchema, markReadInputSchema,
  createRenewalInputSchema, paginationQuerySchema, usageQuerySchema,
  numbersQuerySchema, pointsQuerySchema, preferencesInputSchema, registerInputSchema, uuidSchema,
  type CreateOrderInput, type InboxQuery, type ListQuery, type LoginInput, type NumbersQuery,
  type AccountProfileInput, type PointsQuery, type RegisterInput, type CreateRenewalInput, type PaginationQuery, type UsageQuery,
} from '@linepool/contracts';
import { Authentication, SessionGuard, type SessionRequest } from './authentication.js';
import { SchemaPipe } from './http.js';
import { Database } from './database.js';
import { Ordering } from './ordering.js';
import { Workspace } from './workspace.js';
import { NumberServices } from './number-services.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: Authentication) {}
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body(new SchemaPipe(loginInputSchema)) input: LoginInput, @Res({ passthrough: true }) response: Response) {
    return { data: await this.auth.login(input, response) };
  }
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async register(@Body(new SchemaPipe(registerInputSchema)) input: RegisterInput, @Res({ passthrough: true }) response: Response) {
    return { data: await this.auth.register(input, response) };
  }
  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: SessionRequest, @Res({ passthrough: true }) response: Response) {
    // Existing API-only sessions migrate during the shared login page's session check.
    this.auth.setSessionCookie(request.sessionToken, request.sessionExpiresAt, response);
    return { data: request.user };
  }
  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(@Req() request: SessionRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request, response);
    return { data: { loggedOut: true } };
  }
}
@Controller()
@UseGuards(SessionGuard)
export class WorkspaceController {
  constructor(private readonly workspace: Workspace, private readonly ordering: Ordering, private readonly auth: Authentication) {}
  @Get('catalog')
  async catalog() { return { data: await this.workspace.catalog() }; }
  @Get('dashboard')
  async dashboard(@Req() request: SessionRequest) { return { data: await this.workspace.dashboard(request.user.id) }; }
  @Get('numbers')
  numbers(@Req() request: SessionRequest, @Query(new SchemaPipe(numbersQuerySchema)) input: NumbersQuery) {
    return this.workspace.numbers(request.user.id, input);
  }
  @Get('orders')
  orders(@Req() request: SessionRequest, @Query(new SchemaPipe(listQuerySchema)) input: ListQuery) {
    return this.workspace.orders(request.user.id, input);
  }
  @Get('orders/:id')
  async order(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string) {
    return { data: await this.workspace.orderDetail(request.user.id, id) };
  }
  @Post('orders')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createOrderInputSchema)) input: CreateOrderInput) {
    return { data: await this.ordering.create(request.user.id, input) };
  }
  @Get('inbox')
  inbox(@Req() request: SessionRequest, @Query(new SchemaPipe(inboxQuerySchema)) input: InboxQuery) {
    return this.workspace.inbox(request.user.id, input);
  }
  @Post('inbox/read')
  async markRead(@Req() request: SessionRequest, @Body(new SchemaPipe(markReadInputSchema)) input: z.infer<typeof markReadInputSchema>) {
    return { data: await this.workspace.markRead(request.user.id, input.ids) };
  }
  @Get('points')
  points(@Req() request: SessionRequest, @Query(new SchemaPipe(pointsQuerySchema)) input: PointsQuery) {
    return this.workspace.points(request.user.id, input);
  }
  @Get('account')
  async account(@Req() request: SessionRequest) { return { data: await this.workspace.account(request.user.id) }; }
  @Patch('account/profile')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async profile(@Req() request: SessionRequest, @Body(new SchemaPipe(accountProfileInputSchema)) input: AccountProfileInput) {
    return { data: await this.auth.updateProfile(request.user.id, request.sessionToken, input) };
  }
  @Patch('account/preferences')
  async preferences(@Req() request: SessionRequest, @Body(new SchemaPipe(preferencesInputSchema)) input: z.infer<typeof preferencesInputSchema>) {
    return { data: await this.workspace.preferences(request.user.id, input.expiryNotice) };
  }
}
@Controller('numbers/:id')
@UseGuards(SessionGuard)
export class NumberServicesController {
  constructor(private readonly numbers: NumberServices) {}
  @Get('renewal-options')
  async options(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string) {
    return { data: await this.numbers.options(request.user.id, id) };
  }
  @Get('renewals')
  records(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.numbers.list(request.user.id, id, input);
  }
  @Post('renewals')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async create(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(createRenewalInputSchema)) input: CreateRenewalInput) {
    return { data: await this.numbers.create(request.user.id, id, input) };
  }
  @Get('usage')
  async usage(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(usageQuerySchema)) input: UsageQuery) {
    return { data: await this.numbers.usage(request.user.id, id, input) };
  }
}
@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { data: { status: 'ok', database: 'ok', mode: 'demo' } };
  }
}
