/**
 * business-throttler.ts 中文分区导读副本：业务请求限流身份
 * 原文件：backend/src/business-throttler.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】为限流器选择计数身份：有效登录用户按账户，公共认证入口按客户端 IP。
 * 【为什么这样组织】同一用户多处发请求应计入同一身份；公开登录入口不能通过更换 Cookie 绕开 IP 计数。
 * 【调用链】全局 APP_GUARD → getTracker → 节流器；阈值来自 main.ts 或 @Throttle。
 * 【修改提示】修改频率看 main.ts 与各控制器；可信代理设置决定哪些客户端 IP 信息可信。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard,
  type ThrottlerModuleOptions, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { Authentication } from '../../../../backend/src/authentication.js';

/**
 * ==================== 01 业务请求限流身份 / BusinessThrottlerGuard ====================
 * BusinessThrottlerGuard = 业务请求限流身份。为限流器选择计数身份：有效登录用户按账户，公共认证入口按客户端 IP。
 */
@Injectable()
export class BusinessThrottlerGuard extends ThrottlerGuard {
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor(@InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage, reflector: Reflector,
    private readonly auth: Authentication) { super(options, storage, reflector); }
  /**
   * getTracker = 选择限流计数身份。公共认证请求按 IP，其他有效登录请求优先按账户。
   */
  protected override async getTracker(request: Request): Promise<string> {
    // Public authentication endpoints always use the verified client IP, even with a valid cookie.
    if (!/^\/api\/auth\/(?:login|register|forgot-password|reset-password)\/*$/i.test(request.route?.path ?? request.path)) {
      const session = await this.auth.getSession(request);
      if (session) return `account:${session.user.id}`;
    }
    return super.getTracker(request);
  }
}
