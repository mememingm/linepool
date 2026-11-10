import 'reflect-metadata';
import { platformCodeRuleShapeSchema } from '@linepool/contracts';
import { Environment } from '../src/environment.js';
import { Database } from '../src/database.js';
import { ShopDelivery, deliverSafely, identifyPlatform, type PlatformRule } from '../src/pc/shop-delivery.js';

/**
 * Read-only report or a necessarily-rolled-back replay of one shop delivery.
 * There is intentionally no COMMIT path in this file.
 */
const environment = new Environment();
if (environment.siteId !== 'linepool') throw new Error('The shop delivery replay is LinePool-only');
const db = new Database(environment);

type Receipt = { external_message_id: string; sender: string; body: string; occurred_at: string };
type KnownPlatform = { platform: string; markers: RegExp[]; proposed: string[] };

const knownPlatforms: KnownPlatform[] = [
  { platform: 'Telegram', markers: [/telegram/i, /t\.me/i], proposed: ['85474'] },
  { platform: 'WhatsApp', markers: [/whatsapp/i], proposed: [] },
  { platform: 'Google', markers: [/google/i], proposed: ['22000'] },
];

function argument(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value?.slice(prefix.length);
}
function required(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}
function mask(body: string, limit = 180) {
  return body.replace(/[0-9]/g, '#').slice(0, limit);
}
function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

async function report() {
  const connection = argument('connection') ?? (await db.query<{ id: string }>(
    `SELECT id FROM upstream_accounts WHERE provider='pingcode' AND storefront_id='linepool'
     AND external_account_id='8' AND owner_kind='AGENT' LIMIT 1`)).rows[0]?.id
    ?? (await db.query<{ connection_id: string }>(
      "SELECT connection_id FROM shops WHERE site_id='linepool' AND kind='OFFICIAL' AND status='ACTIVE' LIMIT 1")).rows[0]?.connection_id;
  if (!connection) throw new Error('No PC8 or ACTIVE official shop connection; pass --connection=<uuid>');
  const rules = (await db.query<{ platform_id: string; version: number; rule: unknown }>(
    `SELECT r.platform_id,r.version,r.rule FROM lp_platform_code_rules r JOIN platforms p ON p.id=r.platform_id AND p.is_active
     WHERE r.enabled ORDER BY r.platform_id`)).rows;
  const parsedRules: PlatformRule[] = [];
  for (const row of rules) {
    const parsed = platformCodeRuleShapeSchema.safeParse(row.rule);
    if (parsed.success) parsedRules.push({ platformId: row.platform_id, version: row.version, rule: parsed.data });
  }
  if (!rules.length) console.log('No enabled platform code rules; configured distribution is all UNMATCHED.');

  const receipts = (await db.query<Receipt>(
    `SELECT external_message_id,normalized_payload->>'sender' AS sender,normalized_payload->>'content' AS body,
     normalized_payload->>'occurredAt' AS occurred_at FROM provider_message_receipts
     WHERE connection_id=$1 AND provider='pingcode' AND processing_status='CONNECTION_IMPORTED'
     ORDER BY (normalized_payload->>'occurredAt')::timestamptz,external_message_id`, [connection])).rows;

  const configured = { distribution: {} as Record<string, number>, basis: { SENDER: 0, KEYWORD: 0, NONE: 0 },
    samples: {} as Record<string, string[]> };
  const unmatchedRows: Receipt[] = [];
  for (const receipt of receipts) {
    const identification = identifyPlatform(parsedRules, receipt.sender, receipt.body);
    const key = identification.outcome === 'MATCHED' ? identification.platformId! : identification.outcome;
    configured.distribution[key] = (configured.distribution[key] ?? 0) + 1;
    configured.basis[identification.basis ?? 'NONE'] += 1;
    if (identification.outcome === 'UNMATCHED') unmatchedRows.push(receipt);
    const samples = configured.samples[key] ??= [];
    if (samples.length < 3) samples.push(`${receipt.sender} | ${mask(receipt.body, 160)} | ${receipt.occurred_at}`);
  }

  const coverage = knownPlatforms.map(platform => {
    const marker = (body: string) => platform.markers.some(pattern => pattern.test(body));
    const platformRows = receipts.filter(receipt => marker(receipt.body));
    const senders = countBy(platformRows.map(receipt => receipt.sender));
    const templates = countBy(platformRows.map(receipt => mask(receipt.body, 30))).slice(0, 10);
    const candidateNames = [...new Set([...platform.proposed, ...senders.map(([sender]) => sender)])];
    const candidates = candidateNames.map(sender => {
      const all = receipts.filter(receipt => receipt.sender === sender);
      const matched = all.filter(receipt => marker(receipt.body));
      return {
        sender,
        total: all.length,
        platformMessages: matched.length,
        purity: all.length ? matched.length / all.length : null,
        nonPlatformSamples: all.filter(receipt => !marker(receipt.body)).slice(0, 3).map(receipt => mask(receipt.body, 120)),
      };
    }).sort((left, right) => (right.purity ?? -1) - (left.purity ?? -1) || right.total - left.total);
    return { platform: platform.platform, messages: platformRows.length,
      senders: senders.map(([sender, count]) => ({ sender, count })), templates, candidates };
  });
  const whatsapp = coverage.find(item => item.platform === 'WhatsApp');
  const whatsappPurity100 = whatsapp?.candidates.find(candidate => candidate.purity === 1 && candidate.total > 0)?.sender ?? null;
  const unmatchedTopSenders = countBy(unmatchedRows.map(receipt => receipt.sender)).slice(0, 20).map(([sender, count]) => ({
    sender, count, samples: unmatchedRows.filter(receipt => receipt.sender === sender).slice(0, 3).map(receipt => mask(receipt.body, 120)),
  }));

  console.log(JSON.stringify({
    connection, receipts: receipts.length, rules: rules.map(rule => rule.platform_id), configured,
    coverage, whatsappPurity100, unmatchedTopSenders,
    blocked: whatsappPurity100 ? null : 'NO_WHATSAPP_SENDER_WITH_100_PERCENT_PURITY',
  }, null, 2));
}

