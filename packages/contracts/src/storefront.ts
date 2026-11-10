import { z } from 'zod';

export const storefrontIdSchema = z.string().trim().min(1).max(100);
export const storefrontProductSchema = z.enum(['SMS_CODE', 'NUMBER_LEASE', 'VOICE']);
export const upstreamAccountIdSchema = z.string().uuid();
export const upstreamAccountStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export type StorefrontId = z.infer<typeof storefrontIdSchema>;
export type StorefrontProduct = z.infer<typeof storefrontProductSchema>;
export type UpstreamAccountId = z.infer<typeof upstreamAccountIdSchema>;
export type UpstreamAccountStatus = z.infer<typeof upstreamAccountStatusSchema>;
