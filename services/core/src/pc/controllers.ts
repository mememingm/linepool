import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { pcAuthStartInputSchema, pcConnectionInputSchema, pcMessagesQuerySchema, pcPlanInputSchema,
  pcReadInputSchema, pcWaitInputSchema, uuidSchema, type PcAuthStartInput, type PcPlanInput } from '@linepool/contracts';
import { SessionGuard, type SessionRequest } from '../authentication.js';
import { AdminGuard } from '../administration.js';
import { SchemaPipe } from '../http.js';
import { PcAuthorization } from './authorization.js';
import { PcConnections } from './connections.js';
import { shopProductInputSchema, type ShopProductInput } from '@linepool/contracts/admin';
import { ShopProducts } from './shop-products.js';

const consentInput = z.strictObject({ state: z.string().regex(/^[a-f0-9]{64}$/),
  fixture: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/) });
const fixtureInput = z.strictObject({ externalNumberId: z.string().min(1).max(200), action: z.enum(['MISSING', 'RESTORE', 'EXPIRE']) });
@Controller('pc')
export class PcAuthController {
  constructor(private readonly authorization: PcAuthorization) {}
  @Post('auth/start')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async start(@Req() request: Request, @Res({ passthrough: true }) response: Response,
    @Body(new SchemaPipe(pcAuthStartInputSchema)) input: PcAuthStartInput) {
    return { data: await this.authorization.start(request, response, input) };
  }
  @Get('mock/authorize')
  async consent(@Req() request: Request, @Res() response: Response, @Query('state') state?: string) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    response.type('html').send(await this.authorization.consent(request, typeof state === 'string' ? state : ''));
  }
  @Post('mock/authorize')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async choose(@Req() request: Request, @Res() response: Response,
    @Body(new SchemaPipe(consentInput)) input: z.infer<typeof consentInput>) {
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(303, await this.authorization.choose(request, input.state, input.fixture));
  }
  @Get('auth/callback')
  async callback(@Req() request: Request, @Res() response: Response, @Query('state') state?: string, @Query('code') code?: string) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    await this.authorization.callback(request, response, typeof state === 'string' ? state : '', typeof code === 'string' ? code : '');
  }
}
@Controller('pc')
@UseGuards(SessionGuard)
export class PcController {
  constructor(private readonly connections: PcConnections, private readonly shopProducts: ShopProducts) {}
  @Get('shop')
  async shop(@Req() request: SessionRequest) { return { data: await this.shopProducts.own(request.user) }; }
  @Post('shop/products')
  async createShopProduct(@Req() request: SessionRequest, @Body(new SchemaPipe(shopProductInputSchema)) input: ShopProductInput) {
    return { data: await this.shopProducts.save(request.user, input) };
  }
  @Patch('shop/products/:id')
  async saveShopProduct(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(shopProductInputSchema)) input: ShopProductInput) {
    return { data: await this.shopProducts.save(request.user, input, id) };
  }
  @Get('session')
  async session(@Req() request: SessionRequest) { return { data: await this.connections.session(request.user) }; }
  @Patch('connection')
  async capabilities(@Req() request: SessionRequest,
    @Body(new SchemaPipe(pcConnectionInputSchema)) input: z.infer<typeof pcConnectionInputSchema>) {
    return { data: await this.connections.capabilities(request.user, input.enabledCapabilities) };
  }
  @Get('messages')
  messages(@Req() request: SessionRequest, @Query(new SchemaPipe(pcMessagesQuerySchema)) input: z.infer<typeof pcMessagesQuerySchema>) {
    return this.connections.messages(request.user, input);
  }
  @Post('messages/read')
  async read(@Req() request: SessionRequest, @Body(new SchemaPipe(pcReadInputSchema)) input: z.infer<typeof pcReadInputSchema>) {
    return { data: await this.connections.read(request.user, input.ids) };
  }
  @Post('wait')
  async wait(@Req() request: SessionRequest, @Body(new SchemaPipe(pcWaitInputSchema)) input: z.infer<typeof pcWaitInputSchema>) {
    return { data: await this.connections.wait(request.user, request.sessionToken, input) };
  }
  @Post('plans')
  async createPlan(@Req() request: SessionRequest, @Body(new SchemaPipe(pcPlanInputSchema)) input: PcPlanInput) {
    return { data: await this.connections.savePlan(request.user, input) };
  }
  @Patch('plans/:id')
  async savePlan(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(pcPlanInputSchema)) input: PcPlanInput) {
    return { data: await this.connections.savePlan(request.user, input, id) };
  }
  @Delete('plans/:id')
  async archivePlan(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string) {
    return { data: await this.connections.archivePlan(request.user, id) };
  }
}
@Controller('admin/pc/connections')
@UseGuards(SessionGuard, AdminGuard)
export class PcAdminController {
  constructor(private readonly connections: PcConnections) {}
  @Get()
  async list() { return { data: await this.connections.adminConnections() }; }
  @Post(':id/poll')
  async poll(@Param('id', new SchemaPipe(uuidSchema)) id: string) { return { data: await this.connections.requestPoll(id) }; }
  @Post(':id/mock-fixture')
  async fixture(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(fixtureInput)) input: z.infer<typeof fixtureInput>) {
    return { data: await this.connections.fixtureAction(request.user.id, id, input.externalNumberId, input.action) };
  }
}