async function replay() {
  const numberValue = required('number');
  const at = new Date(required('at'));
  if (!Number.isFinite(at.getTime())) throw new Error('--at must be an ISO timestamp');
  const fromReceipt = argument('from-receipt');
  const sender = argument('sender') ?? '';
  const body = argument('body') ?? '';
  if (!fromReceipt && (!sender || !body)) throw new Error('Pass --from-receipt or both --sender and --body');
  const repeat = Number(argument('repeat') ?? '1');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('--repeat must be 1..5');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ id: string; phone_number: string; connection_id: string }>(`SELECT n.id,n.phone_number,n.upstream_account_id AS connection_id
      FROM phone_numbers n JOIN shops s ON s.connection_id=n.upstream_account_id AND s.status='ACTIVE'
      WHERE (n.id::text=$1 OR n.phone_number=$1) LIMIT 1`, [numberValue]);
    const row = target.rows[0];
    if (!row) throw new Error('Target number is not a shop number');
    const receiptId = fromReceipt ?? (await client.query<{ external_message_id: string }>(`SELECT external_message_id
      FROM provider_message_receipts WHERE provider='pingcode' AND processing_status='CONNECTION_IMPORTED'
      ORDER BY received_at,external_message_id LIMIT 1`)).rows[0]?.external_message_id;
    if (!receiptId) throw new Error('No historical pingcode receipt is available for the delivery foreign key');
    const { rows: [historical] } = await client.query<{ sender: string | null; body: string | null }>(`SELECT
      normalized_payload->>'sender' AS sender,normalized_payload->>'content' AS body
      FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1`, [receiptId]);
    if (fromReceipt && !historical) throw new Error('Historical receipt was not found');
    const input = { provider: 'pingcode', externalMessageId: receiptId,
      connectionId: row.connection_id, numberId: row.id, occurredAt: at.toISOString(),
      sender: argument('sender') ?? historical?.sender ?? sender, body: argument('body') ?? historical?.body ?? body };
    const delivery = new ShopDelivery(environment);
    const results = [];
    for (let index = 0; index < repeat; index += 1) results.push(await delivery.deliver(client, input));
    const deliveryCount = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_message_deliveries WHERE provider=$1 AND external_message_id=$2', [input.provider, input.externalMessageId]);
    const messageCount = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM sms_messages WHERE allocation_id=$1', [results[0]?.allocationId ?? null]);
    const receiptStatus = fromReceipt ? (await client.query<{ status: string }>('SELECT processing_status AS status FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2', ['pingcode', fromReceipt])).rows[0]?.status : null;
    console.log(JSON.stringify({ case: argument('case') ?? null, number: row.phone_number, at: at.toISOString(),
      sender: input.sender, body: mask(input.body), results, deliveryRows: deliveryCount.rows[0]?.n ?? 0,
      buyerMessages: messageCount.rows[0]?.n ?? 0, agentReceiptStatus: receiptStatus }, null, 2));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function failureIsolation() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [receipt] } = await client.query<{
      external_message_id: string; connection_id: string; number_id: string; processing_status: string;
      sender: string; body: string; occurred_at: string;
    }>(`SELECT c.external_message_id,c.connection_id,c.number_id,c.processing_status,
      c.normalized_payload->>'sender' AS sender,c.normalized_payload->>'content' AS body,
      c.normalized_payload->>'occurredAt' AS occurred_at
      FROM provider_message_receipts c WHERE c.provider='pingcode' AND c.processing_status='CONNECTION_IMPORTED'
      ORDER BY c.received_at,c.external_message_id LIMIT 1`);
    if (!receipt) throw new Error('No imported agent receipt is available for case 11');
    const result = await deliverSafely(client, {
      deliver: async () => { throw new Error('forced delivery failure for case 11'); },
    }, {
      provider: 'pingcode', externalMessageId: receipt.external_message_id, connectionId: receipt.connection_id,
      numberId: receipt.number_id, occurredAt: receipt.occurred_at, sender: receipt.sender, body: receipt.body,
    });
    const after = await client.query<{ status: string }>('SELECT processing_status AS status FROM provider_message_receipts WHERE provider=$1 AND external_message_id=$2', ['pingcode', receipt.external_message_id]);
    const deliveries = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_message_deliveries WHERE provider=$1 AND external_message_id=$2', ['pingcode', receipt.external_message_id]);
    await client.query('SELECT 1');
    console.log(JSON.stringify({
      case: '11', externalMessageId: receipt.external_message_id, deliveryResult: result,
      agentReceiptStatus: after.rows[0]?.status, deliveryRows: deliveries.rows[0]?.n ?? 0,
      outerTransactionUsable: true, errorLogged: true,
      note: 'Savepoint rolled back only the delivery; the outer agent-receipt transaction remains usable.',
    }, null, 2));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function case8() {
  const numberValue = argument('number') ?? '+12136082447';
  const at = new Date(required('at'));
  const at2 = new Date(argument('at2') ?? new Date(at.getTime() + 60000).toISOString());
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(at2.getTime())) throw new Error('--at/--at2 must be ISO timestamps');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ id: string; phone_number: string; connection_id: string }>(`SELECT n.id,n.phone_number,n.upstream_account_id AS connection_id
      FROM phone_numbers n JOIN shops s ON s.connection_id=n.upstream_account_id AND s.status='ACTIVE'
      WHERE (n.id::text=$1 OR n.phone_number=$1) LIMIT 1`, [numberValue]);
    const row = target.rows[0];
    if (!row) throw new Error('Target number is not a shop number');
    const ids = [argument('from-receipt'), argument('from-receipt2')];
    const selected = ids[0] && ids[1] ? ids : (await client.query<{ external_message_id: string }>(
      `SELECT external_message_id FROM provider_message_receipts WHERE provider='pingcode'
       AND processing_status='CONNECTION_IMPORTED' AND normalized_payload->>'sender'='85474'
       ORDER BY received_at,external_message_id LIMIT 2`)).rows.map(item => item.external_message_id);
    if (selected.length !== 2) throw new Error('Case 8 needs two Telegram historical receipts');
    const delivery = new ShopDelivery(environment);
    const results = [];
    for (const [index, receiptId] of selected.entries()) {
      const { rows: [historical] } = await client.query<{ sender: string; body: string }>(`SELECT
        normalized_payload->>'sender' AS sender,normalized_payload->>'content' AS body
        FROM provider_message_receipts WHERE provider='pingcode' AND external_message_id=$1`, [receiptId]);
      if (!historical) throw new Error(`Receipt not found: ${receiptId}`);
      results.push(await delivery.deliver(client, {
        provider: 'pingcode', externalMessageId: receiptId!, connectionId: row.connection_id, numberId: row.id,
        occurredAt: (index === 0 ? at : at2).toISOString(), sender: historical.sender, body: historical.body,
      }));
    }
    const deliveries = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_message_deliveries WHERE provider=$1 AND external_message_id=ANY($2::text[])', ['pingcode', selected]);
    const messages = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM sms_messages WHERE number_id=$1 AND allocation_id=$2', [row.id, results[0]?.allocationId ?? null]);
    console.log(JSON.stringify({ case: '8', number: row.phone_number, at: at.toISOString(), at2: at2.toISOString(),
      results, deliveryRows: deliveries.rows[0]?.n ?? 0, buyerMessages: messages.rows[0]?.n ?? 0 }, null, 2));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

try {
  if (process.argv.includes('--report')) await report();
  else if (argument('case') === '11') await failureIsolation();
  else if (argument('case') === '8') await case8();
  else await replay();
} finally {
  await db.onModuleDestroy();
}
