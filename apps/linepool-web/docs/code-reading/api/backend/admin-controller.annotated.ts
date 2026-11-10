/**
 * admin-controller.ts 中文分区导读副本：管理后台接口入口
 * 原文件：backend/src/admin-controller.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】接收后台统计、列表、详情、用户管理、号码操作、商品和充值设置请求。
 * 【为什么这样组织】SessionGuard 先检查登录，AdminGuard 再检查管理员身份；具体操作交给管理业务。
 * 【调用链】client.ts 的 admin 方法 → /api/admin → Administration / Recharge / WebhookInbox。
 * 【修改提示】新增固定路径要留意 :section 通用路由的顺序；操作理由、输入规则和审计字段应对应。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import { uuidSchema, adminRechargeQuerySchema, rechargeSettingsInputSchema,
  type AdminRechargeQuery, type RechargeSettingsInput } from '@linepool/contracts';
import { adminPasswordResetInputSchema, type AdminPasswordResetInput, adminQuerySchema, numberActionInputSchema, productInputSchema, userStatusInputSchema,
  adminWebhookRetryInputSchema, type AdminWebhookRetryInput, productSyncInputSchema, type ProductSyncInput,
  type AdminQuery, type NumberActionInput, type ProductInput, type UserStatusInput } from '@linepool/contracts/admin';
import { SessionGuard, type SessionRequest } from '../../../../backend/src/authentication.js';
import { SchemaPipe } from '../../../../backend/src/http.js';
import { Administration, AdminGuard, type AdminSection } from '../../../../backend/src/administration.js';
import { Recharge } from '../../../../backend/src/recharge.js';
import { UpstreamIntegration } from '../../../../backend/src/upstream-integration.js';
import { WebhookInbox } from '../../../../backend/src/providers/webhook-inbox.js';

/**
 * sectionSchema = 后台列表板块规则。只有 users/numbers/products/orders/audit/projects/receipts 可以进入通用列表入口。
 */
const sectionSchema = z.enum(['users', 'numbers', 'products', 'orders', 'audit', 'projects', 'receipts']);
/**
 * detailSectionSchema = 后台详情板块规则。通用详情入口只处理用户、号码和订单。
 */
