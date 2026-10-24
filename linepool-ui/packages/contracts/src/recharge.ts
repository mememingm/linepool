import { z } from 'zod';

const minorAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pointAmount = z.number().int().positive().max(2147483647);
export const rechargeRulesSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/).refine(value => Intl.supportedValuesOf('currency').includes(value), 'Use a supported ISO 4217 currency'),
  fractionDigits: z.number().int().min(0).max(6),
  minimumMinor: minorAmount,
  maximumMinor: minorAmount,
  presetsMinor: z.array(minorAmount).max(12),
  exchangeAmountMinor: minorAmount.nullable().default(null),
  exchangePoints: pointAmount.nullable().default(null),
}).superRefine((rules, context) => {
  if (rules.minimumMinor > rules.maximumMinor || rules.presetsMinor.some(amount => amount < rules.minimumMinor || amount > rules.maximumMinor)
    || new Set(rules.presetsMinor).size !== rules.presetsMinor.length) {
    context.addIssue({ code: 'custom', message: 'Recharge range and presets must be consistent' });
  }
  if ((rules.exchangeAmountMinor === null) !== (rules.exchangePoints === null)) {
    context.addIssue({ code: 'custom', path: ['exchangePoints'], message: 'Supply both exchange amount and points' });
  }
  if (rules.exchangeAmountMinor !== null && rules.exchangePoints !== null
    && Number.isSafeInteger(rules.exchangeAmountMinor) && rules.exchangeAmountMinor > 0
    && Number.isSafeInteger(rules.exchangePoints) && rules.exchangePoints > 0
    && Number.isSafeInteger(rules.maximumMinor) && rules.maximumMinor > 0
    && rules.presetsMinor.every(amount => Number.isSafeInteger(amount) && amount > 0)) {
    const divisor = BigInt(rules.exchangeAmountMinor);
    const multiplier = BigInt(rules.exchangePoints);
    if (BigInt(rules.maximumMinor) * multiplier > 2147483647n * divisor) {
      context.addIssue({ code: 'custom', path: ['maximumMinor'], message: 'Maximum amount exceeds the supported points range' });
    }
    if (rules.presetsMinor.some(amount => BigInt(amount) * multiplier % divisor !== 0n)) {
      context.addIssue({ code: 'custom', path: ['presetsMinor'], message: 'Every preset must convert to whole points' });
    }
  }
});
export type RechargeRules = z.infer<typeof rechargeRulesSchema>;
export type AmountResult = { amountMinor: number; error: null } | { amountMinor: null; error: 'empty' | 'format' | 'configuration' | 'precision' | 'range' };
export function parseRechargeAmount(value: string, rules: RechargeRules | null): AmountResult {
  if (!value.trim()) return { amountMinor: null, error: 'empty' };
  if (value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value)) return { amountMinor: null, error: 'format' };
  if (!rules) return { amountMinor: null, error: 'configuration' };
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > rules.fractionDigits) return { amountMinor: null, error: 'precision' };
  const scaled = BigInt(integer!) * 10n ** BigInt(rules.fractionDigits) + BigInt(fraction.padEnd(rules.fractionDigits, '0') || '0');
  if (scaled < BigInt(rules.minimumMinor) || scaled > BigInt(rules.maximumMinor)) return { amountMinor: null, error: 'range' };
  return { amountMinor: Number(scaled), error: null };
}
export type RechargePointsResult = { points: number; error: null } | { points: null; error: 'configuration' | 'precision' | 'range' };
export function calculateRechargePoints(amountMinor: number, rules: RechargeRules | null): RechargePointsResult {
  if (!rules?.exchangeAmountMinor || !rules.exchangePoints) return { points: null, error: 'configuration' };
  if (!Number.isSafeInteger(amountMinor) || amountMinor < rules.minimumMinor || amountMinor > rules.maximumMinor) return { points: null, error: 'range' };
  const numerator = BigInt(amountMinor) * BigInt(rules.exchangePoints);
  const divisor = BigInt(rules.exchangeAmountMinor);
  if (numerator % divisor !== 0n) return { points: null, error: 'precision' };
  const points = numerator / divisor;
  if (points < 1n || points > 2147483647n) return { points: null, error: 'range' };
  return { points: Number(points), error: null };
}
export function rechargeAmountInput(minor: number, fractionDigits: number) {
  const value = BigInt(minor).toString().padStart(fractionDigits + 1, '0');
  return fractionDigits ? `${value.slice(0, -fractionDigits)}.${value.slice(-fractionDigits)}` : value;
}
export function formatRechargeAmount(minor: number, rules: Pick<RechargeRules, 'currency' | 'fractionDigits'>, locale: string) {
  const scale = 10n ** BigInt(rules.fractionDigits);
  const value = BigInt(minor);
  const fraction = rules.fractionDigits ? new Intl.NumberFormat(locale, { useGrouping: false,
    minimumIntegerDigits: rules.fractionDigits, maximumFractionDigits: 0 }).format(value % scale) : '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: rules.currency,
    minimumFractionDigits: rules.fractionDigits, maximumFractionDigits: rules.fractionDigits })
    .formatToParts(value / scale).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

export const rechargeStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED']);
export const createRechargeOrderInputSchema = z.strictObject({
  amountMinor: minorAmount, paymentMethod: z.string().trim().min(1).max(40).optional(), idempotencyKey: z.uuid(),
});
export const rechargeRecordSchema = z.object({
  id: z.uuid(), orderNumber: z.string(), currency: z.string(), fractionDigits: z.number().int(),
  amountMinor: minorAmount, points: pointAmount, status: rechargeStatusSchema,
  paymentMethod: z.string().nullable(), createdAt: z.string(), paidAt: z.string().nullable(), creditedAt: z.string().nullable(),
});
export const adminRechargeRecordSchema = rechargeRecordSchema.extend({
  userId: z.uuid(), ownerName: z.string(), email: z.string(), providerTransactionId: z.string().nullable(),
});
export const rechargeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.union([z.literal(''), rechargeStatusSchema]).default(''),
  search: z.string().trim().max(200).default(''),
});
export const adminRechargeQuerySchema = rechargeQuerySchema.extend({ userId: z.uuid().optional() });
export const rechargeSettingsSchema = z.object({
  rules: rechargeRulesSchema.nullable(), version: z.number().int().nonnegative(),
  source: z.enum(['database', 'environment', 'unconfigured']), updatedAt: z.string().nullable(), updatedBy: z.string().nullable(),
});
export const rechargeSettingsInputSchema = z.strictObject({
  rules: rechargeRulesSchema.refine(rules => rules.exchangeAmountMinor !== null && rules.exchangePoints !== null,
    'An exchange rate is required').nullable(),
  expectedVersion: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500),
});
export const rechargeOverviewSchema = z.object({
  pointsBalance: z.number().int().nonnegative(), rules: rechargeRulesSchema.nullable(),
  paymentStatus: z.literal('not_connected'), paymentMethods: z.array(z.never()),
});
export type RechargeOverview = z.infer<typeof rechargeOverviewSchema>;
export type RechargeRecord = z.infer<typeof rechargeRecordSchema>;
export type RechargeStatus = z.infer<typeof rechargeStatusSchema>;
export type CreateRechargeOrderInput = z.infer<typeof createRechargeOrderInputSchema>;
export type RechargeQuery = z.infer<typeof rechargeQuerySchema>;
export type AdminRechargeQuery = z.infer<typeof adminRechargeQuerySchema>;
export type RechargeSettings = z.infer<typeof rechargeSettingsSchema>;
export type RechargeSettingsInput = z.infer<typeof rechargeSettingsInputSchema>;
