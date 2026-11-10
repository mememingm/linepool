import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { CreateOrderInput } from '@linepool/contracts';
import { Database } from '../../src/database.js';
import { Environment } from '../../src/environment.js';
import { ApiFailure } from '../../src/http.js';
import { LinePoolReceiving } from '../../src/linepool-receiving.js';
import { MockFulfillment } from '../../src/mock-fulfillment.js';
import { Ordering } from '../../src/ordering.js';
import { localProjectId } from '../../src/pc/local-inventory.js';
import { ShopDelivery } from '../../src/pc/shop-delivery.js';
import { PcShopOrdering } from '../../src/pc/shop-ordering.js';
import { creditPoints, lockPointAccount } from '../../src/points-wallet.js';
import { MockReceivingProvider } from '../../src/providers/mock-receiving-provider.js';
import { Workspace } from '../../src/workspace.js';

const initialPoints = 1000;
const unitPoints = 37;
const mockConnectionId = '00000000-0000-4000-8000-000000000031';

type Fixtures = { adminId: string; agentId: string; connectionId: string; shopId: string; projectId: string };

async function seed(db: Database): Promise<Fixtures> {
  const fixtures = {
    adminId: randomUUID(), agentId: randomUUID(), connectionId: randomUUID(), shopId: randomUUID(), projectId: '',
  };
  fixtures.projectId = localProjectId(fixtures.connectionId, 'Telegram');
  await db.transaction(async client => {
    await client.query("INSERT INTO regions(id,name,english,prefix,area) VALUES('us','United States','United States','+1','North America')");
    await client.query(`INSERT INTO offers(region_id,service,plan,name,duration_days,unit_points)
      VALUES('us','Telegram','week','Integration hosted week',7,$1)`, [unitPoints]);
    await client.query(`INSERT INTO users(id,email,password_hash,display_name,role)
      VALUES($1,'itest-admin@example.invalid','itest-no-login','Integration administrator','ADMIN')`, [fixtures.adminId]);
    const agentUserId = randomUUID();
    await client.query(`INSERT INTO users(id,email,password_hash,display_name,auth_kind)
      VALUES($1,'itest-agent@example.invalid','itest-no-login','Integration agent','PINCLODE')`, [agentUserId]);
    await client.query("INSERT INTO agents(id,user_id,name) VALUES($1,$2,'Integration shop agent')", [fixtures.agentId, agentUserId]);
    await client.query(`INSERT INTO pc_agent_identities(site_id,application_id,issuer,subject,user_id,agent_id)
      VALUES('linepool','itest-linepool','itest-local','itest-agent',$1,$2)`, [agentUserId, fixtures.agentId]);
    await client.query(`INSERT INTO upstream_accounts(id,provider,external_account_id,storefront_id,owner_kind,agent_id,
      application_id,issuer,subject,auth_status,capabilities,enabled_capabilities,access_expires_at)
      VALUES($1,'pingcode','itest-agent','linepool','AGENT',$2,'itest-linepool','itest-local','itest-agent','ACTIVE',
        ARRAY['SMS_CODE'],ARRAY['SMS_CODE'],now()+interval '1 day')`, [fixtures.connectionId, fixtures.agentId]);
    await client.query(`INSERT INTO shops(id,site_id,kind,agent_id,connection_id,created_by)
      VALUES($1,'linepool','OFFICIAL',$2,$3,$4)`, [fixtures.shopId, fixtures.agentId, fixtures.connectionId, fixtures.adminId]);
    await client.query(`INSERT INTO shop_products(shop_id,region_id,platform_id,duration_days,name,unit_points)
      VALUES($1,'us','Telegram',7,'Integration shop week',$2)`, [fixtures.shopId, unitPoints]);
    await client.query(`INSERT INTO provider_projects(provider,external_project_id,platform_id,project_name,upstream_account_id)
      VALUES('pingcode',$1,'Telegram','Integration local Telegram',$2)`, [fixtures.projectId, fixtures.connectionId]);
    await client.query(`UPDATE upstream_accounts SET auth_status='ACTIVE',capabilities=ARRAY['SMS_CODE'],
      enabled_capabilities=ARRAY['SMS_CODE'],access_expires_at=now()+interval '1 day' WHERE id=$1`, [mockConnectionId]);
  });
  return fixtures;
}

