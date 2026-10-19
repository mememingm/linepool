import { createHash } from 'node:crypto';
import { hash } from 'bcryptjs';
import type pg from 'pg';
import { registerInputSchema, type Order, type RegisterInput } from '@linepool/contracts';

function stableId(key: string) {
  const hex = createHash('sha256').update(`linepool-react-demo:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const regions = [
  { id: 'us', name: '美国', english: 'United States', prefix: '+1', area: '北美', price: 15 },
  { id: 'gb', name: '英国', english: 'United Kingdom', prefix: '+44', area: '欧洲', price: 18 },
  { id: 'ca', name: '加拿大', english: 'Canada', prefix: '+1', area: '北美', price: 15 },
  { id: 'sg', name: '新加坡', english: 'Singapore', prefix: '+65', area: '亚洲', price: 22 },
  { id: 'de', name: '德国', english: 'Germany', prefix: '+49', area: '欧洲', price: 20 },
  { id: 'nl', name: '荷兰', english: 'Netherlands', prefix: '+31', area: '欧洲', price: 18 },
] as const;
const services = ['Telegram', 'WhatsApp', 'Google'] as const;
const plans = [
  { id: 'week', name: '7 天短期服务', days: 7 },
  { id: 'month', name: '30 天短期服务', days: 30 },
] as const;
const nationalNumberLengths: Record<(typeof regions)[number]['id'], number> = { us: 10, gb: 10, ca: 10, sg: 8, de: 10, nl: 9 };
const nationalNumberPrefixes: Record<(typeof regions)[number]['id'], string> = { us: '959', gb: '740', ca: '647', sg: '81', de: '151', nl: '620' };
function generatedPhoneNumber(regionId: (typeof regions)[number]['id'], service: string, index: number) {
  const region = regions.find(item => item.id === regionId);
  if (!region) throw new Error(`Unknown demo region: ${regionId}`);
  const digits = createHash('sha256').update(`linepool-react-demo:number:${regionId}:${service}:${index}`).digest('hex').replace(/[a-f]/g, letter => String(letter.charCodeAt(0) - 96));
  const prefix = nationalNumberPrefixes[regionId];
  return `${region.prefix}${prefix}${digits.slice(0, nationalNumberLengths[regionId] - prefix.length)}`;
}
export async function seedDemo(client: pg.Client, input: RegisterInput) {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
  const demo = registerInputSchema.parse(input);
  try {
    const passwordHash = await hash(demo.password, 12);
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(734102610)');
    for (const [index, region] of regions.entries()) {
      await client.query('INSERT INTO regions(id,name,english,prefix,area,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING', [region.id, region.name, region.english, region.prefix, region.area, index]);
      for (const service of services) {
        for (const plan of plans) {
          const price = plan.id === 'week' ? Math.ceil(region.price * 0.38) : region.price;
          await client.query(`INSERT INTO offers(region_id,service,plan,name,duration_days,unit_points)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [region.id, service, plan.id, plan.name, plan.days, price]);
        }
        for (let index = 1; index <= 40; index++) {
          await client.query('INSERT INTO phone_numbers(id,region_id,service,phone_number) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
            stableId(`number:${region.id}:${service}:${index}`), region.id, service,
            generatedPhoneNumber(region.id, service, index),
          ]);
        }
      }
    }
    const { rows: [created] } = await client.query<{ id: string }>(
      `INSERT INTO users(id,email,password_hash,display_name,is_demo,points_balance) VALUES($1,$2,$3,$4,true,0)
       ON CONFLICT(email) DO NOTHING RETURNING id`, [stableId('user'), demo.email, passwordHash, demo.displayName],
    );
    if (!created) {
      const { rows: [existing] } = await client.query<{ is_demo: boolean }>('SELECT is_demo FROM users WHERE email=$1', [demo.email]);
      if (!existing?.is_demo) throw new Error('Demo email belongs to a non-demo account');
    } else {
      const userId = created.id;
      let balance = 1340;
      const now = Date.now();
      await client.query("INSERT INTO point_ledger(id,user_id,type,delta,balance_after,description,created_at) VALUES($1,$2,'SEED_CREDIT',$3,$3,$4,$5)", [stableId('credit'), userId, balance, 'Local demo credit (no payment)', new Date(now - 11 * 86400000)]);
      const fixtures: { region: Order['region']; service: Order['service']; plan: Order['plan']; ageDays: number }[] = [
        { region: 'nl', service: 'Google', plan: 'week', ageDays: 9 },
        { region: 'gb', service: 'WhatsApp', plan: 'week', ageDays: 6 },
        { region: 'us', service: 'Telegram', plan: 'month', ageDays: 1 },
      ];
      for (const [index, fixture] of fixtures.entries()) {
        const { rows: [offer] } = await client.query<{ name: string; duration_days: number; unit_points: number }>('SELECT name,duration_days,unit_points FROM offers WHERE region_id=$1 AND service=$2 AND plan=$3', [fixture.region, fixture.service, fixture.plan]);
        if (!offer) throw new Error('Demo offer missing');
        const orderId = stableId(`order:${index}`);
        const numberId = stableId(`number:${fixture.region}:${fixture.service}:1`);
        const assignedAt = new Date(now - fixture.ageDays * 86400000);
        const expiresAt = new Date(assignedAt.getTime() + offer.duration_days * 86400000);
        await client.query(`INSERT INTO orders(id,order_number,user_id,region_id,service,plan,plan_name,quantity,unit_points,total_points,duration_days,idempotency_key,created_at,fulfillment_status,completed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,$10,$11,'COMPLETED',$11)`, [orderId, `LP-DEMO-${index + 1}`, userId, fixture.region, fixture.service, fixture.plan, offer.name, offer.unit_points, offer.duration_days, stableId(`request:${index}`), assignedAt]);
        const allocated = await client.query('UPDATE phone_numbers SET assigned_user_id=$1,order_id=$2,assigned_at=$3,expires_at=$4 WHERE id=$5 AND assigned_user_id IS NULL', [userId, orderId, assignedAt, expiresAt, numberId]);
        if (allocated.rowCount !== 1) throw new Error('Demo fixture inventory was already assigned');
        balance -= offer.unit_points;
        if (balance < 0) throw new Error('Demo fixtures exceed initial credit');
        await client.query("INSERT INTO point_ledger(id,user_id,type,delta,balance_after,description,reference_id,created_at) VALUES($1,$2,'ORDER_DEBIT',$3,$4,$5,$6,$7)", [stableId(`ledger:${index}`), userId, -offer.unit_points, balance, `Demo purchase ${fixture.region}`, orderId, assignedAt]);
        for (let message = 1; message <= 3; message++) {
          const receivedAt = new Date(Math.min(now - 3600000, expiresAt.getTime() - 3600000) - message * 60000);
          const code = String(482900 + index * 10 + message);
          await client.query(`INSERT INTO sms_messages(id,user_id,number_id,sender,body,verification_code,received_at,is_read)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [stableId(`sms:${index}:${message}`), userId, numberId, fixture.service, `[DEMO] ${fixture.service} sample code: ${code}. This is not a real SMS.`, code, receivedAt, index === 0 || message === 3]);
        }
      }
      await client.query('UPDATE users SET points_balance=$2 WHERE id=$1', [userId, balance]);
    }
    await client.query('COMMIT');
    return { created: Boolean(created) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
