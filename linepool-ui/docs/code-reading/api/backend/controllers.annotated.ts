/**
 * controllers.ts 中文分区导读副本：普通用户接口入口
 * 原文件：backend/src/controllers.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】按网址和 HTTP 方法接收登录、账户、目录、订单、号码和短信等请求。
 * 【为什么这样组织】入口只负责路由、权限和输入整理，具体业务交给对应服务。
 * 【调用链】/api 前缀来自 main.ts → 装饰器路由 → SchemaPipe / SessionGuard → 服务方法。
 * 【修改提示】修改地址需同步 client.ts；修改入参需同步共享 schema；@Throttle 的 ttl 为毫秒。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  forgotPasswordInputSchema, resetPasswordInputSchema, type ForgotPasswordInput, type ResetPasswordInput,
  accountProfileInputSchema, createOrderInputSchema, inboxQuerySchema, listQuerySchema, loginInputSchema, markReadInputSchema,
  createRenewalInputSchema, paginationQuerySchema, usageQuerySchema,
  numbersQuerySchema, pointsQuerySchema, preferencesInputSchema, registerInputSchema, uuidSchema,
  type CreateOrderInput, type InboxQuery, type ListQuery, type LoginInput, type NumbersQuery,
  type AccountProfileInput, type PointsQuery, type RegisterInput, type CreateRenewalInput, type PaginationQuery, type UsageQuery,
} from '@linepool/contracts';
import { Authentication, SessionGuard, type SessionRequest } from '../../../../backend/src/authentication.js';
import { SchemaPipe } from '../../../../backend/src/http.js';
import { Database } from '../../../../backend/src/database.js';
import { Ordering } from '../../../../backend/src/ordering.js';
import { Workspace } from '../../../../backend/src/workspace.js';
import { NumberServices } from '../../../../backend/src/number-services.js';
import { PasswordRecovery } from '../../../../backend/src/password-recovery.js';

/**
 * ==================== 01 普通用户接口入口 / AuthController ====================
 * AuthController = 认证接口入口。处理登录、注册、读取当前用户与退出登录，调用 Authentication 完成会话操作。
 */
@Controller('auth')
export class AuthController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly auth: Authentication) {}
  /**
   * login = 登录。检查登录输入并交给认证服务；身份和会话由后端确认。
   * 接口：POST /api/auth/login。接收：请求体(input)、响应/Cookie(response)。
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body(new SchemaPipe(loginInputSchema)) input: LoginInput, @Res({ passthrough: true }) response: Response) {
    return { data: await this.auth.login(input, response) };
  }
  /**
   * register = 注册。建立用户并签发会话；重复邮箱会返回冲突。
   * 接口：POST /api/auth/register。接收：请求体(input)、响应/Cookie(response)。
   */
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async register(@Body(new SchemaPipe(registerInputSchema)) input: RegisterInput, @Res({ passthrough: true }) response: Response) {
    return { data: await this.auth.register(input, response) };
  }
  /**
   * me = 读取当前会话用户，并更新兼容旧路径的会话 Cookie。
   * 接口：GET /api/auth/me。接收：登录用户与请求信息(request)、响应/Cookie(response)。
   */
  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() request: SessionRequest, @Res({ passthrough: true }) response: Response) {
    // Existing API-only sessions migrate during the shared login page's session check.
    this.auth.setSessionCookie(request.sessionToken, request.sessionExpiresAt, response);
    return { data: request.user };
  }
  /**
   * logout = 退出登录。删除会话并清除 Cookie，随后请求需要重新登录。
   * 接口：POST /api/auth/logout。接收：登录用户与请求信息(request)、响应/Cookie(response)。
   */
  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(@Req() request: SessionRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request, response);
    return { data: { loggedOut: true } };
  }
}
/**
 * ==================== 02 普通用户接口入口 / PasswordRecoveryController ====================
 * PasswordRecoveryController = 密码找回接口入口。处理申请重置邮件与提交一次性令牌重置密码。
 */
