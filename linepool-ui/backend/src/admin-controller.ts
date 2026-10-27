import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { uuidSchema, adminRechargeQuerySchema, rechargeSettingsInputSchema,
  type AdminRechargeQuery, type RechargeSettingsInput } from '@linepool/contracts';
import { adminPasswordResetInputSchema, type AdminPasswordResetInput, adminQuerySchema, numberActionInputSchema, productInputSchema, userStatusInputSchema,
  adminWebhookRetryInputSchema, type AdminWebhookRetryInput, productSyncInputSchema, type ProductSyncInput,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { SchemaPipe } from './http.js';
import { Administration, AdminGuard, type AdminSection } from './administration.js';
import { Recharge } from './recharge.js';
import { UpstreamIntegration } from './upstream-integration.js';
import { WebhookInbox } from './providers/webhook-inbox.js';

const sectionSchema = z.enum(['users', 'numbers', 'products', 'orders', 'audit', 'projects', 'receipts']);
const detailSectionSchema = z.enum(['users', 'numbers', 'orders']);
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: Administration, private readonly recharge: Recharge,
    private readonly integration: UpstreamIntegration, private readonly inbox: WebhookInbox) {}
  @Get('session')
  session(@Req() request: SessionRequest) { return { data: request.user }; }
  @Get('summary')
  async summary() { return { data: await this.admin.summary() }; }
  @Get('integrations/pingcode')
  async integrationStatus() { return { data: await this.integration.status() }; }
  @Post('integrations/pingcode/retry')
  async retryWebhook(@Req() req: SessionRequest,
    @Body(new SchemaPipe(adminWebhookRetryInputSchema)) input: AdminWebhookRetryInput) {
    return { data: await this.inbox.route(input.messageId, { actorId: req.user.id, reason: input.reason }) };
  }
  @Get('recharge-settings')
  async rechargeSettings() { return { data: await this.recharge.settings() }; }
  @Patch('recharge-settings')
  async saveRechargeSettings(@Req() req: SessionRequest, @Body(new SchemaPipe(rechargeSettingsInputSchema)) input: RechargeSettingsInput) {
    return { data: await this.recharge.saveSettings(req.user.id, input) };
  }
  @Get('recharges')
  recharges(@Query(new SchemaPipe(adminRechargeQuerySchema)) input: AdminRechargeQuery) {
    return this.recharge.records(input, input.userId, true);
  }
  // Declared before ':section' so these literal paths are not captured by the generic list route.
  @Get('product-options')
  async productOptions() { return { data: await this.admin.productOptions() }; }
  @Post('products/sync')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async syncProducts(@Req() req: SessionRequest, @Body(new SchemaPipe(productSyncInputSchema)) input: ProductSyncInput) {
    return { data: await this.admin.syncProducts(req.user.id, input.reason) };
  }
  @Get(':section')
  list(@Param('section', new SchemaPipe(sectionSchema)) section: AdminSection,
    @Query(new SchemaPipe(adminQuerySchema)) input: AdminQuery) { return this.admin.list(section, input); }
  @Get(':section/:id')
  async detail(@Param('section', new SchemaPipe(detailSectionSchema)) section: 'users' | 'numbers' | 'orders',
    @Param('id', new SchemaPipe(uuidSchema)) id: string) { return { data: await this.admin.detail(section, id) }; }
  @Post('users/:id/reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(adminPasswordResetInputSchema)) input: AdminPasswordResetInput) {
    return { data: await this.admin.resetPassword(req.user.id, id, input) };
  }
  @Patch('users/:id/status')
  async userStatus(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(userStatusInputSchema)) input: UserStatusInput) {
    return { data: await this.admin.userStatus(req.user.id, id, input) };
  }
  @Post('numbers/:id/actions')
  async numberAction(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(numberActionInputSchema)) input: NumberActionInput) {
    return { data: await this.admin.numberAction(req.user.id, id, input) };
  }
  @Post('products')
  async createProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, true) };
  }
  @Patch('products')
  async updateProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, false) };
  }
}
