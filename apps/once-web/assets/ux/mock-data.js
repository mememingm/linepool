(() => {
  const enabled = document.documentElement.dataset.localDemo === 'true' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const key = 'once-ux-mock-v1';
  const day = 86400000;
  const scenes = { empty: '新用户 · 0 个号码', single: '单号码 · 1 个号码', two: '双号码 · 2 个号码', common: '常见账户 · 4 个号码', five: '常用账户 · 5 个号码', twenty: '多号码 · 20 个号码', 'no-stock': '无可售库存', 'empty-messages': '空收件箱', 'api-error': '接口失败', 'renew-error': '续费失败' };
  const places = [
    ['US', '美国', 'ca', '加利福尼亚州', '415'], ['CA', '加拿大', 'on', '安大略省', '647'],
    ['US', '美国', 'ny', '纽约州', '212'], ['CA', '加拿大', 'bc', '不列颠哥伦比亚省', '604'],
    ['US', '美国', 'all', '任意地区', '202']
  ];
  const iso = value => new Date(value).toISOString();
  const clone = value => structuredClone(value);
  function fail(message, status = 503) { const error = new Error(message); error.status = status; throw error; }
  function fixture(scene) {
    const anchor = new Date().setUTCHours(0, 0, 0, 0);
    const count = ({ empty: 0, single: 1, two: 2, common: 4, five: 5, twenty: 20, 'no-stock': 0, 'empty-messages': 1, 'api-error': 4, 'renew-error': 1 })[scene];
    const inventory = Array.from({ length: 40 }, (_, index) => {
      const [countryCode, countryName, regionId, regionName, areaCode] = places[index % places.length];
      return { id: `mock-number-${index + 1}`, number: `+1 ${areaCode} 555 ${String(100 + index).padStart(4, '0')}`, countryCode, countryName, regionId, regionName, areaCode };
    });
    const leases = inventory.slice(0, count).map((number, index) => {
      const expired = count >= 4 && (count === 20 ? index >= 17 : index === count - 1);
      const expiring = !expired && count >= 4 && (count === 20 ? index >= 14 : index === count - 2);
      const remaining = expired ? -4 : expiring ? 3 : 26 - index % 10;
      return { ...number, id: `mock-lease-${index + 1}`, numberId: number.id, term: 30, price: 35, currency: 'USD', startedAt: iso(anchor + (remaining - 30 - (index === 0 && count >= 2 ? 7 : 0)) * day), expiresAt: iso(anchor + remaining * day), demo: true, smsReceive: 'demo', smsSend: 'pending', ...(index % 2 === 0 && !expired ? { smsSendQuota: { total: 100, used: 15, remaining: 85, unit: 'message' } } : {}) };
    });
    const messages = scene === 'empty-messages' ? [] : leases.flatMap((lease, index) => Array.from({ length: 2 + index % 2 }, (_, i) => ({ id: `mock-message-${index + 1}-${i + 1}`, leaseId: lease.id, numberId: lease.numberId, sender: i ? 'ONCE Demo' : 'Sample Service', title: i ? '号码租赁通知' : '演示验证消息', body: i ? `这是 ${lease.number} 的独享号码演示消息。接收短信不扣减发送额度。` : `仅供演示：号码 ${lease.number} 的示例验证码为 246810，不用于任何真实服务。`, code: i ? null : '246810', receivedAt: iso(Math.min(anchor, new Date(lease.expiresAt).getTime() - day) - (index * 40 + i * 15) * 60000), isRead: index % 3 === 1, demo: true })));
    const bills = leases.map((lease, index) => ({ id: `mock-order-${index + 1}`, leaseId: lease.id, number: lease.number, kind: '号码租赁', term: lease.term, amount: lease.price, currency: 'USD', status: '演示已确认', createdAt: lease.startedAt, demo: true }));
    if (count >= 2) bills.push({ id: 'mock-order-renewal', leaseId: leases[0].id, number: leases[0].number, kind: '同号续费', term: 7, amount: 12, currency: 'USD', status: '演示已确认', createdAt: iso(anchor - 2 * day), demo: true });
    return { version: 1, scene, anchor, serial: 100, leases, messages, bills, inventory: inventory.filter(number => !leases.some(lease => lease.number === number.number)), replay: {} };
  }
  let data;
  let storageError = '';
  const resetTokens = new Map();
  const newResetToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  function save(next) {
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { storageError = '演示数据未能保存，请允许浏览器存储后重试。'; fail(storageError); }
    data = next;
  }
  if (enabled) {
    const wanted = new URLSearchParams(location.search).get('scenario');
    try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch { storageError = '演示记录损坏，请重置演示场景。'; }
    if (!data || data.version !== 1 || !Array.isArray(data.leases) || !Array.isArray(data.messages) || !Array.isArray(data.bills) || !Array.isArray(data.inventory) || (wanted && Object.hasOwn(scenes, wanted) && data.scene !== wanted)) {
      try { save(fixture(Object.hasOwn(scenes, wanted) ? wanted : 'common')); } catch { /* The workspace will expose the storage failure. */ }
    }
  }
  const expired = lease => new Date(lease.expiresAt).getTime() <= Date.now();
  function snapshot(id) {
    const leases = data.leases.map(lease => ({ ...lease, smsSend: {enabled: !expired(lease), demo: true, reason: expired(lease) ? '演示号码已到期' : null}, messageCount: data.messages.filter(message => message.leaseId === lease.id).length, unreadCount: data.messages.filter(message => message.leaseId === lease.id && !message.isRead).length }));
    const lease = id ? leases.find(item => item.id === id) : leases.find(item => !expired(item)) || leases[0];
    if (id && !lease) fail('找不到该演示租约，请返回号码列表。', 404);
    const messages = data.messages.filter(message => message.leaseId === lease?.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return clone({ lease: lease || null, leases, messages, messageCount: messages.length, unreadCount: data.messages.filter(message => !message.isRead).length, recentMessages: [...data.messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 5), bills: [...data.bills].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), billsCount: data.bills.length, demo: true, localMock: true, truncated: { messages: false, bills: false } });
  }
  const peerKey = value => value.replace(/[\s()_-]/g, '').replace(/^\+/, '');
  function chatRows(leaseId) {
    return [...data.messages.filter(row => row.leaseId === leaseId).map(row => ({
      id: row.id, peer: peerKey(row.sender), direction: 'INBOUND', body: row.body, status: 'RECEIVED', error: null,
      time: row.receivedAt, createdAt: row.receivedAt, readAt: row.isRead ? row.readAt || row.receivedAt : null, demo: true,
    })), ...(data.outbound || []).filter(row => row.leaseId === leaseId).map(row => ({
      id: row.id, peer: peerKey(row.to), direction: 'OUTBOUND', body: row.content, status: row.status, error: row.errorCode,
      time: row.createdAt, createdAt: row.createdAt, readAt: null, demo: true,
    }))].sort((a, b) => b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
  }
  async function request(path, options = {}) {
    if (!enabled) fail('本地演示未启用。', 403);
    await new Promise(resolve => setTimeout(resolve, 120));
    if (storageError) fail(storageError);
    const url = new URL(path, 'http://mock.invalid');
    const method = options.method || 'GET';
    if (url.pathname === '/auth/forgot-password') {
      const input = options.body || {};
      if (method !== 'POST' || typeof input.email !== 'string' || !input.email.includes('@')) fail('请输入有效的邮箱地址。', 400);
      const token = newResetToken(), expiresAt = Date.now() + 60 * 60000;
      resetTokens.set(token, expiresAt);
      return { ok: true, resetToken: token, expiresAt: new Date(expiresAt).toISOString() };
    }
    if (url.pathname === '/auth/reset-password') {
      const input = options.body || {}, expiresAt = resetTokens.get(input.token);
      if (method !== 'POST' || typeof input.token !== 'string' || !expiresAt || expiresAt <= Date.now()) fail('重置链接无效或已过期。', 400);
      if (typeof input.newPassword !== 'string' || input.newPassword.length < 12 || input.newPassword.length > 128) fail('新密码需要 12–128 个字符。', 400);
      resetTokens.delete(input.token);
      return { ok: true };
    }
    if (url.pathname === '/auth/me') return { id: 'local-demo', email: 'demo@once.invalid' };
    if (url.pathname === '/auth/logout') return { ok: true };
    if (url.pathname === '/state') {
      if (data.scene === 'api-error') fail('演示接口暂时不可用。可重试，或在演示场景中恢复。');
      return snapshot(url.searchParams.get('leaseId'));
    }
    if (url.pathname === '/inventory') return clone(data.scene === 'no-stock' ? [] : data.inventory);
    const body = options.body || {};
    const signature = options.headers?.['Idempotency-Key'];
    const chatMatch = /^\/leases\/([^/]+)\/chat\/(conversations|messages|read|demo\/send|demo\/receive)$/.exec(url.pathname);
    if (chatMatch) {
      const leaseId = decodeURIComponent(chatMatch[1]), action = chatMatch[2];
      const lease = data.leases.find(row => row.id === leaseId);
      if (!lease) fail('找不到该演示租约。', 404);
      if (method === 'GET' && action === 'conversations') {
        const peers = new Map();
        for (const row of chatRows(leaseId)) {
          if (!peers.has(row.peer)) peers.set(row.peer, {peer: row.peer, body: row.body, time: row.time, direction: row.direction, unread: 0});
          if (row.direction === 'INBOUND' && !row.readAt) peers.get(row.peer).unread++;
        }
        return clone([...peers.values()]);
      }
      if (method === 'GET' && action === 'messages') {
        const peer = peerKey(url.searchParams.get('peer') || ''), limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
        let rows = chatRows(leaseId).filter(row => row.peer === peer);
        const cursor = url.searchParams.get('cursor');
        if (cursor) {
          let position;
          try { position = JSON.parse(atob(cursor)); } catch { fail('演示分页参数无效。', 400); }
          if (position.leaseId !== leaseId || position.peer !== peer) fail('演示分页范围无效。', 400);
          rows = rows.filter(row => row.time < position.time || (row.time === position.time && row.id > position.id));
        }
        const items = rows.slice(0, limit), last = items.at(-1), hasMore = rows.length > limit;
        return clone({items, hasMore, nextCursor: hasMore ? btoa(JSON.stringify({leaseId, peer, time: last.time, id: last.id})) : null});
      }
      if (method !== 'POST') fail('演示操作不支持该请求方式。', 405);
      if (action === 'read') {
        const next = clone(data);
        next.messages.filter(row => row.leaseId === leaseId && body.ids?.includes(row.id)).forEach(row => {row.isRead = true; row.readAt ||= iso(Date.now());});
        save(next); window.dispatchEvent(new Event('once-demo-chat')); return {ok: true};
      }
      const peer = (action === 'demo/send' ? body.to : body.peer)?.replace(/[\s()-]/g, '');
      if (!/^\+[1-9]\d{1,14}$/.test(peer || '') || (action === 'demo/send' && (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 4000))) fail('请输入有效的号码和短信内容。', 400);
      if (typeof signature !== 'string' || !signature) fail('演示操作缺少幂等标识。', 400);
      const replayKey = `chat:${leaseId}:${action}:${signature}`, hash = JSON.stringify(body), previous = data.replay[replayKey];
      if (previous) {
        if (previous.hash !== hash) fail('同一次操作的短信内容发生变化。', 409);
        return clone(previous.result);
      }
      if (expired(lease)) fail('演示号码已到期，无法模拟收发。', 409);
      const next = clone(data), now = Date.now();
      let result = {ok: true};
      if (action === 'demo/send') {
        result = {id: `mock-outbound-${++next.serial}`, leaseId, number: lease.number, to: peer, content: body.content,
          status: body.fail ? 'FAILED' : 'SENT', errorCode: body.fail ? 'DEMO_SIMULATED_FAILURE' : null, createdAt: iso(now), updatedAt: iso(now), providerMessageId: null, demo: true};
        (next.outbound ||= []).push(result);
      }
      if (action === 'demo/receive' || !body.fail) next.messages.unshift({id: `mock-message-${++next.serial}`, leaseId, numberId: lease.numberId,
        sender: peer, title: action === 'demo/send' ? '演示自动回复' : '演示来信', body: action === 'demo/send'
          ? `已收到你的消息：“${body.content.slice(0, 80)}${body.content.length > 80 ? '…' : ''}”。这是模拟回复，可以继续体验短信聊天。`
          : '你好，这是一条模拟来信。你可以直接回复，也可以切换会话查看未读提醒。',
        code: null, receivedAt: iso(now + 1), isRead: false, demo: true});
      next.replay[replayKey] = {hash, result};
      save(next); window.dispatchEvent(new Event('once-demo-chat')); return clone(result);
    }
    if (signature && data.replay[signature]) return clone(data.replay[signature]);
    const next = clone(data);
    let lease;
    let kind;
    if (method === 'POST' && url.pathname === '/leases') {
      if (![7, 30].includes(body.term)) fail('请选择支持的演示租期。', 400);
      const number = next.inventory.find(item => item.number === body.number);
      if (!number || next.scene === 'no-stock') fail('该演示号码已不可选，请刷新库存。', 409);
      lease = { ...number, id: `mock-lease-${++next.serial}`, numberId: number.id, term: body.term, price: body.term === 7 ? 12 : 35, currency: 'USD', startedAt: iso(Date.now()), expiresAt: iso(Date.now() + body.term * day), demo: true, smsReceive: 'demo', smsSend: 'pending' };
      next.leases.unshift(lease);
      next.inventory = next.inventory.filter(item => item.id !== number.id);
      next.messages.unshift({ id: `mock-message-${++next.serial}`, leaseId: lease.id, numberId: lease.numberId, sender: 'ONCE Demo', title: '独享号码已加入工作台', body: `这是 ${lease.number} 的第一条演示消息，未接入真实短信服务。`, code: null, receivedAt: iso(Date.now()), isRead: false, demo: true });
      kind = '号码租赁';
    } else if (method === 'POST' && /^\/leases\/[^/]+\/renew$/.test(url.pathname)) {
      lease = next.leases.find(item => item.id === decodeURIComponent(url.pathname.split('/')[2]));
      if (!lease || expired(lease)) fail('历史号码的恢复资格待上游确认，当前不能续费。', 409);
      if (next.scene === 'renew-error') fail('演示续费暂时失败，未延长租期，也未产生订单。');
      if (![7, 30].includes(body.term)) fail('请选择支持的演示租期。', 400);
      lease.expiresAt = iso(new Date(lease.expiresAt).getTime() + body.term * day);
      kind = '同号续费';
    } else if (method === 'POST' && /^\/leases\/[^/]+\/demo-message$/.test(url.pathname)) {
      lease = next.leases.find(item => item.id === decodeURIComponent(url.pathname.split('/')[2]));
      if (!lease || expired(lease)) fail('号码当前不能接收演示消息。', 409);
      const message = { id: `mock-message-${++next.serial}`, leaseId: lease.id, numberId: lease.numberId, sender: 'ONCE Demo', title: '新的演示短信', body: `${lease.number} 收到一条演示短信。发送额度没有扣减。`, code: null, receivedAt: iso(Date.now()), isRead: false, demo: true };
      next.messages.unshift(message); save(next); return clone(message);
    } else fail('本地演示不支持此操作，未发送任何真实请求。', 404);
    const order = { id: `mock-order-${++next.serial}`, leaseId: lease.id, number: lease.number, kind, term: body.term, amount: body.term === 7 ? 12 : 35, currency: 'USD', status: '演示已确认', createdAt: iso(Date.now()), demo: true };
    next.bills.unshift(order);
    const result = { leaseId: lease.id, orderId: order.id, replayed: false };
    if (signature) next.replay[signature] = result;
    save(next);
    return clone(result);
  }
  async function markRead(leaseId, messageId) {
    if (!enabled || !data) fail('演示未启用。', 403);
    const next = clone(data);
    next.messages.filter(message => message.leaseId === leaseId && (!messageId || message.id === messageId)).forEach(message => { message.isRead = true; });
    save(next);
  }
  window.OnceMock = Object.freeze({ enabled, scenes, request, markRead, reset(scene) { if (!enabled || !Object.hasOwn(scenes, scene)) fail('演示场景不可用。', 403); storageError = ''; save(fixture(scene)); }, get scene() { return data?.scene || 'common'; } });
})();