@Controller('auth')
export class PasswordRecoveryController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly recovery: PasswordRecovery) {}
  /**
   * forgotPassword = 受理找回密码请求。检查邮箱格式后交给密码找回服务；受理不保证邮件已经送达。
   * 接口：POST /api/auth/forgot-password。接收：请求体(input)。
   */
  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgotPassword(@Body(new SchemaPipe(forgotPasswordInputSchema)) input: ForgotPasswordInput) {
    return { data: await this.recovery.request(input) };
  }
  /**
   * resetPassword = 重置密码。核验一次性令牌或管理员身份后执行；具体权限与会话失效看所调用业务。
   * 接口：POST /api/auth/reset-password。接收：请求体(input)。
   */
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body(new SchemaPipe(resetPasswordInputSchema)) input: ResetPasswordInput) {
    return { data: await this.recovery.reset(input) };
  }
}
/**
 * ==================== 03 普通用户接口入口 / WorkspaceController ====================
 * WorkspaceController = 普通工作台入口。类上的 SessionGuard 要求先登录，方法再把当前用户编号传给查询、下单或账户业务。
 */
@Controller()
@UseGuards(SessionGuard)
export class WorkspaceController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly workspace: Workspace, private readonly ordering: Ordering, private readonly auth: Authentication) {}
  /**
   * catalog = 查询购买目录。返回可售国家、平台、商品及库存。
   * 接口：GET /api/catalog。
   */
  @Get('catalog')
  async catalog() { return { data: await this.workspace.catalog() }; }
  /**
   * dashboard = 查询当前身份的首页汇总。统计范围由用户/代理归属和 period 决定。
   * 接口：GET /api/dashboard。接收：登录用户与请求信息(request)。
   */
  @Get('dashboard')
  async dashboard(@Req() request: SessionRequest) { return { data: await this.workspace.dashboard(request.user.id) }; }
  /**
   * overview = 读取概览资料。把页面初始化需要的概要数据集中返回。
   * 接口：GET /api/dashboard/overview。接收：登录用户与请求信息(request)。
   */
  @Get('dashboard/overview')
  async overview(@Req() request: SessionRequest) { return { data: await this.workspace.dashboardOverview(request.user.id) }; }
  /**
   * numbers = 查询当前用户的号码列表，使用查询规则和分页。
   * 接口：GET /api/numbers。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('numbers')
  numbers(@Req() request: SessionRequest, @Query(new SchemaPipe(numbersQuerySchema)) input: NumbersQuery) {
    return this.workspace.numbers(request.user.id, input);
  }
  /**
   * orders = 查询当前用户的订单列表，限定用户归属并分页。
   * 接口：GET /api/orders。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('orders')
  orders(@Req() request: SessionRequest, @Query(new SchemaPipe(listQuerySchema)) input: ListQuery) {
    return this.workspace.orders(request.user.id, input);
  }
  /**
   * order = 查询当前用户的一笔订单详情；路径 id 是订单编号。
   * 接口：GET /api/orders/:id。接收：登录用户与请求信息(request)、路径参数(id)。
   */
  @Get('orders/:id')
  async order(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string) {
    return { data: await this.workspace.orderDetail(request.user.id, id) };
  }
  /**
   * createOrder = 创建业务订单。格式检查后交给业务层，价格、权限、余额和库存由后端核对。
   * 接口：POST /api/orders。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('orders')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async createOrder(@Req() request: SessionRequest, @Body(new SchemaPipe(createOrderInputSchema)) input: CreateOrderInput) {
    return { data: await this.ordering.create(request.user.id, input) };
  }
  /**
   * inbox = 查询当前用户短信收件箱，支持号码、状态和搜索筛选。
   * 接口：GET /api/inbox。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('inbox')
  inbox(@Req() request: SessionRequest, @Query(new SchemaPipe(inboxQuerySchema)) input: InboxQuery) {
    return this.workspace.inbox(request.user.id, input);
  }
  /**
   * markRead = 批量标记短信已读。业务层核对所有消息归属，不能只凭前端传入的编号更新。
   * 接口：POST /api/inbox/read。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Post('inbox/read')
  async markRead(@Req() request: SessionRequest, @Body(new SchemaPipe(markReadInputSchema)) input: z.infer<typeof markReadInputSchema>) {
    return { data: await this.workspace.markRead(request.user.id, input.ids) };
  }
  /**
   * points = 查询商城积分余额和流水；收入/支出筛选不改变总余额。
   * 接口：GET /api/points。接收：登录用户与请求信息(request)、地址查询参数(input)。
   */
  @Get('points')
  points(@Req() request: SessionRequest, @Query(new SchemaPipe(pointsQuerySchema)) input: PointsQuery) {
    return this.workspace.points(request.user.id, input);
  }
  /**
   * account = 读取当前用户账户资料和偏好。
   * 接口：GET /api/account。接收：登录用户与请求信息(request)。
   */
  @Get('account')
  async account(@Req() request: SessionRequest) { return { data: { ...await this.workspace.account(request.user.id), sandboxEnabled: this.auth.sandboxEnabled } }; }
  /**
   * profile = 修改账户资料。按 field 区分修改类型，敏感修改在业务层校验当前密码。
   * 接口：PATCH /api/account/profile。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Patch('account/profile')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async profile(@Req() request: SessionRequest, @Body(new SchemaPipe(accountProfileInputSchema)) input: AccountProfileInput) {
    return { data: await this.auth.updateProfile(request.user.id, request.sessionToken, input) };
  }
  /**
   * preferences = 修改到期提醒偏好，返回保存后的开关值。
   * 接口：PATCH /api/account/preferences。接收：登录用户与请求信息(request)、请求体(input)。
   */
  @Patch('account/preferences')
  async preferences(@Req() request: SessionRequest, @Body(new SchemaPipe(preferencesInputSchema)) input: z.infer<typeof preferencesInputSchema>) {
    return { data: await this.workspace.preferences(request.user.id, input.expiryNotice) };
  }
}
/**
 * ==================== 04 普通用户接口入口 / NumberServicesController ====================
 * NumberServicesController = 号码服务入口。按路径中的号码/分配编号查询用量和续期历史；选项与提交续期当前由业务层禁用。
 */
