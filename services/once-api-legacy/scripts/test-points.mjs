// Run after `npm run build`. Uses a disposable LOCAL PostgreSQL database; never migrates the configured app database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
import pg from 'pg';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(cwd, '.env'), quiet: true });
const base = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Tests require a local database server');
const name = `once_points_test_${Date.now()}`;
const adminUrl = new URL(process.env.ONCE_TEST_ADMIN_URL || base); adminUrl.pathname = '/postgres';
// The bundled dev cluster intentionally gives the app role NOCREATEDB. Use its existing local admin only to create/drop this disposable DB.
if (!process.env.ONCE_TEST_ADMIN_URL && base.hostname === '127.0.0.1' && base.port === '55432' && base.username === 'once') {
  const credentials = JSON.parse(readFileSync(join(homedir(), '.once', 'postgres-dev', 'credentials.json'), 'utf8'));
  adminUrl.username = 'once_admin'; adminUrl.password = credentials.admin;
}
assert(['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname), 'Test administrator must also be local');
const adminPool = new pg.Pool({ connectionString: adminUrl.toString() });
let db;
let count = 0;
const key = () => randomUUID();
async function test(label, fn) { if (process.env.POINTS_TEST_ONLY && !label.includes(process.env.POINTS_TEST_ONLY)) return; await fn(); count++; console.log(`PASS ${count}: ${label}`); }
try {
  await adminPool.query(`CREATE DATABASE "${name}" OWNER "${decodeURIComponent(base.username).replaceAll('"', '""')}"`);
  const testUrl = new URL(base); testUrl.pathname = `/${name}`;
  process.env.DATABASE_URL = testUrl.toString();
  process.env.DEMO_MODE = 'true'; process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, [resolve(cwd, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd, env: process.env, stdio: 'pipe' });
  await import('reflect-metadata');
  const { DbService } = await import('../dist/db.service.js');
  const { PaymentGateway } = await import('../dist/payment.gateway.js');
  const { PointsService } = await import('../dist/points.service.js');
  const { FulfillmentService } = await import('../dist/fulfillment.service.js');
  const { LeasesService } = await import('../dist/leases.service.js');
  const { AdminService } = await import('../dist/admin.service.js');
  db = new DbService(); await db.$connect();
  const gateway = new PaymentGateway(), points = new PointsService(db, gateway), ops = new AdminService(db, {}, {}, {});
  const fulfillment = new FulfillmentService(db, points), leases = new LeasesService(db, fulfillment);
  const operator = await db.user.create({ data: { email: `${key()}@example.test`, passwordHash: 'test-only', role: 'ADMIN', pointAccount: { create: {} } } });
  const plan = await db.plan.upsert({ where: { days: 7 }, create: { days: 7, priceMinor: 1200, pointsPrice: 1200, version: 1, label: '测试七天' }, update: { priceMinor: 1200, pointsPrice: 1200, version: 1, active: true } });
  let phoneSequence = 100000;
  const user = () => db.user.create({ data: { email: `${key()}@example.test`, passwordHash: 'test-only', pointAccount: { create: {} } } });
  const phone = () => db.phoneNumber.create({ data: { number: `+1202555${++phoneSequence}`, countryCode: 'US', countryName: '美国', regionId: 'DC', regionName: '华盛顿', provider: 'demo' } });
  async function funded(value = 5000) { const u = await user(); await points.adjust(operator.id, u.id, value, '测试补偿', key()); return u; }
  async function paid(value = 5000) { const u = await user(); const r = await points.createRecharge(u.id, value, key()); await points.demoPay(u.id, r.id, 'SUCCESS'); return { u, r }; }
  const balance = id => points.account(id);
  const buy = (u, p, k = key(), scenario = 'SUCCESS', extra = {}) => fulfillment.purchase(u.id, { kind: 'RENT', number: p.number, term: 7, quoteVersion: 1, ...extra }, k, scenario);
  const rejects = (fn, code) => assert.rejects(fn, error => !code || error.getResponse?.().code === code);

  await test('new and legacy users start with zero points', async () => { const u = await user(); assert.equal((await balance(u.id)).availablePoints, 0); });
  await test('compensation adjustment is idempotent and audited', async () => { const u = await user(), k = key(); await points.adjust(operator.id, u.id, 1500, '测试补偿', k); await points.adjust(operator.id, u.id, 1500, '测试补偿', k); assert.equal((await balance(u.id)).availablePoints, 1500); assert.equal(await db.pointLedger.count({ where: { account: { userId: u.id } } }), 1); await rejects(() => points.adjust(operator.id, u.id, 1600, '测试补偿', k)); });
  await test('compensation can be reduced without a negative balance', async () => { const u = await funded(500); await points.adjust(operator.id, u.id, -200, '撤回补偿', key()); assert.equal((await balance(u.id)).availablePoints, 300); await rejects(() => points.adjust(operator.id, u.id, -400, '撤回补偿', key())); });
  await test('real or mock paid points cannot be removed as compensation', async () => { const { u } = await paid(); await rejects(() => points.adjust(operator.id, u.id, -1, '错误调账', key())); assert.equal((await balance(u.id)).availablePoints, 5000); });
  await test('duplicate recharge creation returns one order and rejects changed amounts', async () => { const u = await user(), k = key(); const [a,b] = await Promise.all([points.createRecharge(u.id, 500, k), points.createRecharge(u.id, 500, k)]); assert.equal(a.id,b.id); await rejects(() => points.createRecharge(u.id,600,k),'IDEMPOTENCY_CONFLICT'); });
  await test('recharge minimum and maximum are enforced', async () => { const u = await user(); await rejects(() => points.createRecharge(u.id,499,key())); await rejects(() => points.createRecharge(u.id,50001,key())); });
  await test('pending recharge exposure cannot bypass the daily limit concurrently', async () => { const u = await user(); const results = await Promise.allSettled([points.createRecharge(u.id,30000,key()),points.createRecharge(u.id,30000,key())]); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); });
  await test('payment requires a submitted trusted result and credits only once', async () => { const u = await user(), r = await points.createRecharge(u.id,1000,key()); await points.checkRecharge(u.id,r.id); assert.equal((await balance(u.id)).availablePoints,0); await points.demoPay(u.id,r.id,'SUCCESS'); await Promise.all([points.demoPay(u.id,r.id,'SUCCESS'),points.checkRecharge(u.id,r.id)]); assert.equal((await balance(u.id)).availablePoints,1000); assert.equal(await db.pointLot.count({where:{rechargeId:r.id}}),1); });
  await test('unknown payment preserves zero balance until lookup confirms success', async () => { const u = await user(), r = await points.createRecharge(u.id,1000,key()); assert.equal((await points.demoPay(u.id,r.id,'UNKNOWN_SUCCESS')).status,'CHECKING'); assert.equal((await balance(u.id)).availablePoints,0); assert.equal((await points.checkRecharge(u.id,r.id)).status,'PAID'); assert.equal((await balance(u.id)).availablePoints,1000); });
  await test('definite payment failure creates no points', async () => { const u=await user(),r=await points.createRecharge(u.id,1000,key()); assert.equal((await points.demoPay(u.id,r.id,'FAILURE')).status,'FAILED'); assert.equal((await balance(u.id)).availablePoints,0); });
  await test('users cannot read another user recharge or intent', async () => { const a=await user(),b=await user(),p=await phone(),r=await points.createRecharge(a.id,500,key()),i=await points.createIntent(a.id,{kind:'RENT',number:p.number,term:7,quoteVersion:1}); await rejects(()=>points.recharge(b.id,r.id)); await rejects(()=>points.intent(b.id,i.id)); });
  await test('insufficient funds create no order or number reservation', async () => { const u=await funded(500),p=await phone(); await rejects(()=>buy(u,p),'INSUFFICIENT_POINTS'); assert.equal((await db.phoneNumber.findUniqueOrThrow({where:{id:p.id}})).occupied,false); assert.equal(await db.order.count({where:{userId:u.id}}),0); });
  await test('two concurrent purchases cannot overspend one balance', async () => { const u=await funded(1500),a=await phone(),b=await phone(); const result=await Promise.allSettled([buy(u,a),buy(u,b)]); assert.equal(result.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(result.map(r=>r.status==='rejected' ? {message:r.reason.message,response:r.reason.getResponse?.()} : r.value))); const w=await balance(u.id); assert.equal(w.availablePoints,300);assert.equal(w.frozenPoints,1200); });
  await test('one inventory number cannot be sold to two users', async () => { const a=await funded(),b=await funded(),p=await phone(); const result=await Promise.allSettled([buy(a,p),buy(b,p)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1); });
  await test('purchase replay freezes once and completed replay creates one lease', async () => { const u=await funded(),p=await phone(),k=key();const [a,b]=await Promise.all([buy(u,p,k),buy(u,p,k)]);assert.equal(a.orderId,b.orderId);assert.equal((await balance(u.id)).frozenPoints,1200);const done=await fulfillment.run(u.id,a.orderId);assert.equal(done.status,'DEMO_CONFIRMED');await fulfillment.run(u.id,a.orderId);assert.equal((await balance(u.id)).availablePoints,3800);assert.equal((await balance(u.id)).frozenPoints,0);assert.equal(await db.lease.count({where:{userId:u.id}}),1); });
  await test('definite fulfillment failure releases the same sources without extra credit', async () => { const u=await funded(),p=await phone(),o=await buy(u,p,key(),'FAILURE');await fulfillment.run(u.id,o.orderId);await fulfillment.run(u.id,o.orderId);assert.equal((await balance(u.id)).availablePoints,5000);assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await db.phoneNumber.findUniqueOrThrow({where:{id:p.id}})).occupied,false); });
  for(const scenario of ['UNKNOWN_SUCCESS','UNKNOWN_FAILURE']) await test(`${scenario} keeps points frozen until lookup settles once`,async()=>{const u=await funded(),p=await phone(),o=await buy(u,p,key(),scenario);assert.equal((await fulfillment.run(u.id,o.orderId)).status,'UNCERTAIN');assert.equal((await balance(u.id)).frozenPoints,1200);assert.equal(await db.lease.count({where:{userId:u.id}}),0);const done=await fulfillment.run(u.id,o.orderId,true);assert.equal(done.status,scenario.endsWith('SUCCESS')?'DEMO_CONFIRMED':'FAILED');assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await balance(u.id)).availablePoints,scenario.endsWith('SUCCESS')?3800:5000);});
  await test('renewal uses points and replay extends the lease once',async()=>{const u=await funded(),p=await phone(),o=await buy(u,p),done=await fulfillment.run(u.id,o.orderId);const before=await db.lease.findUniqueOrThrow({where:{id:done.leaseId}}),k=key();await leases.renew(u.id,done.leaseId,7,k,1);await leases.renew(u.id,done.leaseId,7,k,1);const after=await db.lease.findUniqueOrThrow({where:{id:done.leaseId}});assert.equal(after.expiresAt.getTime()-before.expiresAt.getTime(),7*86400000);assert.equal((await balance(u.id)).availablePoints,2600);});
  await test('old quotation cannot silently purchase a changed price',async()=>{const u=await funded(),p=await phone();await rejects(()=>buy(u,p,key(),'SUCCESS',{quoteVersion:999}),'QUOTE_CHANGED');assert.equal((await balance(u.id)).frozenPoints,0);});
  await test('purchase intent survives recharge and is consumed only once',async()=>{const u=await user(),p=await phone(),i=await points.createIntent(u.id,{kind:'RENT',number:p.number,term:7,quoteVersion:1}),r=await points.createRecharge(u.id,2000,key(),i.id);await points.demoPay(u.id,r.id,'SUCCESS');assert.equal(await db.order.count({where:{userId:u.id}}),0);const a=await buy(u,p,key(),'SUCCESS',{purchaseIntentId:i.id}),b=await buy(u,p,key(),'SUCCESS',{purchaseIntentId:i.id});assert.equal(a.orderId,b.orderId);assert.equal((await balance(u.id)).frozenPoints,1200);});
  await test('refund request does not freeze until approval; success settles once',async()=>{const {u,r}=await paid(2000),k=key(),a=await points.requestRefund(u.id,r.id,500,'测试退款',k),b=await points.requestRefund(u.id,r.id,500,'测试退款',k);assert.equal(a.id,b.id);assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await points.approveRefund(operator.id,a.id,'核准退款')).status,'SUCCEEDED');await points.approveRefund(operator.id,a.id,'重复审核');assert.equal((await balance(u.id)).availablePoints,1500);assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await db.rechargeOrder.findUniqueOrThrow({where:{id:r.id}})).refundedMinor,500);});
  await test('unknown cash refund preserves frozen points then lookup completes',async()=>{const {u,r}=await paid(2000),a=await points.requestRefund(u.id,r.id,500,'测试退款',key());assert.equal((await points.approveRefund(operator.id,a.id,'核准退款','UNKNOWN_SUCCESS')).status,'UNKNOWN');assert.equal((await balance(u.id)).frozenPoints,500);assert.equal((await points.runRefund(a.id)).status,'SUCCEEDED');assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await balance(u.id)).availablePoints,1500);});
  await test('failed cash refund releases points and principal quota',async()=>{const {u,r}=await paid(2000),a=await points.requestRefund(u.id,r.id,500,'测试退款',key());assert.equal((await points.approveRefund(operator.id,a.id,'核准退款','FAILURE')).status,'FAILED');assert.equal((await balance(u.id)).availablePoints,2000);assert.equal((await balance(u.id)).frozenPoints,0);assert.equal((await db.rechargeOrder.findUniqueOrThrow({where:{id:r.id}})).refundReservedMinor,0);});
  await test('approval rechecks balance spent after request',async()=>{const {u,r}=await paid(2000),a=await points.requestRefund(u.id,r.id,1500,'测试退款',key()),p=await phone();await buy(u,p);await rejects(()=>points.approveRefund(operator.id,a.id,'核准退款'));assert.equal((await balance(u.id)).frozenPoints,1200);assert.equal((await db.refundOrder.findUniqueOrThrow({where:{id:a.id}})).status,'REQUESTED');});
  await test('compensation is consumed first and refunds restore original source',async()=>{const {u,r}=await paid(2000);await points.adjust(operator.id,u.id,500,'测试补偿',key());const p=await phone(),o=await buy(u,p);await fulfillment.run(u.id,o.orderId);const comp=await db.pointLot.findFirstOrThrow({where:{account:{userId:u.id},source:'COMPENSATION'}});assert.equal(comp.availablePoints,0);const k=key();await points.refundConsumption(operator.id,o.orderId,1200,'服务退分',k);await points.refundConsumption(operator.id,o.orderId,1200,'服务退分',k);const c=await db.pointLot.findUniqueOrThrow({where:{id:comp.id}}),paidLot=await db.pointLot.findUniqueOrThrow({where:{rechargeId:r.id}});assert.equal(c.availablePoints,500);assert.equal(paidLot.availablePoints,2000);await rejects(()=>points.refundConsumption(operator.id,o.orderId,1,'重复退分',key()));});
  await test('frozen compensation cannot be adjusted away',async()=>{const u=await funded(1200),p=await phone();await buy(u,p);await rejects(()=>points.adjust(operator.id,u.id,-1,'撤回补偿',key()));assert.equal((await balance(u.id)).frozenPoints,1200);});
  await test('restricted wallets retain statements but reject new spending',async()=>{const u=await funded(),p=await phone();await db.pointAccount.update({where:{userId:u.id},data:{status:'REVIEW'}});await rejects(()=>buy(u,p));assert.equal((await balance(u.id)).availablePoints,5000);assert.equal((await points.history(u.id,'ledger',20)).items.length,1);});
  await test('admin plan prices keep points and quotation versions in sync',async()=>{const p=await ops.createPlan(operator.id,{days:21,priceMinor:500,label:'测试套餐',note:'',sortOrder:0,active:true,reason:'测试建套餐'},key());assert.equal(p.pointsPrice,500);assert.equal(p.version,1);const updated=await ops.updatePlan(operator.id,p.id,{priceMinor:700,label:'测试套餐',note:'',sortOrder:0,active:true,reason:'测试改套餐'},key());assert.equal(updated.pointsPrice,700);assert.equal(updated.version,2);});
  await test('admin cash assignment and extension are blocked; free compensation remains available',async()=>{const u=await user(),p=await phone();await rejects(()=>ops.assignNumber(operator.id,p.id,{userId:u.id,term:7,amountMinor:1200,reason:'收费应禁止'},key()),'POINTS_REQUIRED');assert.equal(await db.lease.count({where:{userId:u.id}}),0);const l=await ops.assignNumber(operator.id,p.id,{userId:u.id,term:7,amountMinor:0,reason:'免费补偿开通'},key());const o=await db.order.findFirstOrThrow({where:{leaseId:l.id}});assert.equal(o.settlementType,'COMPENSATION');await rejects(()=>ops.extendLease(operator.id,l.id,{days:7,amountMinor:100,reason:'收费应禁止'},key()),'POINTS_REQUIRED');await ops.extendLease(operator.id,l.id,{days:7,amountMinor:0,reason:'免费补偿延期'},key());});
  await test('mock payment never contributes to real cash statistics',async()=>{const s=await ops.summary();assert.equal(s.todayRevenueMinor,0);const p=await points.adminSummary();assert.equal(p.cashReceivedMinor,0);assert.equal(p.cashRefundedMinor,0);assert(p.consumedPoints>=0);});
  await test('all account totals agree with lots and journal',async()=>{for(const a of await db.pointAccount.findMany()){const result=await points.reconcile(a.userId,operator.id,'测试核对');assert.equal(result.balanced,true,`Account ${a.id} reconciles`);}});
  console.log(`\n${count} points integration tests passed; disposable database ${name} removed after run.`);
} catch (error) {
  console.error(`FAIL after ${count} passing tests:`, error.message, error.getResponse?.() ?? '');
  console.error(String(error.stack).split('\n').filter(line => line.includes('scripts/test-points')).join('\n'));
  process.exitCode = 1;
} finally {
  if(db) await db.$disconnect();
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await adminPool.end();
}
