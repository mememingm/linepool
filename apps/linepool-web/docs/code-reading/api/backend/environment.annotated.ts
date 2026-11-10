/**
 * environment.ts 中文分区导读副本：后端环境配置检查
 * 原文件：backend/src/environment.ts
 * 整理日期：2026-11-02
 * 【语言】TypeScript（TS）。SQL 字符串交给 PostgreSQL；出现的 @ 装饰器用于 NestJS 路由/服务注册。
 * 【整体用途】把环境变量中的文字转换成后端可用的配置，并检查端口、地址、会话、邮件和本地沙盒等条件。
 * 【为什么这样组织】启动时尽早发现缺配置或配置冲突；默认值只在没有提供环境变量时使用。
 * 【调用链】process.env → schema.parse → Environment.values → 各业务服务。
 * 【修改提示】API_PORT 默认 3010、SESSION_TTL_HOURS 默认 24；实际 .env 显式值优先。修改配置后重启进程；不要在阅读资料中写入真实密钥。
 * 【怎么读】先看文件用途，再按中文板块定位方法；无需逐个记语法。schema 是数据检查规则，Input 是提交数据。
 * Controller 是接口入口，Service/业务类处理操作，Provider 是能力提供方；英文名字旁补中文说明。
 * 【副本边界】保留完整代码及声明顺序，仅加注释并调整相对导入到原文件；不会由应用加载。
 * 真正修改业务请进入“原文件”路径；不要执行本副本或把它导入应用。示例和默认值不代表实际环境配置。
 * 总目录和阅读顺序：docs/code-reading/api/README.md；常见改值：docs/code-reading/api-guide.md 第 10 节。
 */

// ==================== 00 导入依赖 / 共享规则 ====================
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { rechargeRulesSchema } from '@linepool/contracts';
import { validateTestDatabase, validateTestSchema } from '../../../../backend/src/test-database.js';

/**
 * schema = 环境变量检查规则。把端口/时长转成数字、true/false 文字转开关，并为缺省值提供默认配置。
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOCAL_SANDBOX: z.enum(['true','false']).default('false').transform(value => value === 'true'),
  API_HOST: z.string().default('127.0.0.1'),
  // Exact proxy IPs only; no blanket trust or attacker-controlled forwarding chain.
  TRUSTED_PROXY_IPS: z.string().default('').transform(value => value.split(',').map(ip => ip.trim()).filter(Boolean))
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()]))),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  DATABASE_URL: z.string().url().refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  DEMO_EMAIL: z.string().trim().toLowerCase().email().optional(),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5178').refine(value => new URL(value).origin === value),
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.union([z.literal(''), z.string().email()]).default(''),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  PINGCODE_WEBHOOK_SECRET: z.string().default('').refine(value => value === ''
    || (Buffer.byteLength(value, 'utf8') >= 32 && Buffer.byteLength(value, 'utf8') <= 512),
  'PINGCODE_WEBHOOK_SECRET must be empty (disabled) or contain 32..512 bytes'),
  // Optional display/validation configuration only; it never enables a payment provider.
  RECHARGE_RULES: z.string().optional().transform((value, context) => {
    if (!value?.trim()) return null;
    try { return rechargeRulesSchema.parse(JSON.parse(value)); }
    catch { context.addIssue({ code: 'custom', message: 'RECHARGE_RULES must be a valid recharge rules JSON object' }); return z.NEVER; }
  }),
});
/**
 * ==================== 01 后端环境配置检查 / Environment ====================
 * Environment = 后端环境配置检查。把环境变量中的文字转换成后端可用的配置，并检查端口、地址、会话、邮件和本地沙盒等条件。
 */
@Injectable()
export class Environment {
  readonly values = schema.parse(process.env.NODE_ENV === 'test'
    ? { ...process.env, DATABASE_URL: validateTestDatabase(process.env).connectionString }
    : process.env);
  readonly testSchema = this.values.NODE_ENV === 'test' ? validateTestSchema(process.env.TEST_DATABASE_SCHEMA) : undefined;
  readonly sessionMaxAge = this.values.SESSION_TTL_HOURS * 3600000;
  /**
   * constructor = 构造方法。创建实例时接收所需参数；后端服务通常由 NestJS 按注册提供数据库或其他依赖。
   */
  constructor() {
    if (Boolean(this.values.SMTP_USER) !== Boolean(this.values.SMTP_PASSWORD)) {
      throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
    }
    if (this.values.LOCAL_SANDBOX) {
      const database = new URL(this.values.DATABASE_URL);
      if (this.values.NODE_ENV === 'production' || this.values.API_HOST !== '127.0.0.1'
        || !['127.0.0.1','localhost'].includes(database.hostname) || !/_(sandbox|test)$/.test(database.pathname)
        || new URL(this.values.WEB_ORIGIN).hostname !== '127.0.0.1') throw new Error('Sandbox requires an explicit isolated local database and loopback services');
    }
    if (this.values.NODE_ENV === 'production' && !this.values.WEB_ORIGIN.startsWith('https://')) {
      throw new Error('Production WEB_ORIGIN must use HTTPS');
    }
  }
}
