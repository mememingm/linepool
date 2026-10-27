const $ = id => document.getElementById(id);
let attempts = [];
let selectedId = null;
let secretConfigured = false;
let toastTimer;
let pcSettings = null;
let queryResults = { projects: null, numbers: null };
let queryBusy = {};
let localQuery = null;
let pcDirty = false;
let callbackDirty = false;
const labels = { accepted: '接收成功', duplicate: '重复推送', rejected: '接收失败' };
const reasons = {
  'webhook-secret-not-configured': '尚未填写 Webhook 密钥。保存密钥后，请在 PC 再发送一次。',
  'timestamp-invalid-or-expired': '推送时间无效或超过 5 分钟，请检查 PC 和本机的时间。',
  'signature-invalid': '签名校验失败，请确认填写的密钥与 PC 一致。',
  'body-not-json-object': '收到的内容不是有效的 JSON 对象。',
  'event-id-mismatch': '请求头的事件编号与正文不一致。',
};
function notice(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
}
function preview(row) {
  if (row.outcome === 'rejected') return reasons[row.reason] || row.reason || '推送被拒绝';
  if (row.payload?.test) return 'PC 测试推送';
  const data = row.payload?.data;
  return [data?.phoneNumber, data?.content || row.payload?.message || row.payload?.event].filter(Boolean).join(' · ') || 'PC 推送';
}
function renderDetail() {
  const row = attempts.find(item => item.id === selectedId) || attempts[0];
  $('detail').hidden = !row;
  if (!row) return;
  $('result').textContent = `${labels[row.outcome] || '收到推送'} · 已向 PC 返回 ${row.status}`;
  $('result').className = row.outcome === 'rejected' ? 'failed' : '';
  $('received-at').textContent = new Date(row.receivedAt).toLocaleString('zh-CN', { hour12: false });
  $('reason').textContent = row.outcome === 'accepted' ? '签名校验通过，已保存到本测试接收端。以下是收到的原始内容。' : row.outcome === 'duplicate' ? '同一个事件已收到过，此次已确认接收，没有重复保存事件。' : (reasons[row.reason] || row.reason);
  const numbers = queryResults.numbers?.ok ? rowsFrom(queryResults.numbers.body) : null;
  const data = row.payload?.data;
  const number = numbers?.find(item => item && data?.numberId != null && String(item.id ?? item.numberId) === String(data.numberId));
  const comparison = [];
  if (row.payload?.test) comparison.push('这是 PC 测试推送，不代表真实短信已收到。');
  if (number) comparison.push(`号码查询对照：找到 ${number.phoneNumber || data.phoneNumber || number.id}，状态 ${number.status ?? '未提供'}，资源到期 ${number.expiresAt ?? '未提供'}。`);
  else if (numbers && !row.payload?.test) comparison.push('本次号码查询结果中未找到对应 numberId，仅对照当前返回页。');
  else if (!row.payload?.test) comparison.push('点击上方「查询账号号码」，可以对照收到短信的号码。');
  const projectId = data?.projectId ?? row.payload?.projectId;
  comparison.push(projectId == null ? '本次推送未包含 projectId，无法据此核对平台归属。' : `推送包含 projectId：${projectId}。`);
  $('comparison').textContent = comparison.join(' ');
  $('body').textContent = row.payload === null ? row.rawBody : JSON.stringify(row.payload, null, 2);
  $('headers').textContent = JSON.stringify({ headers: row.headers, response: row.response }, null, 2);
}
function renderRecords() {
  $('count').textContent = `${attempts.length} 条`;
  $('empty').hidden = attempts.length > 0;
  $('records').hidden = attempts.length === 0;
  const rows = attempts.map(row => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'record' + (row.id === selectedId ? ' selected' : '');
    const time = document.createElement('span'); time.className = 'record-time';
    time.textContent = new Date(row.receivedAt).toLocaleTimeString('zh-CN', { hour12: false });
    const text = document.createElement('span'); text.className = 'record-preview'; text.textContent = preview(row);
    const badge = document.createElement('span'); badge.className = 'badge' + (row.outcome === 'rejected' ? ' failed' : row.outcome === 'duplicate' ? ' duplicate' : '');
    badge.textContent = labels[row.outcome] || '收到推送';
    button.append(time, text, badge);
    button.addEventListener('click', () => { selectedId = row.id; renderRecords(); });
    return button;
  });
  $('records').replaceChildren(...rows); renderDetail();
}
function update(state) {
  if (!callbackDirty) $('callback-url').value = state.endpoint;
  if (state.pc) {
    pcSettings = state.pc;
    if (!pcDirty) {
      $('pc-root').value = state.pc.apiRoot;
      $('pc-project-path').value = state.pc.projectPath;
      $('pc-numbers-path').value = state.pc.numbersPath;
    }
    $('pc-key').placeholder = state.pc.keyConfigured ? 'API Key 已设置，留空保留' : '粘贴你的 PC API Key';
    $('pc-key-status').textContent = state.pc.keyConfigured ? 'API Key 已设置' : '查询会实际请求 PC。';
    $('pc-docs').href = state.pc.docsUrl;
    $('project-note').hidden = Boolean(state.pc.projectPath);
  }
  queryResults = state.queryResults || { projects: null, numbers: null };
  queryBusy = state.busy || {};
  renderQueryResults(); paintQueryButtons();
  secretConfigured = state.secretConfigured;
  $('secret').placeholder = secretConfigured ? '密钥已设置，留空保留' : '粘贴 PC 提供的 secret';
  $('settings-status').textContent = secretConfigured ? '密钥已设置。在 PC 点击「测试推送」，本页会自动显示结果。' : '填写密钥后，在 PC 中点击「测试推送」。';
  $('settings-status').className = 'note' + (secretConfigured ? ' success' : '');
  $('address-note').textContent = state.publicUrl ? '将此地址填到 PC 的「接收 Webhook」配置。连通性以 PC 的实际投递结果为准。' : '公网入口尚未接通：这个本机地址不能直接填给线上 PC。';
  $('address-note').className = 'note' + (state.publicUrl ? '' : ' attention');
  const wasLatest = !selectedId || selectedId === attempts[0]?.id;
  attempts = state.attempts || [];
  if (wasLatest || !attempts.some(row => row.id === selectedId)) selectedId = attempts[0]?.id || null;
  renderRecords();
}
function rowsFrom(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  return null;
}
function buildTable(target, rows, kind) {
  target.replaceChildren();
  if (!rows?.length) return;
  const columns = kind === 'numbers' ? [['号码 ID', row => row.id ?? row.numberId], ['手机号', row => row.phoneNumber], ['状态', row => row.status], ['资源到期时间', row => row.expiresAt]] : [['项目 ID', row => row.id ?? row.projectId], ['项目名称', row => row.name ?? row.projectName], ['状态', row => row.status]];
  const table = document.createElement('table'); const head = document.createElement('thead'); const heading = document.createElement('tr');
  for (const [label] of columns) { const cell = document.createElement('th'); cell.textContent = label; heading.append(cell); }
  head.append(heading); table.append(head);
  const body = document.createElement('tbody');
  for (const row of rows.slice(0, 100)) {
    const tr = document.createElement('tr');
    for (const [, value] of columns) { const td = document.createElement('td'); const field = row && typeof row === 'object' ? value(row) : null; td.textContent = field == null ? '未提供' : String(field); tr.append(td); }
    body.append(tr);
  }
  table.append(body); target.append(table);
}
function renderQueryResults() {
  $('query-results').hidden = !queryResults.projects && !queryResults.numbers;
  for (const kind of ['projects', 'numbers']) {
    const result = queryResults[kind]; $(kind + '-result').hidden = !result;
    if (!result) continue;
    const rows = rowsFrom(result.body);
    $(kind + '-status').textContent = result.status ? `HTTP ${result.status}` : '连接失败';
    $(kind + '-status').className = 'badge' + (result.ok ? '' : ' failed');
    const more = result.body?.page?.hasMore ? '，PC 提示还有更多数据' : '';
    $(kind + '-message').textContent = result.error || (rows ? `本次返回 ${rows.length} 条${more}。` : '已收到 PC 返回，请展开原始结果核对字段。');
    buildTable($(kind + '-table'), result.ok ? rows : null, kind);
    $(kind + '-raw').textContent = `${result.method} ${result.url}\n查询时间：${new Date(result.queriedAt).toLocaleString('zh-CN', { hour12: false })}\n耗时：${result.durationMs} ms\n\n${result.rawBody || result.error || ''}`;
  }
}
function paintQueryButtons() {
  const busy = localQuery || queryBusy.projects || queryBusy.numbers;
  $('query-projects').disabled = Boolean(busy); $('query-numbers').disabled = Boolean(busy);
  $('query-projects').textContent = localQuery === 'projects' || queryBusy.projects ? '查询中…' : '查询项目';
  $('query-numbers').textContent = localQuery === 'numbers' || queryBusy.numbers ? '查询中…' : '查询账号号码';
}
async function savePcIfNeeded() {
  const apiKey = $('pc-key').value.trim();
  if (!apiKey && !pcSettings?.keyConfigured) { $('pc-key').focus(); throw new Error('请填写你的 PC API Key'); }
  const input = { apiRoot: $('pc-root').value.trim(), apiKey, projectPath: $('pc-project-path').value.trim(), numbersPath: $('pc-numbers-path').value.trim() };
  const changed = !pcSettings || apiKey || ['apiRoot', 'projectPath', 'numbersPath'].some(field => input[field] !== pcSettings[field]);
  if (!changed) return;
  const response = await fetch('/api/pc/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'PC 设置保存失败');
  $('pc-key').value = ''; pcDirty = false;
  pcSettings = { ...pcSettings, ...input, apiKey: undefined, keyConfigured: true };
}
async function runQuery(kind) {
  $('pc-error').hidden = true; localQuery = kind; paintQueryButtons();
  try {
    if (kind === 'projects' && !$('pc-project-path').value.trim()) {
      $('pc-endpoints').open = true; $('pc-project-path').focus();
      throw new Error('请填写上司提供的项目查询接口路径，当前 PC 公开说明尚未列出这个接口。');
    }
    await savePcIfNeeded();
    const response = await fetch('/api/pc/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '查询失败');
    queryResults[kind] = result; renderQueryResults(); renderDetail();
  } catch (error) { $('pc-error').textContent = error.message; $('pc-error').hidden = false; }
  finally { localQuery = null; paintQueryButtons(); }
}
for (const id of ['pc-key', 'pc-root', 'pc-project-path', 'pc-numbers-path']) $(id).addEventListener('input', () => { pcDirty = true; });
$('callback-url').addEventListener('input', () => { callbackDirty = true; });
$('pc-form').addEventListener('submit', event => { event.preventDefault(); runQuery('numbers'); });
$('query-projects').addEventListener('click', () => runQuery('projects'));
$('query-numbers').addEventListener('click', () => runQuery('numbers'));
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('settings-error').hidden = true;
  const secret = $('secret').value;
  if (!secret.trim() && !secretConfigured) {
    $('settings-error').textContent = '请先填写 PC 提供的 Webhook 密钥。'; $('settings-error').hidden = false; $('secret').focus(); return;
  }
  $('save-settings').disabled = true;
  try {
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, url: $('callback-url').value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存失败');
    $('secret').value = ''; callbackDirty = false; notice('回调设置已保存，请在 PC 发送测试推送');
  } catch (error) { $('settings-error').textContent = error.message; $('settings-error').hidden = false; }
  finally { $('save-settings').disabled = false; }
});
$('copy-address').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('callback-url').value); notice('地址已复制'); }
  catch { $('callback-url').focus(); $('callback-url').select(); notice('请复制已选中的接收地址'); }
});
const updates = new EventSource('/api/updates');
updates.onmessage = event => {
  try { update(JSON.parse(event.data)); $('connection').textContent = '接收端已连接'; }
  catch { $('connection').textContent = '页面数据读取失败'; }
};
updates.onerror = () => { $('connection').textContent = '接收端断开，正在重连…'; };
