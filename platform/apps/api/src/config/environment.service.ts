import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5174'),
  DATABASE_URL: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
});

@Injectable()
export class EnvironmentService {
  private readonly values = environmentSchema.parse(process.env);

  readonly nodeEnv = this.values.NODE_ENV;
  readonly apiPort = this.values.API_PORT;
  readonly webOrigin = this.values.WEB_ORIGIN;
  readonly databaseUrl = this.values.DATABASE_URL;
  readonly sessionTtlHours = this.values.SESSION_TTL_HOURS;
}
