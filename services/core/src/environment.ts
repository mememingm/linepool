import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { rechargeRulesSchema } from '@linepool/contracts';
import { validateTestDatabase, validateTestSchema } from './test-database.js';

export type SiteId = 'linepool' | 'once';
export type SiteProduct = 'SMS_CODE' | 'NUMBER_LEASE';
const productSchema = z.enum(['SMS_CODE', 'NUMBER_LEASE']);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SITE_ID: z.enum(['linepool', 'once']).default('linepool'),
  PRODUCT: productSchema.optional(),
  PROCESS_ROLE: z.enum(['api', 'worker']).default('api'),
  ENABLED_MODULES: z.string().transform(value => value.split(',').map(module => module.trim()).filter(Boolean))
    .pipe(z.array(productSchema).max(1)).optional(),
  LOCAL_SANDBOX: z.enum(['true','false']).default('false').transform(value => value === 'true'),
  API_HOST: z.string().default('127.0.0.1'),
  // Exact proxy IPs only; no blanket trust or attacker-controlled forwarding chain.
  TRUSTED_PROXY_IPS: z.string().default('').transform(value => value.split(',').map(ip => ip.trim()).filter(Boolean))
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()]))),
  API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DATABASE_URL: z.string().url().refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  DEMO_EMAIL: z.string().trim().toLowerCase().email().optional(),
  WEB_ORIGIN: z.string().url().refine(value => new URL(value).origin === value).optional(),
  PASSWORD_RESET_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, 'PASSWORD_RESET_URL must not contain credentials, query parameters or a fragment').optional(),
  SELF_SERVICE_ORIGINS: z.string().default('').transform(value => value.split(',').map(origin => origin.trim()).filter(Boolean))
    .pipe(z.array(z.string().url().refine(value => new URL(value).origin === value)).max(16)),
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
  // Trusted local Mock account identifiers select database routing; they are not credentials.
  PINGCODE_EXTERNAL_ACCOUNT_ID: z.string().trim().min(1).max(200).default('mock-linepool'),
  ONCE_PINGCODE_EXTERNAL_ACCOUNT_ID: z.string().trim().min(1).max(200).default('mock-once'),
  PC_MODE: z.enum(['mock', 'real']).default('mock'),
  PC_BASE_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, 'PC_BASE_URL must be an HTTP(S) deployment prefix without credentials, query or fragment').optional(),
  PC_CLIENT_SECRET: z.string().min(1).max(4096).optional(),
  PC_APPLICATION_ID: z.string().trim().min(1).max(200).optional(),
  PC_ISSUER: z.string().trim().min(1).max(500).optional(),
  PC_AUTH_CALLBACK_URL: z.string().url().refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, 'PC_AUTH_CALLBACK_URL must not contain credentials, query or fragment').optional(),
  PC_NUMBER_REGION: z.enum(['us', 'gb', 'ca', 'sg', 'de', 'nl']).optional(),
  PC_NUMBER_CAPABILITIES: z.string().default('').transform(value => value.split(',').map(item => item.trim()).filter(Boolean))
    .pipe(z.array(z.literal('SEND_SMS')).max(1)),
  PC_REFRESH_EARLY_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  PC_POLL_IDLE_SECONDS: z.coerce.number().int().min(1).max(86400).default(60),
  PC_POLL_WAIT_SECONDS: z.coerce.number().int().min(1).max(86400).default(5),
  PC_WAIT_SECONDS: z.coerce.number().int().min(1).max(3600).default(120),
  PC_WORKER_CONNECTION_IDS: z.string().default('').transform(value => value.split(',').map(id => id.trim()).filter(Boolean))
    .pipe(z.array(z.uuid())),
  SHOP_DELIVERY_SWEEP_SINCE: z.iso.datetime({ offset: true }).optional(),
  PC_MOCK_REFRESH_MODE: z.enum(['SUCCESS', 'REJECTED', 'UNKNOWN']).default('SUCCESS'),
  PC_MOCK_SNAPSHOT_PAGE_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  PC_MOCK_SNAPSHOT_FAIL_ACCOUNT: z.string().trim().max(200).default(''),
  PC_MOCK_SNAPSHOT_FAIL_PAGE: z.coerce.number().int().min(2).default(2),
  // Optional display/validation configuration only; it never enables a payment provider.
  RECHARGE_RULES: z.string().optional().transform((value, context) => {
    if (!value?.trim()) return null;
    try { return rechargeRulesSchema.parse(JSON.parse(value)); }
    catch { context.addIssue({ code: 'custom', message: 'RECHARGE_RULES must be a valid recharge rules JSON object' }); return z.NEVER; }
  }),
}).transform(values => {
  const once = values.SITE_ID === 'once';
  const product = values.PRODUCT ?? (once ? 'NUMBER_LEASE' : 'SMS_CODE');
  const origin = values.WEB_ORIGIN ?? `http://127.0.0.1:${once ? 5174 : 5178}`;
  return {
    ...values,
    PRODUCT: product,
    ENABLED_MODULES: values.ENABLED_MODULES ?? [product],
    API_PORT: values.API_PORT ?? (once ? 3011 : 3010),
    WEB_ORIGIN: origin,
    PASSWORD_RESET_URL: values.PASSWORD_RESET_URL ?? `${origin}/reset-password`,
    PC_APPLICATION_ID: values.PC_APPLICATION_ID ?? (values.PC_MODE === 'mock' ? `mock-${values.SITE_ID}` : ''),
    PC_ISSUER: values.PC_ISSUER ?? (values.PC_MODE === 'mock' ? 'mock-pinclode' : ''),
    PC_AUTH_CALLBACK_URL: values.PC_AUTH_CALLBACK_URL ?? (values.PC_MODE === 'mock' ? `${origin}/api/pc/auth/callback` : ''),
  };
});
@Injectable()
export class Environment {
  readonly values = schema.parse(process.env.NODE_ENV === 'test'
    ? { ...process.env, DATABASE_URL: validateTestDatabase(process.env).connectionString }
    : process.env);
  readonly testSchema = this.values.NODE_ENV === 'test' ? validateTestSchema(process.env.TEST_DATABASE_SCHEMA) : undefined;
  readonly sessionMaxAge = this.values.SESSION_TTL_HOURS * 3600000;
  readonly allowedOrigins = this.values.SELF_SERVICE_ORIGINS.length
    ? this.values.SELF_SERVICE_ORIGINS : [this.values.WEB_ORIGIN];
  get siteId(): SiteId { return this.values.SITE_ID; }
  get product(): SiteProduct { return this.values.PRODUCT; }
  get processRole(): 'api' | 'worker' { return this.values.PROCESS_ROLE; }
  get isApi() { return this.processRole === 'api'; }
  get isWorker() { return this.processRole === 'worker'; }
  get cookieName() { return this.siteId === 'once' ? 'once_core_session' : 'linepool_react_session'; }
  get pcProvider(): 'pingcode-mock' | 'pingcode' { return this.values.PC_MODE === 'real' ? 'pingcode' : 'pingcode-mock'; }
  get selfServiceExternalAccountId() {
    return this.siteId === 'once' ? this.values.ONCE_PINGCODE_EXTERNAL_ACCOUNT_ID : this.values.PINGCODE_EXTERNAL_ACCOUNT_ID;
  }
  get enabledModules(): readonly SiteProduct[] { return this.values.ENABLED_MODULES; }
  isModuleEnabled(product: SiteProduct) { return this.enabledModules.includes(product); }
  get siteName() { return this.siteId === 'once' ? 'ONCE' : 'LINEPOOL'; }
  get passwordResetUrl() { return this.values.PASSWORD_RESET_URL; }
  constructor() {
    if (this.values.PC_MODE === 'real') {
      const missing = ['PC_BASE_URL', 'PC_CLIENT_SECRET', 'PC_APPLICATION_ID', 'PC_ISSUER', 'PC_AUTH_CALLBACK_URL', 'PC_NUMBER_REGION']
        .filter(key => !this.values[key as keyof typeof this.values]);
      if (missing.length) throw new Error(`Real PinClode requires explicit configuration: ${missing.join(', ')}`);
      if (this.values.NODE_ENV === 'production' && (!this.values.PC_BASE_URL!.startsWith('https://')
        || !this.values.PC_AUTH_CALLBACK_URL.startsWith('https://'))) throw new Error('Production PinClode URLs must use HTTPS');
    }
    const expectedProduct = this.siteId === 'once' ? 'NUMBER_LEASE' : 'SMS_CODE';
    if (this.product !== expectedProduct || this.enabledModules.some(product => product !== expectedProduct)) {
      throw new Error('PRODUCT and ENABLED_MODULES must match SITE_ID');
    }
    if (!this.allowedOrigins.includes(new URL(this.passwordResetUrl).origin)) {
      throw new Error('PASSWORD_RESET_URL must use an allowed self-service origin');
    }
    if (this.values.PC_POLL_WAIT_SECONDS > this.values.PC_POLL_IDLE_SECONDS) {
      throw new Error('PC_POLL_WAIT_SECONDS must not exceed PC_POLL_IDLE_SECONDS');
    }
    if (Boolean(this.values.SMTP_USER) !== Boolean(this.values.SMTP_PASSWORD)) {
      throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
    }
    if (this.values.LOCAL_SANDBOX) {
      const database = new URL(this.values.DATABASE_URL);
      if (this.values.NODE_ENV === 'production' || this.values.API_HOST !== '127.0.0.1'
        || !['127.0.0.1','localhost'].includes(database.hostname) || !/_(sandbox|test)$/.test(database.pathname)
        || new URL(this.values.WEB_ORIGIN).hostname !== '127.0.0.1'
        || this.allowedOrigins.some(origin => new URL(origin).hostname !== '127.0.0.1')) throw new Error('Sandbox requires an explicit isolated local database and loopback services');
    }
    if (this.values.NODE_ENV === 'production' && [this.values.WEB_ORIGIN, ...this.allowedOrigins].some(origin => !origin.startsWith('https://'))) {
      throw new Error('Production self-service origins must use HTTPS');
    }
  }
}
