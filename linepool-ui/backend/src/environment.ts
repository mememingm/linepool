import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { rechargeRulesSchema } from '@linepool/contracts';
import { validateTestDatabase, validateTestSchema } from './test-database.js';

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
@Injectable()
export class Environment {
  readonly values = schema.parse(process.env.NODE_ENV === 'test'
    ? { ...process.env, DATABASE_URL: validateTestDatabase(process.env).connectionString }
    : process.env);
  readonly testSchema = this.values.NODE_ENV === 'test' ? validateTestSchema(process.env.TEST_DATABASE_SCHEMA) : undefined;
  readonly sessionMaxAge = this.values.SESSION_TTL_HOURS * 3600000;
  constructor() {
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