@Controller('numbers/:id')
@UseGuards(SessionGuard)
export class NumberServicesController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly numbers: NumberServices) {}
  /**
   * options = 读取可选项。具体来源和功能是否开放由对应业务方法决定。
   * 接口：GET /api/numbers/:id/renewal-options。接收：登录用户与请求信息(request)、路径参数(id)。
   */
  @Get('renewal-options')
  async options(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string) {
    return { data: await this.numbers.options(request.user.id, id) };
  }
  /**
   * records = 分页读取记录。筛选和可见范围交给业务服务处理。
   * 接口：GET /api/numbers/:id/renewals。接收：登录用户与请求信息(request)、路径参数(id)、地址查询参数(input)。
   */
  @Get('renewals')
  records(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(paginationQuerySchema)) input: PaginationQuery) {
    return this.numbers.list(request.user.id, id, input);
  }
  /**
   * create = 提交创建操作。先检查输入和归属，再进入对应业务；不表示供应商执行已经成功。
   * 接口：POST /api/numbers/:id/renewals。接收：登录用户与请求信息(request)、路径参数(id)、请求体(input)。
   */
  @Post('renewals')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async create(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Body(new SchemaPipe(createRenewalInputSchema)) input: CreateRenewalInput) {
    return { data: await this.numbers.create(request.user.id, id, input) };
  }
  /**
   * usage = 读取号码用量。需要核对号码归属，当前服务绑定返回模拟数据。
   * 接口：GET /api/numbers/:id/usage。接收：登录用户与请求信息(request)、路径参数(id)、地址查询参数(input)。
   */
  @Get('usage')
  async usage(@Req() request: SessionRequest, @Param('id', new SchemaPipe(uuidSchema)) id: string,
    @Query(new SchemaPipe(usageQuerySchema)) input: UsageQuery) {
    return { data: await this.numbers.usage(request.user.id, id, input) };
  }
}
/**
 * ==================== 05 普通用户接口入口 / HealthController ====================
 * HealthController = 服务健康检查入口。此入口查询数据库是否能响应，不返回用户业务数据。
 */
@Controller('health')
export class HealthController {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(private readonly db: Database) {}
  /**
   * health = 健康检查。执行 SELECT 1 验证数据库连接，成功后返回 API 和数据库状态。
   * 接口：GET /api/health。
   */
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { data: { status: 'ok', database: 'ok', mode: 'demo' } };
  }
}
