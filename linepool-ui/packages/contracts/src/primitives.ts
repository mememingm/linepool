import { z } from 'zod';

// Leaf module with shared primitives. Must not import from './index.js'
// to avoid circular-import TDZ errors in the compiled output.
export const passwordSchema = z.string().min(8).max(72).refine(value => new TextEncoder().encode(value).length <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const uuidSchema = z.string().uuid();
export const timestampSchema = z.string().datetime({ offset: true });
export const regionIdSchema = z.enum(['us', 'gb', 'ca', 'sg', 'de', 'nl']);
/** Countries currently open for storefront purchases. Agent inventory is independent. */
export const storefrontRegionIds = ['us'] as const;
export function isStorefrontRegion(region: string): boolean {
  return storefrontRegionIds.some(id => id === region);
}
export const serviceSchema = z.enum(['Telegram', 'WhatsApp', 'Google']);
export const planIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export const fulfillmentStatusSchema = z.enum(['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