const detailSectionSchema = z.enum(['users', 'numbers', 'orders']);
/**
 * ==================== 01 管理后台接口入口 / AdminController ====================
 * AdminController = 管理后台接口入口。接收后台统计、列表、详情、用户管理、号码操作、商品和充值设置请求。
 */
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly admin: Administration, private readonly recharge: Recharge,
    private readonly integration: UpstreamIntegration, private readonly inbox: WebhookInbox) {}
  /**
   * session = 读取后台会话。类上的守卫已要求登录且具备管理员身份。
   * 接口：GET /api/admin/session。接收：登录用户与请求信息(request)。
   */
  @Get('session')
  session(@Req() request: SessionRequest) { return { data: request.user }; }
  /**
   * summary = 读取后台首页汇总，具体统计 SQL 位于 Administration.summary。
   * 接口：GET /api/admin/summary。
   */
  @Get('summary')
  async summary() { return { data: await this.admin.summary() }; }
  /**
   * integrationStatus = 读取上游接入状态与回调统计，当前传输模式仍标记 mock。
   * 接口：GET /api/admin/integrations/pingcode。
   */
  @Get('integrations/pingcode')
  async integrationStatus() { return { data: await this.integration.status() }; }
  /**
   * retryWebhook = 管理员手动重试一条回执。messageId 定位消息，actorId/reason 记录操作人和理由。
   * 接口：POST /api/admin/integrations/pingcode/retry。接收：登录用户与请求信息(req)、请求体(input)。
   */
  @Post('integrations/pingcode/retry')
  async retryWebhook(@Req() req: SessionRequest,
    @Body(new SchemaPipe(adminWebhookRetryInputSchema)) input: AdminWebhookRetryInput) {
    return { data: await this.inbox.route(input.messageId, { actorId: req.user.id, reason: input.reason }) };
  }
  /**
   * rechargeSettings = 查询充值规则配置与版本。
   * 接口：GET /api/admin/recharge-settings。
   */
  @Get('recharge-settings')
  async rechargeSettings() { return { data: await this.recharge.settings() }; }
  /**
   * saveRechargeSettings = 保存充值规则。版本不匹配会拒绝覆盖，并记录修改理由。
   * 接口：PATCH /api/admin/recharge-settings。接收：登录用户与请求信息(req)、请求体(input)。
   */
  @Patch('recharge-settings')
  async saveRechargeSettings(@Req() req: SessionRequest, @Body(new SchemaPipe(rechargeSettingsInputSchema)) input: RechargeSettingsInput) {
    return { data: await this.recharge.saveSettings(req.user.id, input) };
  }
  /**
   * recharges = 管理员查询充值记录，可按用户、状态和搜索词筛选。
   * 接口：GET /api/admin/recharges。接收：地址查询参数(input)。
   */
  @Get('recharges')
  recharges(@Query(new SchemaPipe(adminRechargeQuerySchema)) input: AdminRechargeQuery) {
    return this.recharge.records(input, input.userId, true);
  }
  // Declared before ':section' so these literal paths are not captured by the generic list route.
  /**
   * productOptions = 查询上游资源已有的国家与平台组合，供创建商品选择。
   * 接口：GET /api/admin/product-options。
   */
  @Get('product-options')
  async productOptions() { return { data: await this.admin.productOptions() }; }
  /**
   * syncProducts = 按已有上游组合补建缺少的商品草稿，随后由管理员设价和上架。
   * 接口：POST /api/admin/products/sync。接收：登录用户与请求信息(req)、请求体(input)。
   */
  @Post('products/sync')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async syncProducts(@Req() req: SessionRequest, @Body(new SchemaPipe(productSyncInputSchema)) input: ProductSyncInput) {
    return { data: await this.admin.syncProducts(req.user.id, input.reason) };
  }
  /**
   * list = 按条件查询列表并分页。具体数据来源、权限和映射见本方法调用的业务。
   * 接口：GET /api/admin/:section。接收：路径参数(section)、地址查询参数(input)。
   */
  @Get(':section')
  list(@Param('section', new SchemaPipe(sectionSchema)) section: AdminSection,
    @Query(new SchemaPipe(adminQuerySchema)) input: AdminQuery) { return this.admin.list(section, input); }
  /**
   * detail = 按后台板块和编号读取用户、号码或订单详情。
   * 接口：GET /api/admin/:section/:id。接收：路径参数(section)、路径参数(id)。
   */
  @Get(':section/:id')
  async detail(@Param('section', new SchemaPipe(detailSectionSchema)) section: 'users' | 'numbers' | 'orders',
    @Param('id', new SchemaPipe(uuidSchema)) id: string) { return { data: await this.admin.detail(section, id) }; }
  /**
   * resetPassword = 重置密码。核验一次性令牌或管理员身份后执行；具体权限与会话失效看所调用业务。
   * 接口：POST /api/admin/users/:id/reset-password。接收：登录用户与请求信息(req)、路径参数(id)、请求体(input)。
   */
  @Post('users/:id/reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(adminPasswordResetInputSchema)) input: AdminPasswordResetInput) {
    return { data: await this.admin.resetPassword(req.user.id, id, input) };
  }
  /**
   * userStatus = 修改用户启用状态；禁用时会话和找回令牌的处理见业务层。
   * 接口：PATCH /api/admin/users/:id/status。接收：登录用户与请求信息(req)、路径参数(id)、请求体(input)。
   */
  @Patch('users/:id/status')
  async userStatus(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(userStatusInputSchema)) input: UserStatusInput) {
    return { data: await this.admin.userStatus(req.user.id, id, input) };
  }
  /**
   * numberAction = 执行管理员号码动作。assign 分配、reclaim 回收、sale 设置可售，所需字段不同。
   * 接口：POST /api/admin/numbers/:id/actions。接收：登录用户与请求信息(req)、路径参数(id)、请求体(input)。
   */
  @Post('numbers/:id/actions')
  async numberAction(@Req() req: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(numberActionInputSchema)) input: NumberActionInput) {
    return { data: await this.admin.numberAction(req.user.id, id, input) };
  }
  /**
   * createProduct = 新建商品。输入通过规则后，业务检查上游是否提供对应资源。
   * 接口：POST /api/admin/products。接收：登录用户与请求信息(req)、请求体(input)。
   */
  @Post('products')
  async createProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, true) };
  }
  /**
   * updateProduct = 编辑已有商品。字段变更与审计由 Administration.saveProduct 完成。
   * 接口：PATCH /api/admin/products。接收：登录用户与请求信息(req)、请求体(input)。
   */
  @Patch('products')
  async updateProduct(@Req() req: SessionRequest, @Body(new SchemaPipe(productInputSchema)) input: ProductInput) {
    return { data: await this.admin.saveProduct(req.user.id, input, false) };
  }
}
