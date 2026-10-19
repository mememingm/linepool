import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { transaction } from './db.mjs';
import { createLeaseService } from './leases.mjs';
import { MockSmsProvider } from './providers.mjs';

const ACTIVE = new Set(['PAYMENT_PENDING', 'ALLOCATING', 'WAITING_SMS']);
const POLICY = { refundOnExpiry: true, refundOnCancel: true, refundOnFailure: true, cooldownSeconds: 60, blockSameServiceAfterUse: true };
const iso = value => new Date(value).toISOString();
const id = prefix => `${prefix}_${randomUUID()}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const stateOf = row => row.order_state ?? row.status;
const rulesOf = row => ({ ...POLICY, ...JSON.parse(row.policy_json) });
export class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

export function createService(db, { now = Date.now, provider = new MockSmsProvider(), adminToken = '' } = {}) {
  const changes = new EventEmitter();
  changes.setMaxListeners(100);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const notify = viewerId => changes.emit('change', viewerId);
  const audit = (actor, action, target, detail) => run('INSERT INTO audit_log VALUES (?,?,?,?,?,?)', id('aud'), actor, action, target, JSON.stringify(detail), now());
  function requireViewer(viewerId) {
    if (!one('SELECT id FROM viewers WHERE id = ?', viewerId)) fail(401, 'SESSION_REQUIRED', 'Open the local test workspace first.');
  }
  function ownedTask(viewerId, taskId) {
    requireViewer(viewerId);
    const task = one('SELECT * FROM tasks WHERE id = ? AND viewer_id = ?', taskId, viewerId);
    if (!task) fail(404, 'TASK_NOT_FOUND', 'Order not found in this workspace.');
    return task;
  }
  function change(taskId, state, detail) {
    const legacy = state === 'PAYMENT_PENDING' ? 'ALLOCATING' : ['ALLOCATION_FAILED', 'SMS_FAILED'].includes(state) ? 'REVIEW_REQUIRED' : state;
    run('UPDATE tasks SET status = ?, order_state = ? WHERE id = ?', legacy, state, taskId);
    run('INSERT INTO order_events VALUES (?,?,?,?,?)', id('evt'), taskId, state, detail, now());
  }
  function walletEntry(viewerId, taskId, kind, balanceDelta, heldDelta, key) {
    const previous = one('SELECT * FROM wallet_transactions WHERE viewer_id = ? AND idempotency_key = ?', viewerId, key);
    if (previous) return previous;
    run('UPDATE wallets SET balance_cents = balance_cents + ?, held_cents = held_cents + ? WHERE viewer_id = ?', balanceDelta, heldDelta, viewerId);
    const wallet = one('SELECT * FROM wallets WHERE viewer_id = ?', viewerId);
    if (!wallet || wallet.balance_cents < 0 || wallet.held_cents < 0) fail(409, 'INSUFFICIENT_BALANCE', 'Insufficient test credits.');
    const entry = { id: id('txn'), viewerId, taskId, kind, balanceDelta, heldDelta, balanceAfter: wallet.balance_cents, heldAfter: wallet.held_cents, createdAt: iso(now()), isTest: true };
    run('INSERT INTO wallet_transactions VALUES (?,?,?,?,?,?,?,?,?,?)', entry.id, viewerId, taskId, kind, balanceDelta, heldDelta, wallet.balance_cents, wallet.held_cents, key, now());
    return entry;
  }
  function ensureWallet(viewerId) {
    if (one('SELECT 1 FROM wallets WHERE viewer_id = ?', viewerId)) return;
    run('INSERT INTO wallets (viewer_id,balance_cents) VALUES (?,0)', viewerId);
    walletEntry(viewerId, null, 'TEST_CREDIT', 5000, 0, 'initial-test-credit');
  }
  const eligibleSql = `SELECT r.* FROM resources r JOIN number_services ns ON ns.resource_id = r.id
    WHERE r.purpose = 'SHARED' AND r.online = 1 AND r.source = 'mock' AND r.country_code = ? AND r.cooldown_until <= ?
    AND ns.service_id = ? AND ns.state = 'AVAILABLE' AND ns.cooldown_until <= ?
    AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.resource_id = r.id AND a.ended_at IS NULL)
    ORDER BY r.id`;
  const eligible = product => all(eligibleSql, product.country_code, now(), product.service_id, now());
  function settle(row, kind) {
    row = one('SELECT * FROM tasks WHERE id = ?', row.id);
    if (row.settlement_state !== 'RESERVED' && row.settlement_state !== 'REVIEW_REQUIRED') return;
    walletEntry(row.viewer_id, row.id, kind, kind === 'REFUND' ? row.price_cents : 0, -row.price_cents, `${kind}-${row.id}`);
    run('UPDATE tasks SET billing_state = ?, settlement_state = ? WHERE id = ?', kind === 'CAPTURE' ? 'TEST_PAID' : 'TEST_REFUNDED', kind === 'CAPTURE' ? 'TEST_SETTLED' : 'TEST_REFUNDED', row.id);
  }
  function finish(row, state, detail, endedAt = now()) {
    row = one('SELECT * FROM tasks WHERE id = ?', row.id);
    if (!ACTIVE.has(stateOf(row))) return;
    const rules = rulesOf(row);
    const assignment = one('SELECT * FROM assignments WHERE task_id = ?', row.id);
    if (assignment && assignment.ended_at === null) {
      const product = one('SELECT service_id FROM products WHERE id = ?', row.product_id);
      const cooldown = endedAt + rules.cooldownSeconds * 1000;
      run('UPDATE assignments SET ended_at = ? WHERE id = ?', endedAt, assignment.id);
      run('UPDATE resources SET cooldown_until = MAX(cooldown_until,?) WHERE id = ?', cooldown, assignment.resource_id);
      run(`UPDATE number_services SET state = ?, cooldown_until = MAX(cooldown_until,?), reason = ? WHERE resource_id = ? AND service_id = ?`,
        state === 'COMPLETED' || rules.blockSameServiceAfterUse ? 'USED' : 'AVAILABLE', cooldown, 'Order ended; successful use is never reset to fresh inventory.', assignment.resource_id, product.service_id);
      run('UPDATE usage_history SET ended_at = ?, outcome = ? WHERE assignment_id = ?', endedAt, state, assignment.id);
    }
    change(row.id, state, detail);
    if (state === 'COMPLETED') settle(row, 'CAPTURE');
    else if ((state === 'CANCELLED' && rules.refundOnCancel) || (state === 'EXPIRED' && rules.refundOnExpiry) || (['ALLOCATION_FAILED', 'SMS_FAILED'].includes(state) && rules.refundOnFailure)) settle(row, 'REFUND');
    else if (row.settlement_state === 'RESERVED') run("UPDATE tasks SET settlement_state = 'REVIEW_REQUIRED' WHERE id = ?", row.id);
  }
  const leases = createLeaseService(db, { now, provider, fail, requireViewer, walletEntry, notify, audit });
  function expire(at = now()) {
    leases.expireLeases();
    const viewers = transaction(db, () => {
      const rows = all(`SELECT * FROM tasks WHERE COALESCE(order_state,status) IN ('PAYMENT_PENDING','WAITING_SMS','ALLOCATING') AND expires_at <= ?`, at);
      for (const row of rows) finish(row, 'EXPIRED', 'Server deadline reached.', row.expires_at);
      return new Set(rows.map(r => r.viewer_id));
    });
    for (const viewerId of viewers) notify(viewerId);
  }
  function taskView(row) {
    const assignment = one('SELECT a.*,r.phone FROM assignments a JOIN resources r ON r.id = a.resource_id WHERE task_id = ?', row.id);
    const messages = assignment ? all(`SELECT * FROM messages WHERE assignment_id = ? AND received_at >= ? AND received_at <= ? ORDER BY received_at,id`,
      assignment.id, assignment.started_at, assignment.ended_at ?? row.expires_at).map(m => ({ id: m.id, text: m.text, code: m.code, receivedAt: iso(m.received_at), isDemo: true })) : [];
    return { id: row.id, orderId: one('SELECT id FROM orders WHERE task_id = ?', row.id).id, productId: row.product_id,
      service: row.service, country: row.country, countryCode: row.country_code, phone: assignment?.phone ?? null,
      status: stateOf(row), createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), priceCents: row.price_cents, currency: row.currency,
      paymentStatus: row.billing_state, settlementStatus: row.settlement_state, canCancel: Boolean(row.can_cancel), rules: rulesOf(row),
      events: all('SELECT state,detail,created_at FROM order_events WHERE task_id = ? ORDER BY rowid', row.id).map(e => ({ state: e.state, detail: e.detail, createdAt: iso(e.created_at) })),
      messages, isDemo: true };
  }
  function products() {
    return all('SELECT p.*,s.enabled AS service_enabled FROM products p JOIN services s ON s.id = p.service_id ORDER BY p.service,p.country').map(p => ({
      id: p.id, service: p.service, serviceId: p.service_id, country: p.country, countryCode: p.country_code,
      priceCents: p.price_cents, currency: p.currency, durationSeconds: p.duration_seconds,
      stock: p.enabled && p.service_enabled && provider.mode === 'mock' ? eligible(p).length : 0,
      enabled: Boolean(p.enabled && p.service_enabled), canCancel: Boolean(p.can_cancel), rules: rulesOf(p), description: p.description, iconKey: p.icon_key,
    }));
  }
  function snapshot(viewerId) {
    const viewer = one('SELECT * FROM viewers WHERE id = ?', viewerId);
    const tasks = all('SELECT * FROM tasks WHERE viewer_id = ? ORDER BY created_at DESC,id', viewerId).map(taskView);
    const orders = tasks.map(t => ({ id: t.orderId, taskId: t.id, service: t.service, country: t.country, countryCode: t.countryCode, phone: t.phone,
      status: t.status, priceCents: t.priceCents, currency: t.currency, paymentStatus: t.paymentStatus,
      allocationStatus: t.phone ? 'ALLOCATED' : ACTIVE.has(t.status) ? 'ALLOCATING' : 'NOT_ALLOCATED', settlementStatus: t.settlementStatus, createdAt: t.createdAt }));
    const wallet = one('SELECT * FROM wallets WHERE viewer_id = ?', viewerId);
    const ledger = all('SELECT * FROM wallet_transactions WHERE viewer_id = ? ORDER BY created_at DESC,rowid DESC', viewerId).map(r => ({
      id: r.id, taskId: r.task_id, kind: r.kind, balanceDelta: r.balance_delta, heldDelta: r.held_delta,
      balanceAfter: r.balance_after, heldAfter: r.held_after, createdAt: iso(r.created_at), isTest: true,
    }));
    return { ...leases.leaseSnapshot(viewerId), viewer: { id: viewer.id, name: viewer.name, email: viewer.email }, products: products(), tasks, orders, ledger,
      wallet: { balanceCents: wallet.balance_cents, heldCents: wallet.held_cents, currency: wallet.currency, isTest: true },
      preferences: { theme: viewer.theme }, serverNow: iso(now()), mode: 'demo', provider: provider.mode, version: 3 };
  }
  function createTask(viewerId, body) {
    requireViewer(viewerId);
    if (!body || Object.keys(body).some(key => !['productId', 'expectedPriceCents', 'idempotencyKey'].includes(key)) ||
      typeof body.productId !== 'string' || !Number.isSafeInteger(body.expectedPriceCents) || body.expectedPriceCents < 0 ||
      typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.idempotencyKey)) fail(400, 'INVALID_INPUT', 'Supply productId, expectedPriceCents and a valid idempotencyKey.');
    expire();
    const result = transaction(db, () => {
      const payload = JSON.stringify({ productId: body.productId, expectedPriceCents: body.expectedPriceCents });
      const previous = one('SELECT * FROM idempotency WHERE viewer_id = ? AND key = ?', viewerId, body.idempotencyKey);
      if (previous) {
        if (previous.payload !== payload) fail(409, 'IDEMPOTENCY_CONFLICT', 'This request key belongs to another purchase.');
        return { task: taskView(ownedTask(viewerId, previous.task_id)), replayed: true };
      }
      const product = one('SELECT p.*,s.enabled AS service_enabled FROM products p JOIN services s ON s.id = p.service_id WHERE p.id = ?', body.productId);
      if (!product?.enabled || !product.service_enabled) fail(409, 'PRODUCT_UNAVAILABLE', 'This test service is unavailable.');
      if (provider.mode !== 'mock') fail(503, 'PROVIDER_UNAVAILABLE', 'Live provider integration is not enabled.');
      if (product.price_cents !== body.expectedPriceCents) fail(409, 'PRICE_CHANGED', 'The configured price changed. Review the order again.');
      const resource = eligible(product)[0];
      if (!resource) fail(409, 'OUT_OF_STOCK', 'No eligible test numbers for this platform and country.');
      ensureWallet(viewerId);
      if (one('SELECT balance_cents FROM wallets WHERE viewer_id = ?', viewerId).balance_cents < product.price_cents) fail(409, 'INSUFFICIENT_BALANCE', 'Insufficient test credits.');
      const at = now();
      const taskId = id('tsk');
      run(`INSERT INTO tasks (id,viewer_id,product_id,service,country,country_code,price_cents,currency,can_cancel,product_version,status,created_at,expires_at,policy_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,'ALLOCATING',?,?,?)`, taskId, viewerId, product.id, product.service, product.country, product.country_code,
        product.price_cents, product.currency, product.can_cancel, product.version, at, at + product.duration_seconds * 1000, product.policy_json);
      run('INSERT INTO orders (id,task_id) VALUES (?,?)', id('ord'), taskId);
      change(taskId, 'PAYMENT_PENDING', 'Test credit authorization requested; no real payment.');
      walletEntry(viewerId, taskId, 'HOLD', -product.price_cents, product.price_cents, `HOLD-${taskId}`);
      run("UPDATE tasks SET billing_state = 'TEST_HELD', settlement_state = 'RESERVED' WHERE id = ?", taskId);
      change(taskId, 'ALLOCATING', 'Test credits reserved. Allocating one exclusive number.');
      try { provider.assertResource(resource); }
      catch {
        finish(ownedTask(viewerId, taskId), 'ALLOCATION_FAILED', 'Provider rejected this resource.');
        run('INSERT INTO idempotency VALUES (?,?,?,?)', viewerId, body.idempotencyKey, payload, taskId);
        return { task: taskView(ownedTask(viewerId, taskId)), replayed: false };
      }
      const assignmentId = id('asn');
      run('INSERT INTO assignments (id,resource_id,task_id,started_at) VALUES (?,?,?,?)', assignmentId, resource.id, taskId, at);
      run('INSERT INTO usage_history (id,assignment_id,resource_id,service_id,task_id,started_at) VALUES (?,?,?,?,?,?)', id('use'), assignmentId, resource.id, product.service_id, taskId, at);
      change(taskId, 'WAITING_SMS', 'Number assigned. Waiting for a correlated SMS event.');
      run('INSERT INTO idempotency VALUES (?,?,?,?)', viewerId, body.idempotencyKey, payload, taskId);
      return { task: taskView(ownedTask(viewerId, taskId)), replayed: false };
    });
    notify(viewerId);
    return result;
  }
  function receiveSms(event) {
    if (event && Object.hasOwn(event, 'leaseId')) return leases.receiveLeaseSms(event);
    if (provider.mode !== 'mock') fail(503, 'PROVIDER_UNAVAILABLE', 'Live provider callback correlation is not configured.');
    const keys = ['provider', 'eventId', 'messageId', 'resourceId', 'serviceId', 'assignmentId', 'occurredAt', 'text'];
    if (!event || keys.some(k => typeof event[k] !== 'string') || event.provider !== 'mock' ||
      keys.some(k => event[k].length > (k === 'text' ? 4000 : 180)) || !event.eventId || !event.messageId ||
      !Number.isFinite(Date.parse(event.occurredAt))) fail(400, 'INVALID_SMS_EVENT', 'Supply a bounded, normalized mock SMS event.');
    expire();
    let owner;
    const result = transaction(db, () => {
      const payloadHash = hash(JSON.stringify(keys.filter(k => k !== 'eventId').map(k => event[k])));
      const prior = one('SELECT * FROM incoming_sms WHERE provider = ? AND (event_id = ? OR message_id = ?)', event.provider, event.eventId, event.messageId);
      if (prior) {
        if (prior.payload_hash !== payloadHash) fail(409, 'EVENT_CONFLICT', 'Event or message ID was already used with different content.');
        return { id: prior.id, status: prior.status, reason: prior.reason, replayed: true };
      }
      const incomingId = id('sms');
      const occurredAt = Date.parse(event.occurredAt);
      run('INSERT INTO incoming_sms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', incomingId, event.provider, event.eventId, event.messageId, payloadHash,
        event.resourceId, event.serviceId, event.assignmentId, event.text, occurredAt, now(), 'RECEIVED', '');
      const assignment = one(`SELECT a.*,p.service_id,t.viewer_id,t.expires_at,t.order_state,t.status FROM assignments a
        JOIN tasks t ON t.id = a.task_id JOIN products p ON p.id = t.product_id WHERE a.id = ?`, event.assignmentId);
      let reason = '';
      if (!assignment || assignment.resource_id !== event.resourceId || assignment.service_id !== event.serviceId) reason = 'UNCONFIRMED_ASSIGNMENT';
      else if (assignment.ended_at !== null || stateOf(assignment) !== 'WAITING_SMS') reason = 'ORDER_NOT_ACTIVE';
      else if (occurredAt < assignment.started_at || occurredAt > now() || occurredAt >= assignment.expires_at) reason = 'OUTSIDE_ORDER_WINDOW';
      const codes = [...event.text.matchAll(/(?<!\d)\d{4,8}(?!\d)/g)].map(m => m[0]);
      if (!reason && codes.length !== 1) reason = 'AMBIGUOUS_OR_MISSING_CODE';
      if (reason) {
        run("UPDATE incoming_sms SET status = 'QUARANTINED', reason = ? WHERE id = ?", reason, incomingId);
        return { id: incomingId, status: 'QUARANTINED', reason, replayed: false };
      }
      run('INSERT INTO messages (id,assignment_id,text,code,received_at) VALUES (?,?,?,?,?)', incomingId, assignment.id, event.text, codes[0], occurredAt);
      run("UPDATE incoming_sms SET status = 'MATCHED' WHERE id = ?", incomingId);
      const row = one('SELECT * FROM tasks WHERE id = ?', assignment.task_id);
      finish(row, 'COMPLETED', 'Correlated test SMS accepted; test charge settled.');
      owner = row.viewer_id;
      return { id: incomingId, status: 'MATCHED', taskId: row.id, replayed: false };
    });
    if (owner) notify(owner);
    return result;
  }
  function adminSnapshot() {
    expire();
    const resources = all(`SELECT r.*,a.task_id FROM resources r LEFT JOIN assignments a ON a.resource_id = r.id AND a.ended_at IS NULL ORDER BY r.id`).map(r => ({
      id: r.id, phone: r.phone, countryCode: r.country_code, source: r.source, online: Boolean(r.online), taskId: r.task_id ?? null,
      cooldownUntil: iso(r.cooldown_until), costCents: r.cost_cents,
      platforms: all('SELECT ns.*,s.name FROM number_services ns JOIN services s ON s.id = ns.service_id WHERE ns.resource_id = ?', r.id).map(s => ({ id: s.service_id, name: s.name, state: s.state, cooldownUntil: iso(s.cooldown_until) })),
      uses: one('SELECT count(*) AS n FROM usage_history WHERE resource_id = ?', r.id).n,
      successes: one("SELECT count(*) AS n FROM usage_history WHERE resource_id = ? AND outcome = 'COMPLETED'", r.id).n,
      revenueCents: one(`SELECT COALESCE(SUM(t.price_cents),0) AS n FROM tasks t JOIN assignments a ON a.task_id = t.id WHERE a.resource_id = ? AND t.settlement_state = 'TEST_SETTLED'`, r.id).n,
    }));
    const ranks = key => all(`SELECT ${key} AS name,COUNT(*) AS count,COALESCE(SUM(CASE WHEN settlement_state = 'TEST_SETTLED' THEN price_cents ELSE 0 END),0) AS revenueCents,
      SUM(CASE WHEN COALESCE(order_state,status) = 'COMPLETED' THEN 1 ELSE 0 END) AS successes FROM tasks WHERE order_state IS NOT NULL GROUP BY ${key} ORDER BY revenueCents DESC`);
    const total = one('SELECT count(*) AS n FROM tasks WHERE order_state IS NOT NULL').n;
    const ended = one("SELECT count(*) AS n FROM tasks WHERE order_state IS NOT NULL AND order_state NOT IN ('PAYMENT_PENDING','ALLOCATING','WAITING_SMS')").n;
    const successful = one("SELECT count(*) AS n FROM tasks WHERE order_state = 'COMPLETED'").n;
    return { ...leases.adminLeaseSnapshot(), mode: 'demo', resources, products: products(), services: all('SELECT * FROM services ORDER BY name'),
      orders: all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200').map(taskView),
      exceptions: all("SELECT id,event_id,message_id,reason,received_at FROM incoming_sms WHERE status = 'QUARANTINED' ORDER BY received_at DESC LIMIT 100"),
      pendingSettlements: all("SELECT id,viewer_id,price_cents,order_state FROM tasks WHERE settlement_state = 'REVIEW_REQUIRED'"),
      audit: all('SELECT * FROM audit_log ORDER BY created_at DESC,rowid DESC LIMIT 100'),
      stats: { totalOrders: total, completedOrders: successful, successRate: ended ? successful / ended : 0,
        revenueCents: one("SELECT COALESCE(SUM(price_cents),0) AS n FROM tasks WHERE settlement_state = 'TEST_SETTLED'").n,
        resourceCostCents: resources.reduce((sum, r) => sum + r.costCents, 0), reuseCount: resources.reduce((sum, r) => sum + Math.max(0, r.uses - 1), 0),
        byService: ranks('service'), byCountry: ranks('country') } };
  }
  return {
    ...leases, expire, createTask, receiveSms, adminSnapshot,
    subscribe(viewerId, listener) {
      const handler = changed => { if (changed === viewerId) listener(); };
      changes.on('change', handler);
      return () => changes.off('change', handler);
    },
    bootstrap(token) {
      expire();
      const existing = typeof token === 'string' ? one('SELECT viewer_id FROM sessions WHERE token = ?', token) : null;
      let viewerId = existing?.viewer_id;
      const newToken = existing ? token : randomBytes(32).toString('hex');
      transaction(db, () => {
        if (!viewerId) {
          viewerId = id('demo');
          run('INSERT INTO viewers (id,name,email) VALUES (?,?,?)', viewerId, 'Test workspace', 'demo@once.invalid');
          run('INSERT INTO sessions VALUES (?,?)', newToken, viewerId);
        }
        ensureWallet(viewerId);
      });
      return { token: newToken, isNew: !existing, data: snapshot(viewerId) };
    },
    viewerForSession(token) {
      const session = typeof token === 'string' ? one('SELECT viewer_id FROM sessions WHERE token = ?', token) : null;
      if (!session) fail(401, 'SESSION_REQUIRED', 'Open the local workspace first.');
      return session.viewer_id;
    },
    getTask(viewerId, taskId) { expire(); return taskView(ownedTask(viewerId, taskId)); },
    cancelTask(viewerId, taskId) {
      expire();
      const result = transaction(db, () => {
        const row = ownedTask(viewerId, taskId);
        if (stateOf(row) === 'CANCELLED') return { task: taskView(row), replayed: true };
        if (!ACTIVE.has(stateOf(row)) || !row.can_cancel) fail(409, 'CANNOT_CANCEL', 'This order cannot be cancelled under its captured rules.');
        finish(row, 'CANCELLED', 'Customer cancelled the order.');
        return { task: taskView(ownedTask(viewerId, taskId)), replayed: false };
      });
      notify(viewerId); return result;
    },
    topUp(viewerId, body) {
      requireViewer(viewerId);
      if (!body || !Number.isSafeInteger(body.amountCents) || body.amountCents < 100 || body.amountCents > 10000 ||
        typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.idempotencyKey)) fail(400, 'INVALID_INPUT', 'Test credit amount must be 100-10000 cents with a request key.');
      const result = transaction(db, () => {
        ensureWallet(viewerId);
        const key = `credit-${body.idempotencyKey}`;
        const prior = one('SELECT * FROM wallet_transactions WHERE viewer_id = ? AND idempotency_key = ?', viewerId, key);
        if (prior && prior.balance_delta !== body.amountCents) fail(409, 'IDEMPOTENCY_CONFLICT', 'This credit request was used with another amount.');
        walletEntry(viewerId, null, 'TEST_CREDIT', body.amountCents, 0, key);
        return { wallet: snapshot(viewerId).wallet, replayed: Boolean(prior), isTest: true };
      });
      notify(viewerId); return result;
    },
    feedback(viewerId, taskId, body) {
      ownedTask(viewerId, taskId);
      if (!body || typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 2000) fail(400, 'INVALID_INPUT', 'Feedback must contain 1-2000 characters.');
      const feedback = { id: id('fb'), taskId, message: body.message.trim(), createdAt: iso(now()), isDemo: true };
      run('INSERT INTO feedback VALUES (?,?,?,?,?)', feedback.id, taskId, viewerId, feedback.message, now());
      return { feedback };
    },
    preferences(viewerId, body) {
      requireViewer(viewerId);
      if (!body || !['light', 'dark'].includes(body.theme)) fail(400, 'INVALID_INPUT', 'Theme must be light or dark.');
      run('UPDATE viewers SET theme = ? WHERE id = ?', body.theme, viewerId);
      return { preferences: { theme: body.theme } };
    },
    loginAdmin(body) {
      if (!adminToken || typeof body?.token !== 'string' || !timingSafeEqual(Buffer.from(hash(body.token)), Buffer.from(hash(adminToken)))) fail(403, 'ADMIN_REQUIRED', 'A separate local administrator token is required.');
      const token = randomBytes(32).toString('hex');
      run('DELETE FROM admin_sessions WHERE expires_at <= ?', now());
      run('INSERT INTO admin_sessions VALUES (?,?)', token, now() + 3_600_000);
      audit('local-admin', 'LOGIN', 'admin-session', {});
      return { token };
    },
    requireAdmin(token) {
      if (typeof token !== 'string' || !one('SELECT 1 FROM admin_sessions WHERE token = ? AND expires_at > ?', token, now())) fail(403, 'ADMIN_REQUIRED', 'Administrator authentication required.');
      return 'local-admin';
    },
    logoutAdmin(token) { run('DELETE FROM admin_sessions WHERE token = ?', token); },
    adminMockSms(actor, body) {
      if (provider.mode !== 'mock' || typeof provider.eventFor !== 'function') fail(503, 'PROVIDER_UNAVAILABLE', 'Local mock adapter is not enabled.');
      if (typeof body?.taskId !== 'string' || typeof body.code !== 'string' || !/^\d{4,8}$/.test(body.code)) fail(400, 'INVALID_INPUT', 'Provide a test order ID and a 4-8 digit code.');
      const task = one('SELECT t.*,p.service_id FROM tasks t JOIN products p ON p.id = t.product_id WHERE t.id = ?', body.taskId);
      const assignment = one('SELECT * FROM assignments WHERE task_id = ?', body.taskId);
      if (!task || !assignment || stateOf(task) !== 'WAITING_SMS') fail(409, 'ORDER_NOT_ACTIVE', 'Select a waiting order with an assigned number.');
      const event = provider.eventFor({ assignment, task, code: body.code, at: now(), eventId: id('mock') });
      const result = receiveSms(event);
      audit(actor, 'MOCK_SMS', task.id, { eventId: event.eventId, result: result.status });
      return result;
    },
    updateProduct(actor, productId, body) {
      const product = one('SELECT * FROM products WHERE id = ?', productId);
      if (!product) fail(404, 'PRODUCT_UNAVAILABLE', 'Product not found.');
      const fields = ['priceCents', 'durationSeconds', 'enabled', 'canCancel', 'rules'];
      if (!body || !Object.keys(body).length || Object.keys(body).some(k => !fields.includes(k))) fail(400, 'INVALID_INPUT', 'Unsupported product configuration.');
      if (body.priceCents !== undefined && (!Number.isSafeInteger(body.priceCents) || body.priceCents < 1 || body.priceCents > 100000)) fail(400, 'INVALID_INPUT', 'Invalid price.');
      if (body.durationSeconds !== undefined && (!Number.isSafeInteger(body.durationSeconds) || body.durationSeconds < 60 || body.durationSeconds > 86400)) fail(400, 'INVALID_INPUT', 'Invalid duration.');
      for (const k of ['enabled', 'canCancel']) if (body[k] !== undefined && typeof body[k] !== 'boolean') fail(400, 'INVALID_INPUT', 'Expected a boolean.');
      if (body.rules !== undefined && (!body.rules || typeof body.rules !== 'object' || Array.isArray(body.rules) || Object.keys(body.rules).some(k => !(k in POLICY)))) fail(400, 'INVALID_INPUT', 'Invalid policy.');
      const rules = { ...rulesOf(product), ...body.rules };
      if (!Number.isSafeInteger(rules.cooldownSeconds) || rules.cooldownSeconds < 0 || rules.cooldownSeconds > 86400 ||
        Object.keys(POLICY).filter(k => k !== 'cooldownSeconds').some(k => typeof rules[k] !== 'boolean')) fail(400, 'INVALID_INPUT', 'Invalid policy values.');
      transaction(db, () => {
        run('UPDATE products SET price_cents = ?, duration_seconds = ?, enabled = ?, can_cancel = ?, policy_json = ?, version = version + 1 WHERE id = ?',
          body.priceCents ?? product.price_cents, body.durationSeconds ?? product.duration_seconds, Number(body.enabled ?? product.enabled), Number(body.canCancel ?? product.can_cancel), JSON.stringify(rules), productId);
        audit(actor, 'PRODUCT_UPDATE', productId, body);
      });
      return { product: products().find(p => p.id === productId) };
    },
    createPlatform(actor, body) {
      if (!body || typeof body.id !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 50 ||
        !Number.isSafeInteger(body.priceCents) || body.priceCents < 1 || body.priceCents > 100000) fail(400, 'INVALID_INPUT', 'Supply a unique platform key, name and integer test price.');
      if (one('SELECT 1 FROM services WHERE id = ? OR name = ?', body.id, body.name.trim())) fail(409, 'SERVICE_EXISTS', 'Platform key or name already exists.');
      transaction(db, () => {
        run('INSERT INTO services (id,name) VALUES (?,?)', body.id, body.name.trim());
        for (const [country, label] of [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada']]) {
          run(`INSERT INTO products (id,service,country,country_code,price_cents,currency,duration_seconds,enabled,can_cancel,description,icon_key,service_id,policy_json)
            VALUES (?,?,?,?,?,'USD',1200,1,1,?,?,?,?)`, `${body.id}-${country.toLowerCase()}`, body.name.trim(), label, country, body.priceCents,
            'Local test configuration only. No number capabilities are assumed.', body.id, body.id, JSON.stringify(POLICY));
        }
        audit(actor, 'SERVICE_CREATE', body.id, body);
      });
      return { created: true };
    },
    updateNumberService(actor, resourceId, serviceId, body) {
      transaction(db, () => {
        const existing = one('SELECT * FROM number_services WHERE resource_id = ? AND service_id = ?', resourceId, serviceId);
        if (!one('SELECT 1 FROM resources WHERE id = ?', resourceId) || !one('SELECT 1 FROM services WHERE id = ?', serviceId) ||
          !['AVAILABLE', 'RESTRICTED', 'UNKNOWN'].includes(body?.state) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(400, 'INVALID_INPUT', 'Supply a capability state and explicit verification/restriction reason.');
        if (existing?.state === 'USED' || one('SELECT 1 FROM usage_history WHERE resource_id = ? AND service_id = ?', resourceId, serviceId)) fail(409, 'REUSE_RESTRICTED', 'Used platform history cannot be erased or reset to fresh inventory.');
        if (one("SELECT 1 FROM leases WHERE resource_id = ? AND status = 'ACTIVE'", resourceId) || one('SELECT 1 FROM assignments WHERE resource_id = ? AND ended_at IS NULL', resourceId)) fail(409, 'RESOURCE_BUSY', 'Cannot edit capabilities while a number is assigned.');
        run(`INSERT INTO number_services (resource_id,service_id,state,reason) VALUES (?,?,?,?)
          ON CONFLICT(resource_id,service_id) DO UPDATE SET state = excluded.state, reason = excluded.reason`, resourceId, serviceId, body.state, body.reason.trim());
        audit(actor, 'NUMBER_CAPABILITY_UPDATE', resourceId, { serviceId, ...body });
      });
      return { updated: true };
    },
    updateService(actor, serviceId, body) {
      if (typeof body?.enabled !== 'boolean' || !one('SELECT id FROM services WHERE id = ?', serviceId)) fail(400, 'INVALID_INPUT', 'Select an existing service and enabled flag.');
      transaction(db, () => { run('UPDATE services SET enabled = ? WHERE id = ?', Number(body.enabled), serviceId); audit(actor, 'SERVICE_UPDATE', serviceId, body); });
      return { updated: true };
    },
    updateResource(actor, resourceId, body) {
      const resource = one('SELECT * FROM resources WHERE id = ?', resourceId);
      if (!resource || !body || !Object.keys(body).length || Object.keys(body).some(k => !['online', 'costCents'].includes(k)) ||
        (body.online !== undefined && typeof body.online !== 'boolean') || (body.costCents !== undefined && (!Number.isSafeInteger(body.costCents) || body.costCents < 0 || body.costCents > 10000000))) fail(400, 'INVALID_INPUT', 'Supply an online flag and/or nonnegative integer resource cost.');
      transaction(db, () => { run('UPDATE resources SET online = ?, cost_cents = ? WHERE id = ?', Number(body.online ?? resource.online), body.costCents ?? resource.cost_cents, resourceId); audit(actor, 'RESOURCE_UPDATE', resourceId, body); });
      return { updated: true };
    },
    failTask(actor, taskId, body) {
      expire();
      const viewerId = transaction(db, () => {
        const row = one('SELECT * FROM tasks WHERE id = ?', taskId);
        if (!row || !ACTIVE.has(stateOf(row)) || typeof body?.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(409, 'ORDER_NOT_ACTIVE', 'Select an active order and provide an explicit failure reason.');
        finish(row, 'SMS_FAILED', body.reason.trim()); audit(actor, 'ORDER_FAILED', taskId, body);
        return row.viewer_id;
      });
      notify(viewerId); return { updated: true };
    },
    resolveSettlement(actor, taskId, body) {
      const viewerId = transaction(db, () => {
        const row = one('SELECT * FROM tasks WHERE id = ?', taskId);
        if (!row || ACTIVE.has(stateOf(row)) || row.settlement_state !== 'REVIEW_REQUIRED' || !['REFUND', 'CAPTURE'].includes(body?.action) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000) fail(409, 'CANNOT_SETTLE', 'Select a pending ended order and provide action plus evidence/reason.');
        settle(row, body.action); audit(actor, 'SETTLEMENT_RESOLVED', taskId, body);
        return row.viewer_id;
      });
      notify(viewerId); return { updated: true };
    },
  };
}
