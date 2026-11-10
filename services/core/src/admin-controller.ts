import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { uuidSchema, serviceSchema, adminRechargeQuerySchema, rechargeSettingsInputSchema,
  platformCodeRuleInputSchema, receivingReviewInputSchema, type PlatformCodeRuleInput, type ReceivingReviewInput,
  type AdminRechargeQuery, type RechargeSettingsInput } from '@linepool/contracts';
import { adminPasswordResetInputSchema, type AdminPasswordResetInput, adminQuerySchema, numberActionInputSchema, productInputSchema, userStatusInputSchema,
  adminWebhookRetryInputSchema, type AdminWebhookRetryInput, productSyncInputSchema, type ProductSyncInput, platformInputSchema, type PlatformInput, officialShopInputSchema, type OfficialShopInput, shopProductHoldInputSchema, type ShopProductHoldInput,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import { SessionGuard, type SessionRequest } from './authentication.js';
import { SchemaPipe } from './http.js';
import { Administration, AdminGuard, type AdminSection } from './administration.js';
import { Recharge } from './recharge.js';
import { UpstreamIntegration } from './upstream-integration.js';
import { WebhookInbox } from './providers/webhook-inbox.js';
import { LinePoolReceiving } from './linepool-receiving.js';

const sectionSchema = z.enum(['users', 'numbers', 'products', 'orders', 'audit', 'projects', 'receipts']);
const detailSectionSchema = z.enum(['users', 'numbers', 'orders']);
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: Administration, private readonly recharge: Recharge,
    private readonly integration: UpstreamIntegration, private readonly inbox: WebhookInbox, private readonly receiving: LinePoolReceiving) {}
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
  @Get('platforms/:platformId/code-rule')
  async codeRule(@Param('platformId', new SchemaPipe(serviceSchema)) platformId: string) {
    return { data: await this.receiving.rule(platformId) };
  }
  @Put('platforms/:platformId/code-rule')
  async saveCodeRule(@Req() req: SessionRequest, @Param('platformId', new SchemaPipe(serviceSchema)) platformId: string,
    @Body(new SchemaPipe(platformCodeRuleInputSchema)) input: PlatformCodeRuleInput) {
    return { data: await this.receiving.saveRule(req.user.id, platformId, input) };
  }
  @Get('allocations/:allocationId/receiving-review')
  async receivingReview(@Req() req: SessionRequest, @Param('allocationId', new SchemaPipe(uuidSchema)) allocationId: string) {
    return { data: await this.receiving.reviewView(req.user.id, allocationId) };
  }
  @Post('allocations/:allocationId/receiving-review')
  async confirmReceivingReview(@Req() req: SessionRequest, @Param('allocationId', new SchemaPipe(uuidSchema)) allocationId: string,
    @Body(new SchemaPipe(receivingReviewInputSchema)) input: ReceivingReviewInput) {
    const view = await this.receiving.reviewView(req.user.id, allocationId);
    for (const event of view.localEvents) if (['PENDING','UNMATCHED','FAILED'].includes(event.status)) await this.inbox.routeEvent(event.id);
    return { data: await this.receiving.review(req.user.id, allocationId, input) };
  }
  // Declared before ':section' so these literal paths are not captured by the generic list route.
  @Get('platforms')
  async platforms() { return { data: await this.admin.platforms() }; }
  @Get('shop-products')
  async shopProducts() { return { data: await this.admin.shopProducts() }; }
  @Post('shop-products/:id/hold')
  async holdShopProduct(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(shopProductHoldInputSchema)) input: ShopProductHoldInput) {
    return { data: await this.admin.holdShopProduct(req.user.id, id, input) };
  }
  @Get('shops')
  async shops() { return { data: await this.admin.shops() }; }
  @Post('shops/official')
  async setOfficialShop(@Req() req: SessionRequest, @Body(new SchemaPipe(officialShopInputSchema)) input: OfficialShopInput) {
    return { data: await this.admin.setOfficialShop(req.user.id, input) };
  }
  @Post('platforms')
  async createPlatform(@Req() req: SessionRequest, @Body(new SchemaPipe(platformInputSchema)) input: PlatformInput) {
    return { data: await this.admin.savePlatform(req.user.id, input, true) };
  }
  @Patch('platforms')
  async updatePlatform(@Req() req: SessionRequest, @Body(new SchemaPipe(platformInputSchema)) input: PlatformInput) {
    return { data: await this.admin.savePlatform(req.user.id, input, false) };
  }
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
