import { createHash, randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';

const id = prefix => `${prefix}_${randomUUID()}`;
const iso = time => new Date(time).toISOString();
const DAY = 86400000;
export function createLeaseService(db, { now, provider, fail, requireViewer, walletEntry, notify, audit }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const event = (leaseId, kind, detail) => run('INSERT INTO lease_events VALUES (?,?,?,?,?)', id('lev'), leaseId, kind, detail, now());
  function owned(viewerId, leaseId) {
    requireViewer(viewerId);
    const row = one('SELECT * FROM leases WHERE id = ? AND viewer_id = ?', leaseId, viewerId);
    if (!row) fail(404, 'LEASE_NOT_FOUND', '当前工作区中没有此租约。');
    return row;
  }
  function expireLeases() {
    const viewers = transaction(db, () => {
      const rows = all("SELECT * FROM leases WHERE status = 'ACTIVE' AND expires_at <= ?", now());
      for (const row of rows) {
        run("UPDATE leases SET status = 'EXPIRED', ended_at = expires_at WHERE id = ?", row.id);
        run("UPDATE resources SET lease_availability = 'REVIEW' WHERE id = ?", row.resource_id);
        event(row.id, 'EXPIRED', '租期结束，停止收信；号码待管理员回收审核，不自动上架。');
      }
      return new Set(rows.map(r => r.viewer_id));
    });
    for (const viewer of viewers) notify(viewer);
  }
  function view(row) {
    const resource = one('SELECT * FROM resources WHERE id = ?', row.resource_id);
    return { id: row.id, resourceId: row.resource_id, phone: resource.phone, countryCode: resource.country_code,
      status: row.status, online: Boolean(resource.online), startedAt: iso(row.started_at), expiresAt: iso(row.expires_at),
      canRenew: row.status === 'ACTIVE' && row.expires_at > now() && provider.mode === 'mock', isDemo: true,
      upstreamExpiresAt: null, usage: null, receiveSupported: true, sendSupported: false,
      messages: all("SELECT * FROM lease_incoming_sms WHERE lease_id = ? AND status = 'MATCHED' ORDER BY occurred_at,rowid", row.id)
        .map(m => ({ id: m.id, text: m.text, code: m.code, receivedAt: iso(m.occurred_at), isDemo: true })),
      events: all('SELECT * FROM lease_events WHERE lease_id = ? ORDER BY rowid', row.id).map(e => ({ kind: e.kind, detail: e.detail, createdAt: iso(e.created_at) })) };
  }
  function plans() { return all('SELECT * FROM lease_plans ORDER BY days').map(p => ({ id: p.id, days: p.days, priceCents: p.price_cents, version: p.version, enabled: Boolean(p.enabled), currency: 'USD' })); }
  function resources(admin = false) {
    return all(`SELECT r.*, (SELECT id FROM leases WHERE resource_id = r.id AND status = 'ACTIVE') AS lease_id,
      (SELECT task_id FROM assignments WHERE resource_id = r.id AND ended_at IS NULL) AS task_id
      FROM resources r ${admin ? '' : "WHERE purpose = 'EXCLUSIVE'"} ORDER BY phone`).map(r => ({
      id: r.id, phone: r.phone, countryCode: r.country_code, purpose: r.purpose, availability: r.lease_availability,
      online: Boolean(r.online), available: provider.mode === 'mock' && r.source === 'mock' && Boolean(r.online) && r.purpose === 'EXCLUSIVE' && r.lease_availability === 'AVAILABLE' && !r.task_id && !r.lease_id && r.cooldown_until <= now(),
      leaseId: admin ? r.lease_id : undefined, legacyTaskId: admin ? r.task_id : undefined,
      receiveSupported: true, sendSupported: false, capability: 'Mock 普通短信及验证码；未验证真实平台兼容性', isDemo: true }));
  }
  function orders(viewerId) {
    return all(`SELECT o.*,r.phone FROM lease_orders o JOIN leases l ON l.id = o.lease_id JOIN resources r ON r.id = l.resource_id ${viewerId ? 'WHERE o.viewer_id = ?' : ''} ORDER BY o.created_at DESC,o.rowid DESC`, ...(viewerId ? [viewerId] : []))
      .map(o => ({ id: o.id, leaseId: o.lease_id, phone: o.phone, kind: o.kind, status: o.status, days: o.days, priceCents: o.price_cents, planVersion: o.plan_version, ledgerId: o.ledger_id, createdAt: iso(o.created_at), expiresAt: iso(o.expires_at) }));
  }
  function leaseSnapshot(viewerId) {
    return { leasePlans: plans(), leaseResources: resources(), leases: all('SELECT * FROM leases WHERE viewer_id = ? ORDER BY started_at DESC,rowid DESC', viewerId).map(view), leaseOrders: orders(viewerId) };
  }
  function purchase(viewerId, body, leaseId = null) {
    requireViewer(viewerId);
    const fields = ['planId', 'expectedPriceCents', 'expectedPlanVersion', 'idempotencyKey', ...(leaseId ? [] : ['resourceId'])];
    if (!body || Object.keys(body).some(k => !fields.includes(k)) || typeof body.planId !== 'string' || (!leaseId && typeof body.resourceId !== 'string') ||
      !Number.isSafeInteger(body.expectedPriceCents) || !Number.isSafeInteger(body.expectedPlanVersion) || typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.idempotencyKey)) fail(400, 'INVALID_INPUT', '提供号码、方案、预期价格、版本及幂等编号。');
    expireLeases();
    const result = transaction(db, () => {
      const payload = JSON.stringify([leaseId ? 'RENEW' : 'OPEN', leaseId ?? body.resourceId, body.planId, body.expectedPriceCents, body.expectedPlanVersion]);
      const previous = one('SELECT * FROM lease_orders WHERE viewer_id = ? AND request_key = ?', viewerId, body.idempotencyKey);
      if (previous) {
        if (previous.payload !== payload) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求编号已用于另一操作。');
        return { lease: view(owned(viewerId, previous.lease_id)), orderId: previous.id, replayed: true };
      }
      const plan = one('SELECT * FROM lease_plans WHERE id = ?', body.planId);
      if (!plan?.enabled) fail(409, 'PLAN_UNAVAILABLE', '租赁方案当前不可用。');
      if (plan.price_cents !== body.expectedPriceCents || plan.version !== body.expectedPlanVersion) fail(409, 'PRICE_CHANGED', '方案价格或版本已更新，请重新确认。');
      if (provider.mode !== 'mock') fail(503, 'PROVIDER_UNAVAILABLE', '仅启用本地 Mock 租赁。');
      const existing = leaseId ? owned(viewerId, leaseId) : null;
      if (existing && (existing.status !== 'ACTIVE' || existing.expires_at <= now())) fail(409, 'LEASE_NOT_ACTIVE', '仅可续费仍有效的原租约。');
      const resourceId = existing?.resource_id ?? body.resourceId;
      const resource = one('SELECT * FROM resources WHERE id = ?', resourceId);
      if (!existing && !resources().some(r => r.id === resourceId && r.available)) fail(409, 'RESOURCE_UNAVAILABLE', '此号码不可售或已被占用。');
      if (existing && (resource.purpose !== 'EXCLUSIVE' || resource.lease_availability !== 'LEASED')) fail(409, 'RESOURCE_UNAVAILABLE', '号码权益状态不允许续费。');
      const wallet = one('SELECT * FROM wallets WHERE viewer_id = ?', viewerId);
      if (!wallet || wallet.balance_cents < plan.price_cents) fail(409, 'INSUFFICIENT_BALANCE', '测试额度不足。');
      const at = now(); const expiry = (existing?.expires_at ?? at) + plan.days * DAY;
      const currentId = existing?.id ?? id('lease'); const orderId = id('lorder');
      let failed = false;
      if (!existing) { try { provider.assertResource(resource); } catch { failed = true; } }
      if (!existing) run('INSERT INTO leases VALUES (?,?,?,?,?,?,NULL)', currentId, viewerId, resourceId, failed ? 'FAILED' : 'ACTIVE', at, expiry);
      else run('UPDATE leases SET expires_at = ? WHERE id = ?', expiry, currentId);
      let ledger = null;
      if (!failed) {
        ledger = walletEntry(viewerId, null, 'CAPTURE', -plan.price_cents, 0, `lease-${orderId}`);
        run("UPDATE resources SET lease_availability = 'LEASED' WHERE id = ?", resourceId);
      }
      run('INSERT INTO lease_orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', orderId, currentId, viewerId, existing ? 'RENEW' : 'OPEN', failed ? 'FAILED' : 'TEST_PAID', plan.id, plan.version, plan.days, plan.price_cents, existing?.expires_at ?? null, expiry, ledger?.id ?? null, at, body.idempotencyKey, payload);
      event(currentId, failed ? 'FAILED' : existing ? 'RENEWED' : 'OPENED', failed ? 'Mock 资源拒绝开通；未扣款，未占用。' : existing ? `本地确认同号追加 ${plan.days} 天；测试租金已结算。` : `本地开通 ${plan.days} 天独占租约；收信不会结束租期。`);
      audit(viewerId, existing ? 'LEASE_RENEW' : 'LEASE_OPEN', currentId, { orderId, status: failed ? 'FAILED' : 'TEST_PAID' });
      return { lease: view(owned(viewerId, currentId)), orderId, replayed: false };
    });
    notify(viewerId); return result;
  }
  function receiveLeaseSms(input) {
    if (provider.mode !== 'mock') fail(503, 'PROVIDER_UNAVAILABLE', '未配置真实上游。');
    const keys = ['provider', 'eventId', 'messageId', 'resourceId', 'leaseId', 'occurredAt', 'text'];
    if (!input || keys.some(k => typeof input[k] !== 'string' || input[k].length > (k === 'text' ? 4000 : 180)) || input.provider !== 'mock' || !input.eventId || !input.messageId || !input.text.trim() || !Number.isFinite(Date.parse(input.occurredAt))) fail(400, 'INVALID_SMS_EVENT', '提供有稳定标识、可信时间、租约关联及正文的 Mock 短信。');
    expireLeases(); let owner;
    const result = transaction(db, () => {
      const digest = createHash('sha256').update(JSON.stringify(keys.filter(k => k !== 'eventId').map(k => input[k]))).digest('hex');
      const priors = all('SELECT * FROM lease_incoming_sms WHERE provider = ? AND (event_id = ? OR message_id = ?)', input.provider, input.eventId, input.messageId);
      if (priors.length) {
        if (priors.length !== 1 || priors[0].payload_hash !== digest) {
          run('INSERT INTO lease_sms_conflicts VALUES (?,?,?,?,?)', id('conflict'), input.eventId, input.messageId, 'EVENT_CONFLICT', now());
          return { status: 'QUARANTINED', reason: 'EVENT_CONFLICT', replayed: false };
        }
        return { id: priors[0].id, status: priors[0].status, reason: priors[0].reason, replayed: true };
      }
      const lease = one('SELECT * FROM leases WHERE id = ?', input.leaseId);
      const occurred = Date.parse(input.occurredAt);
      let reason = '';
      if (!lease || lease.resource_id !== input.resourceId) reason = 'UNCONFIRMED_LEASE';
      else if (lease.status !== 'ACTIVE' || lease.expires_at <= now()) reason = 'LEASE_NOT_ACTIVE';
      else if (occurred < lease.started_at || occurred >= lease.expires_at || occurred > now()) reason = 'OUTSIDE_LEASE_WINDOW';
      const codes = [...input.text.matchAll(/(?<!\d)\d{4,8}(?!\d)/g)].map(m => m[0]);
      const messageId = id('lsms');
      run('INSERT INTO lease_incoming_sms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', messageId, input.provider, input.eventId, input.messageId, digest, input.resourceId, input.leaseId, occurred, now(), input.text, codes.length === 1 ? codes[0] : null, reason ? 'QUARANTINED' : 'MATCHED', reason);
      if (!reason) owner = lease.viewer_id;
      return { id: messageId, status: reason ? 'QUARANTINED' : 'MATCHED', reason, replayed: false };
    });
    if (owner) notify(owner); return result;
  }
  function adminLeaseSnapshot() {
    expireLeases();
    return { leasePlans: plans(), leaseResources: resources(true), leases: all('SELECT * FROM leases ORDER BY started_at DESC,rowid DESC').map(view), leaseOrders: orders(),
      leaseExceptions: [...all("SELECT id,event_id,message_id,reason,received_at FROM lease_incoming_sms WHERE status = 'QUARANTINED'"), ...all('SELECT * FROM lease_sms_conflicts')].sort((a,b) => b.received_at - a.received_at) };
  }
  return { expireLeases, leaseSnapshot, adminLeaseSnapshot, receiveLeaseSms,
    createLease: (viewerId, body) => purchase(viewerId, body),
    renewLease: (viewerId, leaseId, body) => purchase(viewerId, body, leaseId),
    getLease(viewerId, leaseId) { expireLeases(); return view(owned(viewerId, leaseId)); },
    adminLeaseSms(actor, body) {
      const lease = one('SELECT * FROM leases WHERE id = ?', typeof body?.leaseId === 'string' ? body.leaseId : '');
      if (!lease || typeof body.text !== 'string') fail(400, 'INVALID_INPUT', '明确选择租约并提供 Mock 正文。');
      const eventId = id('mock');
      const result = receiveLeaseSms({ provider: 'mock', eventId, messageId: eventId, resourceId: lease.resource_id, leaseId: lease.id, occurredAt: iso(now()), text: body.text });
      audit(actor, 'MOCK_LEASE_SMS', lease.id, { eventId, status: result.status }); return result;
    },
    updateLeasePlan(actor, planId, body) {
      if (!body || Object.keys(body).some(k => !['priceCents','enabled','expectedVersion'].includes(k)) || !Number.isSafeInteger(body.priceCents) || body.priceCents < 1 || body.priceCents > 100000 || typeof body.enabled !== 'boolean' || !Number.isSafeInteger(body.expectedVersion)) fail(400, 'INVALID_INPUT', '提供测试价格、启用状态及预期版本。');
      transaction(db, () => {
        const plan = one('SELECT * FROM lease_plans WHERE id = ?', planId);
        if (!plan || plan.version !== body.expectedVersion) fail(409, 'PRICE_CHANGED', '方案版本已变化。');
        run('UPDATE lease_plans SET price_cents = ?, enabled = ?, version = version + 1 WHERE id = ?', body.priceCents, Number(body.enabled), planId);
        audit(actor, 'LEASE_PLAN_UPDATE', planId, body);
      }); return { updated: true };
    },
    updateLeaseResource(actor, resourceId, body) {
      expireLeases();
      if (!body || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000 || !['SHARED','EXCLUSIVE','CUSTOMER_OWNED'].includes(body.purpose) || !['AVAILABLE','UNLISTED'].includes(body.availability) || typeof body.online !== 'boolean' || (body.availability === 'AVAILABLE' && body.purpose !== 'EXCLUSIVE')) fail(400, 'INVALID_INPUT', '提供资源用途、上架状态、在线状态和审核理由。');
      transaction(db, () => {
        const resource = one('SELECT * FROM resources WHERE id = ?', resourceId);
        if (!resource) fail(404, 'RESOURCE_UNAVAILABLE', '号码不存在。');
        if (resource.purpose === 'CUSTOMER_OWNED' && body.purpose !== 'CUSTOMER_OWNED') fail(409, 'RESOURCE_OWNERSHIP', '客户自带资源不得转入平台可售池。');
        if (one("SELECT 1 FROM leases WHERE resource_id = ? AND status = 'ACTIVE'", resourceId) || one('SELECT 1 FROM assignments WHERE resource_id = ? AND ended_at IS NULL', resourceId)) fail(409, 'RESOURCE_BUSY', '活跃租约或遗留任务仍占用号码，不能重新上架或改变归属。');
        if (resource.lease_availability === 'REVIEW' && body.purpose !== 'EXCLUSIVE') fail(409, 'REVIEW_REQUIRED', '到期号码保留在独占池，需记录回收审核后再上架。');
        for (const row of all("SELECT * FROM leases WHERE resource_id = ? AND status = 'EXPIRED'", resourceId)) {
          run("UPDATE leases SET status = 'RELEASED' WHERE id = ?", row.id); event(row.id, 'RELEASED', body.reason.trim());
        }
        run('UPDATE resources SET purpose = ?, lease_availability = ?, online = ? WHERE id = ?', body.purpose, body.availability, Number(body.online), resourceId);
        audit(actor, 'LEASE_RESOURCE_REVIEW', resourceId, body);
      }); return { updated: true };
    }
  };
}
