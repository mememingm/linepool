import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { platformCodeRuleShapeSchema, type PlatformCodeRuleShape } from '@linepool/contracts';
import { Environment } from '../environment.js';

export type ShopDeliveryInput = {
  provider: string;
  externalMessageId: string;
  connectionId: string;
  numberId: string;
  occurredAt: string | Date;
  sender: string;
  body: string;
};
export type ShopDeliveryOutcome = 'DELIVERED' | 'UNMATCHED' | 'AMBIGUOUS' | 'NO_BUYER';
export type MatchBasis = 'SENDER' | 'KEYWORD';
export type PlatformRule = { platformId: string; version: number; rule: PlatformCodeRuleShape };
export type PlatformIdentification = {
  outcome: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';
  platformId?: string;
  basis: MatchBasis | null;
};
export type ShopDeliveryResult = {
  outcome: ShopDeliveryOutcome;
  platformId: string | null;
  ruleVersion: number | null;
  allocationId: string | null;
  smsMessageId: string | null;
  verificationCode: string | null;
  buyerName: string | null;
  basis: MatchBasis | null;
};
type RuleRow = { platform_id: string; version: number; rule: unknown };
type BuyerRow = { id: string; user_id: string; display_name: string; email: string };

/** Sender allowlist matching: exact normalized value, or the numeric form when both sides contain digits. */
export function matchesSender(allowlist: string[], sender: string) {
  const normalized = sender.trim().toLowerCase().replace(/\s+/g, '');
  const digits = sender.replace(/\D/g, '');
  return allowlist.some(value => value.trim().toLowerCase().replace(/\s+/g, '') === normalized
    || Boolean(digits && value.replace(/\D/g, '') && digits === value.replace(/\D/g, '')));
}

export function matchesBodyKeywords(keywords: string[] | undefined, body: string) {
  if (!keywords?.length) return false;
  const lower = body.toLowerCase();
  return keywords.some(keyword => lower.includes(keyword.trim().toLowerCase()));
}

/**
 * Two-level platform identification. Sender allowlists are authoritative; keywords are consulted only when no
 * sender matches. The caller must pass every enabled site-wide rule, not only platforms sold on this number.
 */
export function identifyPlatform(rules: PlatformRule[], sender: string, body: string): PlatformIdentification {
  const senderMatches = rules.filter(rule => matchesSender(rule.rule.senderAllowlist, sender));
  if (senderMatches.length === 1) return { outcome: 'MATCHED', platformId: senderMatches[0]!.platformId, basis: 'SENDER' };
  if (senderMatches.length > 1) return { outcome: 'AMBIGUOUS', basis: 'SENDER' };
  const keywordMatches = rules.filter(rule => matchesBodyKeywords(rule.rule.bodyKeywords, body));
  if (keywordMatches.length === 1) return { outcome: 'MATCHED', platformId: keywordMatches[0]!.platformId, basis: 'KEYWORD' };
  if (keywordMatches.length > 1) return { outcome: 'AMBIGUOUS', basis: 'KEYWORD' };
  return { outcome: 'UNMATCHED', basis: null };
}

/** Hosted receiving is deliberately looser than the one-time 047 rule: first N digits, optionally split once by '-' or space. */
export function extractHostedCode(body: string, length: number): string | null {
  if (!Number.isInteger(length) || length < 4 || length > 8) return null;
  const candidates = body.matchAll(/(?<!\d)(\d+(?:[- ]\d+)?)(?!\d)/g);
  for (const candidate of candidates) {
    const token = candidate[1]!;
    const digits = token.replace(/\D/g, '');
    const separators = (token.match(/[- ]/g) ?? []).length;
    if (digits.length === length && separators <= 1) return digits;
  }
  return null;
}