async function buyer(db: Database) {
  const userId = randomUUID();
  await db.transaction(async client => {
    await client.query(`INSERT INTO users(id,email,password_hash,display_name)
      VALUES($1,$2,'itest-no-login','Integration buyer')`, [userId, `itest-${userId}@example.invalid`]);
    await client.query('INSERT INTO point_accounts(user_id) VALUES($1)', [userId]);
    await creditPoints(client, await lockPointAccount(client, userId), {
      points: initialPoints, type: 'SEED_CREDIT', businessId: `itest-funding:${userId}`, description: 'Integration fixture funding',
    });
  });
  return userId;
}

async function stock(db: Database, fixtures: Fixtures, areaCode: string, provider: 'pingcode' | 'pingcode-mock' = 'pingcode') {
  const numberId = randomUUID();
  const phoneNumber = `+1${areaCode}5550101`;
  const projectId = provider === 'pingcode' ? fixtures.projectId : 'Telegram';
  const connectionId = provider === 'pingcode' ? fixtures.connectionId : mockConnectionId;
  const externalNumberId = `itest:${numberId}`;
  await db.transaction(async client => {
    await client.query(`INSERT INTO phone_numbers(id,region_id,phone_number,upstream_account_id,resource_status,resource_expires_at,pc_capabilities)
      VALUES($1,'us',$2,$3,'ONLINE',now()+interval '90 days',ARRAY['SMS_CODE'])`, [numberId, phoneNumber, connectionId]);
    await client.query(`INSERT INTO provider_resource_bindings(provider,external_number_id,number_id,external_project_id)
      VALUES($1,$2,$3,$4)`, [provider, externalNumberId, numberId, provider === 'pingcode' ? null : projectId]);
    await client.query(`INSERT INTO number_platforms(number_id,platform_id,provider,external_project_id)
      VALUES($1,'Telegram',$2,$3)`, [numberId, provider, projectId]);
  });
  return { numberId, phoneNumber, externalNumberId };
}

function ordering(db: Database, environment: Environment) {
  return new Ordering(db, new Workspace(db, environment), new MockReceivingProvider(environment), environment,
    new LinePoolReceiving(db, environment), undefined, new PcShopOrdering(environment));
}

function request(areaCode: string, quantity = 1): CreateOrderInput {
  return { region: 'us', service: 'Telegram', plan: 'week', receivingMode: 'HOSTED', quantity, areaCode, idempotencyKey: randomUUID() };
}

async function wallet(db: Database, userId: string) {
  const { rows: [row] } = await db.query<{ available_points: number; frozen_points: number }>(
    'SELECT available_points,frozen_points FROM point_accounts WHERE user_id=$1', [userId]);
  assert.ok(row);
  return row;
}

async function orderState(db: Database, orderId: string) {
  const { rows: [row] } = await db.query<{ fulfillment_status: string; reservation_status: string; reservation_id: string }>(
    `SELECT o.fulfillment_status,r.status AS reservation_status,r.id AS reservation_id
      FROM orders o JOIN point_reservations r ON r.id=o.point_reservation_id WHERE o.id=$1`, [orderId]);
  assert.ok(row);
  return row;
}

async function ledger(db: Database, orderId: string) {
  return (await db.query<{ type: string; delta: number; frozen_delta: number; reference_id: string; reservation_id: string }>(
    'SELECT type,delta,frozen_delta,reference_id,reservation_id FROM point_ledger WHERE reference_id=$1 ORDER BY sequence', [orderId])).rows;
}

