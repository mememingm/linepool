/**
 * main.ts 中文分区导读副本：后端启动与服务装配
 * 原文件：backend/src/main.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】把控制器和业务服务组装成应用，设置前缀、请求体、Cookie、跨域、错误处理和监听地址。
 * 【为什么这样组织】集中管理全局行为和服务实现的绑定，业务代码可以依赖统一能力而非某个具体供应商。
 * 【调用链】环境与数据库 → 注册服务 → 安装请求处理规则 → 连通检查 → 监听端口。
 * 【修改提示】全局限流 60 秒 120 次，具体接口可覆盖；普通 JSON 上限 16kb，两个批量入口 512kb。当前号码服务与接收供应商绑定模拟实现。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import { Authentication, SessionGuard } from '../../../../backend/src/authentication.js';
import { PasswordRecovery } from '../../../../backend/src/password-recovery.js';
import { AuthController, PasswordRecoveryController, HealthController, WorkspaceController, NumberServicesController } from '../../../../backend/src/controllers.js';
import { Database } from '../../../../backend/src/database.js';
import { Environment } from '../../../../backend/src/environment.js';
import { ApiErrorFilter, OriginGuard } from '../../../../backend/src/http.js';
import { Ordering } from '../../../../backend/src/ordering.js';
import { Workspace } from '../../../../backend/src/workspace.js';
import { AdminController } from '../../../../backend/src/admin-controller.js';
import { Administration, AdminGuard } from '../../../../backend/src/administration.js';
import { NumberServices } from '../../../../backend/src/number-services.js';
import { NumberServiceProvider, MockNumberServiceProvider } from '../../../../backend/src/number-service-provider.js';
import { ReceivingProvider } from '../../../../backend/src/providers/receiving-provider.js';
import { MockReceivingProvider } from '../../../../backend/src/providers/mock-receiving-provider.js';
import { ReceivingSync } from '../../../../backend/src/providers/receiving-sync.js';
import { AllocationExpiry } from '../../../../backend/src/allocation-expiry.js';
import { BusinessThrottlerGuard } from '../../../../backend/src/business-throttler.js';
import { Sandbox, SandboxController } from '../../../../backend/src/sandbox.js';
import { WebhookInbox } from '../../../../backend/src/providers/webhook-inbox.js';
import { UpstreamIntegration } from '../../../../backend/src/upstream-integration.js';
import { PingCodeWebhookController, type RawWebhookRequest } from '../../../../backend/src/providers/pingcode-webhook.js';
import { Recharge, RechargeController } from '../../../../backend/src/recharge.js';
import { AgentInventory } from '../../../../backend/src/agent-inventory.js';
import { AgentInventoryExpiry } from '../../../../backend/src/agent-inventory-expiry.js';
import { AgentInventoryController } from '../../../../backend/src/agent-inventory-controller.js';

/**
 * ==================== 01 后端启动与服务装配 / Application ====================
 * Application = 后端应用模块。controllers 注册入口，providers 注册业务服务；provide/useClass 决定某抽象能力由哪个实现提供。
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }])],
  controllers: [AuthController, PasswordRecoveryController, WorkspaceController, HealthController, AdminController, NumberServicesController, SandboxController, RechargeController, PingCodeWebhookController, AgentInventoryController],
  providers: [Environment, Database, Authentication, PasswordRecovery, SessionGuard, Workspace, Ordering, Administration, AdminGuard, NumberServices,
    AgentInventory, AgentInventoryExpiry, AllocationExpiry, ReceivingSync, Sandbox, Recharge, UpstreamIntegration, WebhookInbox, { provide: ReceivingProvider, useFactory: () => new MockReceivingProvider() },
    { provide: NumberServiceProvider, useClass: MockNumberServiceProvider },
    { provide: APP_GUARD, useClass: OriginGuard }, { provide: APP_GUARD, useClass: BusinessThrottlerGuard }],
})
class Application {}
/**
 * main = 启动后端。创建应用、读取配置、安装中间件/跨域/错误处理，确认数据库可连后监听配置的端口。
 */
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(Application, { bodyParser: false });
  const environment = app.get(Environment);
  if (environment.values.TRUSTED_PROXY_IPS.length) app.set('trust proxy', environment.values.TRUSTED_PROXY_IPS);
  // 统一前缀：控制器里写 orders，外部完整地址就是 /api/orders。修改这里需同步前端基础地址与代理。
  app.setGlobalPrefix('api');
  app.use(helmet());
  // Explicit selections of 10,000 UUIDs need ~400 KB; keep other endpoints at their original limit.
  app.use(['/api/agent-inventory/holdings/batch-preview', '/api/agent-inventory/holdings/batch-transfer'], json({ limit: '512kb' }));
  app.use(json({ limit: '16kb', verify: (request, _response, body) => {
    if (request.url?.split('?')[0]?.replace(/\/+$/, '') === '/api/webhooks/pingcode') {
      (request as RawWebhookRequest).rawBody = Buffer.from(body);
    }
  } }));
  app.use(cookieParser());
  app.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  // 允许配置的网页来源携带 Cookie 调用接口。写请求还经过 OriginGuard；跨域配置和权限检查分别起作用。
  app.enableCors({
    origin: environment.values.WEB_ORIGIN, credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type'],
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  await app.get(Database).query('SELECT 1');
  await app.listen(environment.values.API_PORT, environment.values.API_HOST);
  console.log(`LINEPOOL demo API: http://${environment.values.API_HOST}:${environment.values.API_PORT}/api`);
}
main().catch(error => {
  console.error('API startup failed', error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