/** Runs delivery inside a savepoint so a delivery failure cannot roll back the agent's imported receipt. */
export async function deliverSafely(client: PoolClient, delivery: Pick<ShopDelivery, 'deliver'>,
  input: ShopDeliveryInput): Promise<ShopDeliveryResult | null> {
  await client.query('SAVEPOINT shop_delivery');
  try {
    const result = await delivery.deliver(client, input);
    await client.query('RELEASE SAVEPOINT shop_delivery');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT shop_delivery');
    await client.query('RELEASE SAVEPOINT shop_delivery');
    console.error('Shop delivery failed; agent receipt preserved', {
      externalMessageId: input.externalMessageId, connectionId: input.connectionId, numberId: input.numberId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Delivers one trusted agent-connection SMS to the buyer of the matching platform under an ACTIVE shop. */
@Injectable()
export class ShopDelivery {
  constructor(private readonly environment: Environment) {}

  async deliver(client: PoolClient, input: ShopDeliveryInput): Promise<ShopDeliveryResult | null> {
    if (this.environment.siteId !== 'linepool') return null;
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) throw new Error('Shop delivery occurrence time is invalid');
    const { rows: [shop] } = await client.query<{ id: string }>(
      "SELECT id FROM shops WHERE connection_id=$1 AND site_id='linepool' AND status='ACTIVE'", [input.connectionId]);
    if (!shop) return null;
    const { rows: [number] } = await client.query<{ id: string }>(
      'SELECT id FROM phone_numbers WHERE id=$1 AND upstream_account_id=$2', [input.numberId, input.connectionId]);
    if (!number) throw new Error('Shop delivery number does not belong to the shop connection');

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`shop-delivery:${input.provider}:${input.externalMessageId}`]);
    const existing = await this.existing(client, input);
    if (existing) return existing;

    const rules = await client.query<RuleRow>(`SELECT r.platform_id,r.version,r.rule FROM lp_platform_code_rules r
      JOIN platforms p ON p.id=r.platform_id AND p.is_active WHERE r.enabled ORDER BY r.platform_id`);
    const parsedRules: PlatformRule[] = [];
    for (const row of rules.rows) {
      const parsed = platformCodeRuleShapeSchema.safeParse(row.rule);
      if (parsed.success) parsedRules.push({ platformId: row.platform_id, version: row.version, rule: parsed.data });
    }
    const identification = identifyPlatform(parsedRules, input.sender, input.body);
    if (identification.outcome === 'UNMATCHED') {
      return this.record(client, input, shop.id, 'UNMATCHED', null, null, null, null, occurredAt, null);
    }
    if (identification.outcome === 'AMBIGUOUS') {
      return this.record(client, input, shop.id, 'AMBIGUOUS', null, null, null, null, occurredAt, identification.basis);
    }
    const matched = parsedRules.find(rule => rule.platformId === identification.platformId)!;

    const buyers = await client.query<BuyerRow>(`SELECT a.id,a.user_id,u.display_name,u.email
      FROM number_allocations a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.user_id
      WHERE a.number_id=$1 AND a.platform_id=$2 AND a.allocation_type='PLATFORM' AND a.receiving_mode='HOSTED'
        AND o.fulfillment_status='COMPLETED' AND o.shop_id=$3 AND o.product_type='SMS_CODE' AND o.sales_storefront_id='linepool'
        AND a.assigned_at<=$4 AND $4<LEAST(a.expires_at,COALESCE(a.released_at,a.expires_at))
      ORDER BY a.id`, [input.numberId, matched.platformId, shop.id, occurredAt]);
    if (buyers.rowCount === 0) {
      return this.record(client, input, shop.id, 'NO_BUYER', matched.platformId, matched.version, null, null,
        occurredAt, identification.basis);
    }
    if (buyers.rowCount !== 1) {
      return this.record(client, input, shop.id, 'AMBIGUOUS', matched.platformId, matched.version, null, null,
        occurredAt, identification.basis);
    }
    const buyer = buyers.rows[0]!;
    const verificationCode = extractHostedCode(input.body, matched.rule.codeLength);
    const { rows: [message] } = await client.query<{ id: string }>(`INSERT INTO sms_messages
      (user_id,number_id,allocation_id,platform_id,sender,title,body,received_at,ingested_at,verification_code)
      VALUES($1,$2,$3,$4,$5,'',$6,$7,now(),$8) RETURNING id`,
    [buyer.user_id, input.numberId, buyer.id, matched.platformId, input.sender, input.body, occurredAt, verificationCode]);
    return this.record(client, input, shop.id, 'DELIVERED', matched.platformId, matched.version,
      buyer.id, message!.id, occurredAt, identification.basis, buyer.display_name, verificationCode);
  }

  private async existing(client: PoolClient, input: ShopDeliveryInput): Promise<ShopDeliveryResult | null> {
    const { rows: [row] } = await client.query<{
      outcome: ShopDeliveryOutcome; platform_id: string | null; rule_version: number | null;
      allocation_id: string | null; sms_message_id: string | null; verification_code: string | null; display_name: string | null;
    }>(`SELECT d.outcome,d.platform_id,d.rule_version,d.allocation_id,d.sms_message_id,m.verification_code,u.display_name
      FROM shop_message_deliveries d
      LEFT JOIN sms_messages m ON m.id=d.sms_message_id
      LEFT JOIN number_allocations a ON a.id=d.allocation_id
      LEFT JOIN users u ON u.id=a.user_id
      WHERE d.provider=$1 AND d.external_message_id=$2`, [input.provider, input.externalMessageId]);
    if (!row) return null;
    return { outcome: row.outcome, platformId: row.platform_id, ruleVersion: row.rule_version,
      allocationId: row.allocation_id, smsMessageId: row.sms_message_id,
      verificationCode: row.verification_code, buyerName: row.display_name, basis: null };
  }

  private async record(client: PoolClient, input: ShopDeliveryInput, shopId: string, outcome: ShopDeliveryOutcome,
    platformId: string | null, ruleVersion: number | null, allocationId: string | null, smsMessageId: string | null,
    occurredAt: Date, basis: MatchBasis | null, buyerName: string | null = null,
    verificationCode: string | null = null): Promise<ShopDeliveryResult> {
    const { rows: [row] } = await client.query<{
      outcome: ShopDeliveryOutcome; platform_id: string | null; rule_version: number | null;
      allocation_id: string | null; sms_message_id: string | null;
    }>(`INSERT INTO shop_message_deliveries(provider,external_message_id,shop_id,connection_id,number_id,outcome,
      platform_id,rule_version,allocation_id,sms_message_id,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING outcome,platform_id,rule_version,allocation_id,sms_message_id`,
    [input.provider, input.externalMessageId, shopId, input.connectionId, input.numberId, outcome,
      platformId, ruleVersion, allocationId, smsMessageId, occurredAt]);
    return { outcome: row!.outcome, platformId: row!.platform_id, ruleVersion: row!.rule_version,
      allocationId: row!.allocation_id, smsMessageId: row!.sms_message_id, verificationCode, buyerName, basis };
  }
}