export async function runIntegrationTests(db: Database, mock: Environment, shop: Environment) {
  const fixtures = await seed(db);

  await test('Order deducts points and allocates exactly once', async () => {
    const userId = await buyer(db);
    const number = await stock(db, fixtures, '201');
    const input = request('201');
    const service = ordering(db, shop);
    const before = await wallet(db, userId);
    const [first, repeated] = await Promise.all([service.create(userId, input), service.create(userId, input)]);
    assert.equal(first.status, 'COMPLETED');
    assert.deepEqual(repeated, first);
    assert.equal(first.totalPoints, unitPoints);
    const after = await wallet(db, userId);
    assert.equal(before.available_points - after.available_points, first.totalPoints);
    assert.equal(after.frozen_points, 0);
    assert.equal(first.numbers.length, 1);
    assert.equal(first.numbers[0]!.id, number.numberId);
    const state = await orderState(db, first.id);
    assert.equal(state.reservation_status, 'CAPTURED');
    const entries = await ledger(db, first.id);
    assert.deepEqual(entries.map(row => [row.type, row.delta, row.frozen_delta]), [
      ['ORDER_RESERVE', -first.totalPoints, first.totalPoints], ['ORDER_CAPTURE', 0, -first.totalPoints],
    ]);
    assert.ok(entries.every(row => row.reference_id === first.id && row.reservation_id === state.reservation_id));
    const { rows: [counts] } = await db.query<{ allocations: number; unique_allocations: number; orders: number }>(
      `SELECT count(*)::int AS allocations,count(DISTINCT (number_id,platform_id))::int AS unique_allocations,
        (SELECT count(*)::int FROM orders WHERE user_id=$2 AND idempotency_key=$3) AS orders
        FROM number_allocations WHERE order_id=$1`, [first.id, userId, input.idempotencyKey]);
    assert.deepEqual(counts, { allocations: 1, unique_allocations: 1, orders: 1 });
  });

  await test('Allocation failure refunds the points reservation', async () => {
    const userId = await buyer(db);
    const number = await stock(db, fixtures, '203', 'pingcode-mock');
    const service = ordering(db, mock);
    const before = await wallet(db, userId);
    // Immediate stock shortage throws and rolls back the order, reservation and ledger atomically.
    await assert.rejects(service.create(userId, request('203', 2)), error => {
      if (!(error instanceof ApiFailure) || error.getStatus() !== 409) return false;
      const response = error.getResponse();
      if (typeof response !== 'object' || response === null || !('error' in response)) return false;
      const detail = response.error;
      return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'INSUFFICIENT_STOCK';
    });
    assert.deepEqual(await wallet(db, userId), before);
    const { rows: [rolledBack] } = await db.query<{ orders: number; reservations: number; ledger_entries: number }>(
      `SELECT (SELECT count(*)::int FROM orders WHERE user_id=$1) AS orders,
        (SELECT count(*)::int FROM point_reservations r JOIN point_accounts a ON a.id=r.account_id WHERE a.user_id=$1) AS reservations,
        (SELECT count(*)::int FROM point_ledger WHERE user_id=$1 AND type<>'SEED_CREDIT') AS ledger_entries`, [userId]);
    assert.deepEqual(rolledBack, { orders: 0, reservations: 0, ledger_entries: 0 });

    // Deferred Mock fulfillment exercises a persisted failure: the only reserved slot becomes unavailable
    // before allocation. Use the real database-backed provider and resolver, with no stubbed return values.
    const pending = await service.create(userId, request('203'), 'deferred-mock');
    assert.equal(pending.status, 'PROCESSING');
    assert.deepEqual(await wallet(db, userId), { available_points: initialPoints - pending.totalPoints, frozen_points: pending.totalPoints });
    await db.query('UPDATE number_platforms SET is_available=false WHERE number_id=$1 AND platform_id=$2', [number.numberId, 'Telegram']);
    const fulfillment = new MockFulfillment(db, undefined, new MockReceivingProvider(mock));
    const claim = await fulfillment.claim(pending.id);
    assert.ok(claim.token);
    const result = await fulfillment.resolve(pending.id, 'SUCCEEDED', 'Integration allocation attempt after inventory became unavailable', claim.token);
    assert.deepEqual(result, { changed: true, status: 'FAILED' });
    const state = await orderState(db, pending.id);
    assert.equal(state.fulfillment_status, 'FAILED');
    assert.equal(state.reservation_status, 'RELEASED');
    assert.deepEqual(await wallet(db, userId), before);
    const entries = await ledger(db, pending.id);
    assert.deepEqual(entries.map(row => [row.type, row.delta, row.frozen_delta]), [
      ['ORDER_RESERVE', -pending.totalPoints, pending.totalPoints], ['ORDER_RELEASE', pending.totalPoints, -pending.totalPoints],
    ]);
    assert.ok(entries.every(row => row.reservation_id === state.reservation_id));
    const { rows: [counts] } = await db.query<{ allocations: number; reserved_slots: number }>(
      `SELECT (SELECT count(*)::int FROM number_allocations WHERE order_id=$1) AS allocations,
        (SELECT count(*)::int FROM number_platforms WHERE reserved_order_id=$1) AS reserved_slots`, [pending.id]);
    assert.deepEqual(counts, { allocations: 0, reserved_slots: 0 });
  });

  await test('ShopDelivery delivers the same provider message only once', async () => {
    const userId = await buyer(db);
    const number = await stock(db, fixtures, '202');
    const purchased = await ordering(db, shop).create(userId, request('202'));
    assert.equal(purchased.status, 'COMPLETED');
    assert.equal(purchased.numbers.length, 1);
    const externalMessageId = `itest:${randomUUID()}`;
    // Read the database clock after purchase so the occurrence lies inside the committed allocation window.
    const { rows: [clock] } = await db.query<{ occurred_at: Date }>('SELECT clock_timestamp() AS occurred_at');
    assert.ok(clock);
    const input = {
      provider: 'pingcode', externalMessageId, connectionId: fixtures.connectionId, numberId: number.numberId,
      occurredAt: clock.occurred_at, sender: 'ITEST', body: 'Your integration code is 123456.',
    };
    await db.transaction(async client => {
      await client.query(`INSERT INTO lp_platform_code_rules(platform_id,enabled,rule,updated_by)
        VALUES('Telegram',true,$1::jsonb,$2)`, [JSON.stringify({
        senderAllowlist: ['ITEST'], bodyPrefix: 'Your integration code is ', bodySuffix: '.', codeLength: 6,
      }), fixtures.adminId]);
      await client.query(`INSERT INTO provider_message_receipts(provider,external_message_id,upstream_account_id,
        external_number_id,connection_id,owner_agent_id,number_id,processing_status,normalized_payload)
        VALUES('pingcode',$1,$2,$3,$2,$4,$5,'CONNECTION_IMPORTED',$6::jsonb)`, [externalMessageId,
        fixtures.connectionId, number.externalNumberId, fixtures.agentId, number.numberId, JSON.stringify({
          connectionId: fixtures.connectionId, upstreamAccountId: fixtures.connectionId,
          ownerAgentId: fixtures.agentId, phoneNumber: number.phoneNumber,
        })]);
    });
    const delivery = new ShopDelivery(shop);
    const first = await db.transaction(client => delivery.deliver(client, input));
    assert.ok(first);
    assert.equal(first.outcome, 'DELIVERED');
    assert.equal(first.platformId, 'Telegram');
    assert.equal(first.allocationId, purchased.numbers[0]!.allocationId);
    assert.equal(first.verificationCode, '123456');
    assert.ok(first.smsMessageId);
    const second = await db.transaction(client => delivery.deliver(client, input));
    // The cached result intentionally has no fresh matching basis; every persisted result field is the same.
    assert.deepEqual(second, { ...first, basis: null });
    const { rows: [counts] } = await db.query<{ deliveries: number; messages: number; linked_messages: number }>(
      `SELECT (SELECT count(*)::int FROM shop_message_deliveries WHERE provider=$1 AND external_message_id=$2) AS deliveries,
        (SELECT count(*)::int FROM sms_messages WHERE user_id=$3) AS messages,
        (SELECT count(*)::int FROM shop_message_deliveries d JOIN sms_messages m ON m.id=d.sms_message_id
          WHERE d.provider=$1 AND d.external_message_id=$2 AND m.id=$4 AND m.user_id=$3 AND m.allocation_id=$5) AS linked_messages`,
      [input.provider, externalMessageId, userId, first.smsMessageId, first.allocationId]);
    assert.deepEqual(counts, { deliveries: 1, messages: 1, linked_messages: 1 });
  });
}
