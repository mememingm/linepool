const workspaceUI = { search: '', filter: 'all', inboxFilter: 'all', messageId: '', mobileDetail: false, billScope: 'all' };
const workspacePresentation = { messagePanel: 'list', composerType: 'sms', renewalLeaseId: '', renewalTerm: 7, addonType: 'data', pendingLeaseId: '', selectionError: '' };
const localDemo = () => Boolean(window.OnceMock?.enabled);
const routeParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const isSendPage = () => currentHash() === 'app/send' || (currentHash() === 'app/inbox' && routeParams().has('compose'));
const leaseLink = (route, id, extra = '') => `#/${route}${id ? `?leaseId=${encodeURIComponent(id)}${extra}` : ''}`;
function consoleModel(lease, messages = [], now = Date.now()) {
  const end = new Date(lease.expiresAt).getTime(), start = new Date(lease.startedAt).getTime();
  const known = Number.isFinite(end) && Number.isFinite(start) && end > start;
  const remaining = known ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;
  const status = !known ? 'unknown' : end <= now ? 'expired' : end - now <= 3 * 86400000 ? 'warning' : 'active';
  return { lease, messages, remaining, status, label: { active: '使用中', warning: '即将到期', expired: '已到期', unknown: '租期待确认' }[status], progress: known ? Math.min(100, Math.max(0, Math.round((now - start) / (end - start) * 100))) : null };
}
function sortedLeases() {
  const rank = { warning: 0, active: 1, unknown: 2, expired: 3 };
  return [...remoteState().leases].sort((a, b) => rank[consoleModel(a).status] - rank[consoleModel(b).status] || a.expiresAt.localeCompare(b.expiresAt));
}
function readKey(id) { return `once-read:${session.account?.id}:${id}`; }
function messagesForView() {
  const data = remoteState();
  let read = [];
  try { read = JSON.parse(localStorage.getItem(readKey(data.lease?.id)) || '[]'); if (!Array.isArray(read)) read = []; } catch { /* Unavailable preferences leave messages unread. */ }
  return data.messages.map(message => ({ ...message, leaseId: data.lease?.id, isRead: localDemo() ? message.isRead : read.includes(message.id) }));
}
function leaseBadge(lease) { const model = consoleModel(lease); return `<span class="status-tag ${model.status}">${model.label}</span>`; }
function environmentBanner() {
  return '';
}
function leaseSwitcher() {
  const data = remoteState();
  if (session.dataStatus !== 'ready' || !data.lease || data.leases.length <= 1) return '';
  return `<details class="number-picker"><summary>${icon('smartphone')}<span>${esc(data.lease.number)}</span>${icon('arrow-right')}</summary><div class="picker-options" data-motion-group aria-label="选择号码">${sortedLeases().map(lease => `<button data-lease="${esc(lease.id)}" aria-pressed="${lease.id === data.lease.id}"><span>${esc(lease.number)}<small>${esc(lease.countryName)} · ${esc(lease.regionName)}</small></span>${leaseBadge(lease)}</button>`).join('')}</div></details>`;
}
function appShell(active, content) {
  const items = [['overview', '总览工作台', 'smartphone'], ['numbers', '我的号码', 'smartphone'], ['inbox', '收件箱', 'message-square-text'], ['send', '发送消息', 'message-square-text'], ['voice', '语音通话', 'phone'], ['subscription', '套餐与续费', 'refresh-cw'], ['billing', '订单与账单', 'receipt-text'], ['settings', '账户设置', 'shield-question']];
  const current = active;
  const editorial = ['overview', 'numbers', 'inbox', 'send', 'subscription', 'voice'].includes(active);
  const links = items.map(([key, title, symbol]) => {
    const href = leaseLink(`app/${key}`, ['inbox', 'send', 'subscription'].includes(key) ? selectedLeaseId : '');
    return `<a class="sidebar-link ${current === key ? 'active' : ''}" href="${href}" ${current === key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></a>`;
  }).join('');
  return `<div class="app product-ui once-ui${editorial ? ' workspace-v3' : ''}"${editorial ? ` data-workspace-page="${active}" data-workspace-owner="${esc(session.account?.id || session.account?.email || '')}"` : ''}><div class="app-shell"><aside class="sidebar"><a class="brand" href="#/app/overview"><span class="brand-mark">O</span><span>ONCE</span></a><div class="sidebar-label">号码工作台</div><nav class="sidebar-nav" data-motion-group aria-label="工作台导航">${links}</nav><div class="sidebar-bottom"><div class="workspace-chip"><span class="workspace-avatar">${esc(accountInitial())}</span><span title="${esc(session.account?.email || '')}">${esc(session.account?.email || '')}</span></div><a class="sidebar-help" href="#/help">${icon('circle-help')}帮助中心</a></div></aside><div class="app-main"><div class="app-topbar"><div class="breadcrumb"><a href="#/app/overview">ONCE</a><span>/</span><strong>${items.find(item => item[0] === current)?.[1] || ''}</strong></div><div class="app-toolbar"><button class="icon-btn" data-action="refresh-data" ${remoteAction || session.dataStatus === 'loading' ? 'disabled' : ''} title="刷新账户数据" aria-label="刷新账户数据">${icon('refresh-cw')}</button><button class="icon-btn" data-action="theme" title="切换主题" aria-label="切换主题">${icon(state.theme === 'light' ? 'moon' : 'sun')}</button>${localDemo() ? '<a class="secondary-btn" href="/#/app/numbers">退出预览</a>' : `<button class="account-menu" data-action="logout" ${remoteAction ? 'disabled' : ''}>退出账户</button>`}</div></div>${environmentBanner()}${content}</div></div></div>`;
}
function workspacePending(active) {
  if (session.dataStatus === 'ready') return '';
  const error = session.dataStatus === 'error';
  return appShell(active, `<main class="content">${error ? dataState('暂时无法读取数据', session.dataError, 'retry') : '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-panel" role="status" aria-label="正在加载账户数据"></div>'}</main>`);
}
function pageHeading(title, description, action = true) { return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div>${action ? `<a class="primary-btn" href="#/numbers/new">${icon('plus')}租用新号码</a>` : ''}</div>`; }
function emptyNumbers() { return `<div class="empty-state asset-empty"><div class="empty-mark">${icon('smartphone')}</div><h2>你的第一个独享号码，从这里开始</h2><p>先选地区和租期，再查看可选号码。</p><a class="primary-btn" href="#/numbers/new">${icon('plus')}租用第一个号码</a></div>`; }
function overviewLeaseCountdown(lease) {
  const model = consoleModel(lease);
  const remainingPercent = model.progress === null ? null : 100 - model.progress;
  return `<div class="overview-countdown"><div class="overview-ring ${model.status}" data-lease-ring="${esc(lease.id)}"${remainingPercent === null ? '' : ` data-ring-value="${remainingPercent}"`}>${remainingPercent === null ? '' : `<svg viewBox="0 0 180 180" aria-hidden="true"><circle class="ring-track" cx="90" cy="90" r="78"/>${remainingPercent > 0 ? `<circle class="ring-value" cx="90" cy="90" r="78" pathLength="100" stroke-dasharray="${remainingPercent} 100"/>` : ''}</svg>`}<div><span>剩余租期</span><strong>${model.remaining === null ? '未知' : model.remaining}</strong><small>${model.remaining === null ? '租期待确认' : model.status === 'expired' ? '已到期' : '天'}</small></div></div><p>到期日期 <time datetime="${esc(lease.expiresAt)}">${formatDate(lease.expiresAt)}</time></p></div>`;
}
function overviewUsage() {
  // The account API has no data, outgoing-SMS or voice quota fields.
  // Incoming message counts must never be substituted for an allowance.
  return `<section class="overview-usage" aria-labelledby="overview-usage-title"><div class="overview-section-head"><h2 id="overview-usage-title">套餐使用情况</h2></div><div class="overview-usage-grid">${[['smartphone', '流量', 'DATA'], ['message-square-text', '发短信', 'SMS'], ['phone', '语音分钟', 'VOICE']].map(([symbol, title, label]) => `<div class="overview-meter"><div class="overview-meter-label"><span class="overview-feature-icon">${icon(symbol)}</span><span>${title}<small>${label}</small></span></div><strong>暂未提供</strong><div class="overview-meter-unavailable" aria-hidden="true"></div></div>`).join('')}</div></section>`;
}
function overviewPage() {
  const pending = workspacePending('overview'); if (pending) return pending;
  const data = remoteState(), leases = sortedLeases(), lease = data.lease;
  const heading = `<header class="overview-heading"><div><h1>欢迎回来，</h1><p>你的号码、消息与租期，一处管理。</p></div><a class="secondary-btn" href="#/numbers/new">${icon('plus')}租用新号码</a></header>`;
  if (!lease || !leases.length) return appShell('overview', `<main class="content overview-content">${heading}${emptyNumbers()}</main>`);
  const model = consoleModel(lease), recent = messagesForView().slice(0, 4);
  const activeCount = leases.filter(item => ['active', 'warning'].includes(consoleModel(item).status)).length;
  return appShell('overview', `<main class="content overview-content" aria-busy="false">
    ${heading}
    <section class="overview-number-hero" aria-label="当前号码" data-overview-lease="${esc(lease.id)}">
      <div class="overview-number-info"><div class="overview-number-kicker"><span>当前号码</span>${leaseBadge(lease)}</div>
        <div class="overview-number-title"><h2>${esc(lease.number)}</h2><button class="icon-btn" data-action="copy" data-value="${esc(lease.number)}" aria-label="复制号码" title="复制号码">${icon('copy')}</button></div>
        <p class="overview-number-place">${icon('smartphone')}${esc(lease.countryName)} · ${esc(lease.regionName)}<span>独享号码</span></p>
        <div class="overview-hero-actions"><a class="primary-btn" href="${leaseLink('app/inbox', lease.id)}">${icon('message-square-text')}进入消息中心${icon('arrow-right')}</a><a class="ghost-btn" href="${leaseLink('app/numbers', lease.id)}">管理号码</a></div>
        <p class="overview-lease-note">${model.status === 'expired' ? '历史租约，收件已停止；可查看已保存的消息。' : model.status === 'warning' ? `将在 ${model.remaining} 天内到期，请前往号码详情处理租期。` : model.status === 'unknown' ? '租期数据暂不完整，请刷新或查看号码详情。' : '租期状态依据起止日期计算。'}</p>
      </div>${overviewLeaseCountdown(lease)}
    </section>
    <div class="overview-switch-status" role="status" aria-live="polite"></div>
    ${overviewUsage()}
    <div class="overview-bottom">
      <section class="overview-recent" aria-labelledby="overview-recent-title"><div class="overview-section-head"><h2 id="overview-recent-title">最近消息</h2><a class="link-btn" href="${leaseLink('app/inbox', lease.id)}">查看全部${icon('arrow-right')}</a></div><p class="overview-section-note">当前号码的接收记录 · 共 ${data.messageCount} 条</p><div class="overview-message-list">${recent.length ? recent.map(messageRow).join('') : '<div class="overview-empty-messages">' + icon('message-square-text') + '<h3>还没有收到短信</h3><p>收到的消息会显示在这里。</p></div>'}</div></section>
      <section class="overview-numbers" aria-labelledby="overview-numbers-title"><div class="overview-section-head"><h2 id="overview-numbers-title">我的号码 <span>${leases.length}</span></h2><a class="link-btn" href="#/app/numbers">管理全部${icon('arrow-right')}</a></div><p class="overview-section-note">选择号码，同步查看租期与最近消息</p><div class="overview-number-list" data-motion-group role="group" aria-label="切换总览号码">${leases.map(item => `<button class="overview-number-row ${item.id === lease.id ? 'selected' : ''}" data-lease="${esc(item.id)}" aria-pressed="${item.id === lease.id}"><span class="overview-number-symbol">${icon('smartphone')}</span><span class="overview-number-row-main"><strong>${esc(item.number)}</strong><small>${esc(item.countryName)} · ${esc(item.regionName)}</small></span><span class="overview-number-row-status">${leaseBadge(item)}<small>${consoleModel(item).remaining === null ? '租期待确认' : consoleModel(item).status === 'expired' ? '历史租约' : `剩余 ${consoleModel(item).remaining} 天`}</small></span>${icon('arrow-right')}</button>`).join('')}</div></section>
    </div>
    <footer class="overview-account-note"><span>${activeCount} 个有效号码 · ${leases.length} 份租约</span><a href="#/app/billing">${data.billsCount} 笔订单记录${icon('arrow-right')}</a></footer>
  </main>`);
}
function orderSummary(order) { return `<a class="order-summary" href="${leaseLink('app/billing', order.leaseId)}"><span><strong>${esc(order.kind)} · ${order.term} 天</strong><small>${esc(order.number)} · ${formatDate(order.createdAt)}</small></span><span>${remoteMoney(order.amount, order.currency)}<small>${order.status === '演示已确认' ? '预览订单' : esc(order.status)}</small></span></a>`; }
function numberRow(lease) {
  const model = consoleModel(lease);
  return `<button class="asset-row ${lease.id === selectedLeaseId ? 'selected' : ''}" data-lease="${esc(lease.id)}" aria-pressed="${lease.id === selectedLeaseId}"><div class="number-card-top"><span class="number-card-icon">${icon('smartphone')}</span>${leaseBadge(lease)}</div><strong class="number-card-phone">${esc(lease.number)}</strong><span>${esc(lease.countryName)} · ${esc(lease.regionName)}</span><small>${lease.term} 天套餐 · ${model.status === 'expired' ? '历史租约' : model.remaining === null ? '租期待确认' : `剩余 ${model.remaining} 天`}${typeof lease.unreadCount === 'number' ? `<b>${lease.unreadCount} 未读</b>` : ''}</small></button>`;
}
function numberSelector(leases, filtered, tabs) {
  return `<section class="asset-list number-selector" aria-label="选择号码"><div class="asset-list-label"><div><span>选择号码 <b>${leases.length}</b></span></div><div class="number-scroll-controls"><button class="icon-btn" data-number-scroll="-1" aria-label="向左滚动号码">${icon('arrow-right')}</button><button class="icon-btn" data-number-scroll="1" aria-label="向右滚动号码">${icon('arrow-right')}</button></div></div><div class="asset-controls"><div class="status-tabs" role="group" aria-label="按号码状态筛选">${tabs.map(([status, title]) => `<button data-status="${status}" aria-pressed="${workspaceUI.filter === status}">${title}<span>${status === 'all' ? leases.length : leases.filter(lease => consoleModel(lease).status === status).length}</span></button>`).join('')}</div><label class="asset-search" for="lease-search">${icon('smartphone')}<input type="search" id="lease-search" placeholder="搜索号码或地区" aria-label="搜索号码或地区" value="${esc(workspaceUI.search)}"></label></div><div class="asset-scroll" role="group" aria-label="号码卡片，可使用左右方向键切换">${filtered.length ? filtered.map(numberRow).join('') : '<div class="list-empty"><h3>没有匹配号码</h3><p>试试其他号码、地区或状态。</p><button class="secondary-btn" data-action="clear-search">清除筛选</button></div>'}</div></section>`;
}
function numbersPage() {
  const pending = workspacePending('numbers'); if (pending) return pending;
  const data = remoteState(), leases = sortedLeases();
  const heading = `<header class="overview-heading numbers-heading"><div><h1>我的号码</h1><p>独享号码、接收记录与租期，一处管理。</p></div><a class="secondary-btn" href="#/numbers/new">${icon('plus')}租用新号码</a></header>`;
  if (!leases.length) return appShell('numbers', `<main class="content numbers-content">${heading}${emptyNumbers()}</main>`);
  const selected = data.lease, single = leases.length === 1;
  const filtered = leases.filter(lease => (workspaceUI.filter === 'all' || consoleModel(lease).status === workspaceUI.filter) && `${lease.number} ${lease.countryName} ${lease.regionName}`.toLowerCase().includes(workspaceUI.search.toLowerCase()));
  const tabs = [['all', '全部'], ['active', '使用中'], ['warning', '即将到期'], ['expired', '已到期']];
  const model = consoleModel(selected), messages = messagesForView().slice(0, 3), orders = data.bills.filter(order => order.leaseId === selected.id);
  const canRenew = !['unknown', 'expired'].includes(model.status) && data.demo;
  const quota = localDemo() ? selected.smsSendQuota : null;
  return appShell('numbers', `<main class="content numbers-content">
    ${heading}
    <div class="number-workspace ${single ? 'single-number' : ''}">
      ${single ? '' : numberSelector(leases, filtered, tabs)}
      <section class="asset-detail" aria-label="选中号码详情" data-lease-detail="${esc(selected.id)}">
        <div class="number-detail-content">
          <section class="numbers-hero" aria-label="当前号码与租期">
            <div class="numbers-hero-main">
              <div class="numbers-kicker"><span class="numbers-phone-icon">${icon('smartphone')}</span><span>当前号码</span>${leaseBadge(selected)}</div>
              <div class="number-title"><h2 class="lease-phone">${esc(selected.number)}</h2><button class="icon-btn copy-number" data-action="copy" data-value="${esc(selected.number)}" aria-label="复制号码" title="复制号码">${icon('copy')}</button></div>
              <p class="numbers-location">${esc(selected.countryName)}<span>·</span>${esc(selected.regionName)}<span class="numbers-exclusive">独享号码</span></p>
              <div class="detail-actions"><a class="primary-btn" href="${leaseLink('app/inbox', selected.id)}">${icon('message-square-text')}查看短信</a><button class="secondary-btn" data-action="renew" ${canRenew && !remoteAction ? '' : 'disabled'}>${icon('refresh-cw')}同号续费</button><a class="ghost-btn" href="${leaseLink('app/subscription', selected.id)}">套餐与续费${icon('arrow-right')}</a></div>
              <p class="numbers-state-note">${model.status === 'expired' ? '历史租约，收件已停止。已保存的短信仍可查看。' : model.status === 'warning' ? `将在 ${model.remaining} 天内到期，请及时处理租期。` : model.status === 'unknown' ? '租期数据暂不完整，请刷新后查看。' : '租期内独立管理，短信按当前号码归档。'}</p>
            </div>
            ${overviewLeaseCountdown(selected)}
          </section>
          <div class="numbers-facts" aria-label="当前租约信息">
            <div><span>到期日期</span><strong>${formatDate(selected.expiresAt)}</strong><small>${selected.term} 天独享套餐</small></div>
            <div><span>已接收 SMS</span><strong>${data.messageCount}<small> 条</small></strong><small>当前租约累计接收记录</small></div>
            <div><span>租赁开始</span><strong>${formatDate(selected.startedAt)}</strong></div>
          </div>
          <section class="numbers-capabilities" aria-label="号码能力状态">
            ${[
              ['message-square-text', '接收 SMS', model.status === 'expired' ? '已停止' : selected.demo && data.demo ? '预览' : '能力待确认', model.status === 'expired' ? 'expired' : selected.demo && data.demo ? 'available' : 'pending'],
              ['arrow-right', '发送 SMS', '待接入', 'pending'],
              ['image', 'MMS', '即将推出', 'pending'],
              ['phone', 'Voice', '即将推出', 'pending']
            ].map(([symbol, title, label, status]) => `<div class="numbers-capability ${status}"><span class="numbers-capability-icon">${icon(symbol)}</span><span>${title}<small>${label}</small></span></div>`).join('')}
          </section>
          ${quota ? `<div class="send-quota"><span>发送额度 · 未启用</span><strong>${quota.remaining} / ${quota.total} 条剩余</strong><small>已使用 ${quota.used} 条，接收 SMS 不扣减此额度</small></div>` : ''}
          <div class="number-related">
            <section class="numbers-related-panel"><div class="section-row"><div><h2>最近短信${localDemo() && typeof selected.unreadCount === 'number' ? `<span class="numbers-unread-count">${selected.unreadCount} 未读</span>` : ''}</h2><p>当前号码的接收记录</p></div><a class="link-btn" href="${leaseLink('app/inbox', selected.id)}">查看全部${icon('arrow-right')}</a></div>${messages.length ? messages.map(messageRow).join('') : `<div class="numbers-related-empty">${icon('message-square-text')}<h3>还没有收到短信</h3><p>收到的消息会显示在这里。</p></div>`}</section>
            <section class="numbers-related-panel"><div class="section-row"><div><h2>租赁与续费</h2><p>与当前号码关联的订单</p></div><a class="link-btn" href="${leaseLink('app/billing', selected.id)}">订单详情${icon('arrow-right')}</a></div>${orders.length ? orders.slice(0, 2).map(orderSummary).join('') : `<div class="numbers-related-empty">${icon('receipt-text')}<h3>暂无关联订单</h3><p>当前已载入的记录中没有关联订单。</p></div>`}${data.truncated?.bills ? '<p class="card-muted">仅检索最近 200 笔账户订单。</p>' : ''}</section>
          </div>
          <details class="lease-extra"><summary><span>${icon('receipt-text')}租赁详情</span>${icon('arrow-right')}</summary><dl class="detail-list"><div><dt>租赁开始</dt><dd>${formatDate(selected.startedAt)}</dd></div><div><dt>套餐费用</dt><dd>${remoteMoney(selected.price, selected.currency)}</dd></div><div><dt>自动续费</dt><dd>未开启</dd></div><div><dt>租约编号</dt><dd>${esc(selected.id)}</dd></div></dl></details>
        </div>
      </section>
    </div>
  </main>`);
}
function messageRow(message) {
  const id = message.leaseId || remoteState().lease?.id;
  return `<a class="message-card" href="${leaseLink('app/inbox', id, `&messageId=${encodeURIComponent(message.id)}`)}"><div class="message-card-main"><div class="message-card-meta"><span>${esc(message.sender)}</span><time>${formatDateTime(message.receivedAt)}</time>${message.isRead === false ? '<b class="unread-label">未读</b>' : ''}</div><strong>${esc(message.title)}</strong><p>${esc(message.body)}</p></div>${icon('arrow-right')}</a>`;
}
function messageComposer() {
  const type = workspacePresentation.composerType;
  return `<section class="message-composer" data-editor-mode="${type}" aria-labelledby="composer-title"><div class="composer-heading"><h2 id="composer-title">编辑消息</h2><div class="composer-types" data-motion-group role="group" aria-label="消息类型">${[['sms', '文字短信 SMS'], ['mms', '图片或视频 MMS']].map(([key, title]) => `<button data-composer-type="${key}" aria-pressed="${type === key}">${title}</button>`).join('')}</div></div><p class="composer-status">${icon('circle-help')}<span>${type === 'mms' ? 'MMS 尚未接入，媒体上传和发送暂不可用。' : '短信发送尚未接入，当前仅支持查看接收的 SMS。'}</span></p><fieldset disabled aria-label="消息发送尚未开放"><label for="message-recipient">接收号码</label><input id="message-recipient" type="tel" placeholder="${type === 'mms' ? 'MMS 接收号码' : '接收号码'}" autocomplete="off"><label for="message-body">${type === 'mms' ? '附加文字' : '短信内容'}</label><textarea id="message-body" rows="10" placeholder="发送功能接入后可在这里编辑内容"></textarea>${type === 'mms' ? `<div class="mms-attachment-placeholder">${icon('image')}<span>附件预览区 · 上传尚未开放</span><button type="button" disabled>添加图片或视频</button></div>` : ''}<div class="composer-footer"><span>暂不可发送</span><button class="primary-btn" type="button" disabled>${icon(type === 'mms' ? 'image' : 'message-square-text')}发送 ${type.toUpperCase()}</button></div></fieldset></section>`;
}
function messageNumberInspector(lease) {
  const model = consoleModel(lease);
  return `<aside class="message-inspector"><div class="inspector-heading"><h2 tabindex="-1">号码信息</h2><a class="link-btn" href="${leaseLink('app/numbers', lease.id)}">管理号码${icon('arrow-right')}</a></div><div class="inspector-number"><strong>${esc(lease.number)}</strong><button class="icon-btn" data-action="copy" data-value="${esc(lease.number)}" aria-label="复制当前号码">${icon('copy')}</button></div>${leaseBadge(lease)}<p class="inspector-region">${esc(lease.countryName)} · ${esc(lease.regionName)}</p><dl class="inspector-lease"><div><dt>剩余租期</dt><dd>${model.remaining === null ? '待确认' : model.status === 'expired' ? '已到期' : `${model.remaining} 天`}</dd></div><div><dt>到期日期</dt><dd>${formatDate(lease.expiresAt)}</dd></div></dl><div class="inspector-usage">${overviewUsage()}</div><div class="inspector-actions"><h3>租期与套餐</h3><a class="inspector-link" href="${leaseLink('app/subscription', lease.id)}"><span class="overview-feature-icon">${icon('refresh-cw')}</span><span><strong>套餐与续费</strong><small>查看租期与可用操作</small></span>${icon('arrow-right')}</a><div class="inspector-unavailable"><span class="overview-feature-icon">${icon('plus')}</span><span><strong>购买叠加包</strong><small>商品与购买能力尚未接入</small></span></div></div></aside>`;
}
function inboxPage() {
  const pending = workspacePending('inbox'); if (pending) return pending;
  const data = remoteState();
  if (!data.lease) return appShell('inbox', `<main class="content">${pageHeading('收件箱', '按号码查看你的 SMS。', false)}${emptyNumbers()}</main>`);
  const messages = messagesForView(), unread = messages.filter(message => !message.isRead).length;
  const filtered = messages.filter(message => workspaceUI.inboxFilter === 'all' || (workspaceUI.inboxFilter === 'unread' ? !message.isRead : message.isRead));
  const current = messages.find(message => message.id === workspaceUI.messageId);
  const model = consoleModel(data.lease);
  const panel = workspacePresentation.messagePanel === 'info' ? 'detail' : workspacePresentation.messagePanel;
  return appShell('inbox', `<main class="content message-content">${pageHeading('收件箱', '一个号码，一个独立的消息空间。', false)}<div class="message-toolbar"><span>${icon('smartphone')}当前收件号码</span>${leaseSwitcher() || `<strong>${esc(data.lease.number)}</strong>`}<span class="message-lease-summary" aria-label="当前号码状态与租期">${leaseBadge(data.lease)}<span class="message-lease-remaining">${model.remaining === null ? '租期待确认' : model.status === 'expired' ? '已到期' : `剩余 ${model.remaining} 天`}</span></span><a class="link-btn" href="${leaseLink('app/subscription', data.lease.id)}">查看租期${icon('arrow-right')}</a></div><div class="inbox-layout message-workspace" data-lease-context="${esc(data.lease.id)}" data-message-panel="${panel}">
    <section class="inbox-list" aria-label="当前号码的短信列表"><div class="inbox-list-head"><div class="section-row"><h2 tabindex="-1">收件箱 <span>${data.messageCount}</span></h2><button class="link-btn" data-action="read-all" ${unread && !remoteAction ? '' : 'disabled'}>全部已读</button></div><div class="message-filters" data-motion-group role="group" aria-label="短信已读状态">${[['all', '全部'], ['unread', `未读 ${unread}`], ['read', '已读']].map(([filter, title]) => `<button data-message-filter="${filter}" aria-pressed="${workspaceUI.inboxFilter === filter}">${title}</button>`).join('')}</div>${data.truncated?.messages ? '<p>最近 200 条</p>' : ''}</div><div class="message-scroll">${filtered.length ? filtered.map(message => `<button class="inbox-item ${message.id === current?.id ? 'active' : ''} ${message.isRead ? 'read' : 'unread'}" data-open-message="${esc(message.id)}" aria-pressed="${message.id === current?.id}"><span class="message-sender-avatar" aria-hidden="true">${esc((message.sender || '?').slice(0, 1))}</span><span class="inbox-item-content"><span class="inbox-item-meta"><strong>${esc(message.sender)}</strong><time>${formatDateTime(message.receivedAt)}</time></span><span class="inbox-item-title">${esc(message.title)}${message.isRead ? '' : '<span class="unread-dot" aria-label="未读"></span>'}</span><span class="inbox-item-preview">${esc(message.body)}</span></span></button>`).join('') : `<div class="inbox-empty">${icon('message-square-text')}<strong>${messages.length ? '没有匹配的短信' : '还没有收到短信'}</strong><p>${messages.length ? '试试其他已读状态。' : '收到的 SMS 会显示在这里。'}</p></div>`}</div>${data.demo ? `<div class="message-demo-action"><button class="secondary-btn" data-action="demo-message" ${remoteAction || ['expired', 'unknown'].includes(model.status) ? 'disabled' : ''}>${icon('plus')}模拟收件</button></div>` : ''}</section>
    <section class="inbox-detail message-conversation" aria-label="短信正文"><header class="conversation-header"><button class="icon-btn message-back" data-message-panel="list" aria-label="返回短信列表">${icon('arrow-right')}</button><div><h2 tabindex="-1">${current ? esc(current.sender) : '消息详情'}</h2><p>${current ? `接收至 ${esc(data.lease.number)}` : '选择一条记录查看完整内容'}</p></div></header><div class="message-reading" data-message-id="${esc(current?.id || '')}">${current ? `<dl class="message-source"><div><dt>来源</dt><dd>${esc(current.sender)}</dd></div><div><dt>接收时间</dt><dd><time datetime="${esc(current.receivedAt)}">${formatDateTime(current.receivedAt)}</time></dd></div></dl><article class="received-message"><span class="message-direction">接收 SMS</span><h3>${esc(current.title)}</h3><div class="sms-body">${esc(current.body)}</div><button class="link-btn" data-action="copy" data-value="${esc(current.body)}">${icon('copy')}复制正文</button></article>${current.code ? `<div class="sms-code"><span>验证码</span><strong>${esc(current.code)}</strong><button class="icon-btn" data-action="copy" data-value="${esc(current.code)}" title="复制验证码" aria-label="复制验证码">${icon('copy')}</button></div>` : ''}` : `<div class="message-placeholder"><div class="empty-mark">${icon('message-square-text')}</div><h2>选择一条短信</h2><p>从左侧选择一条 SMS 查看正文、来源和时间。</p><button class="secondary-btn message-list-cta" data-message-panel="list">查看收件箱</button></div>`}</div></section>
  </div></main>`);
}
function sendPage() {
  const pending = workspacePending('send'); if (pending) return pending;
  const data = remoteState();
  const heading = pageHeading('发送消息', '选择发送号码，编辑 SMS 或 MMS。', false);
  if (!data.lease) return appShell('send', `<main class="content send-content">${heading}${emptyNumbers()}</main>`);
  return appShell('send', `<main class="content send-content">${heading}<div class="message-toolbar"><span>${icon('smartphone')}发送号码</span>${leaseSwitcher() || `<strong>${esc(data.lease.number)}</strong>`}${leaseBadge(data.lease)}</div><div class="send-workspace" data-lease-context="${esc(data.lease.id)}">${messageComposer()}<section class="send-history" aria-labelledby="send-history-title"><div class="section-row"><h2 id="send-history-title">发送记录</h2><span class="status-tag unknown">尚未接入</span></div><div class="inbox-empty">${icon('message-square-text')}<strong>发送记录暂不可用</strong><p>发送服务及记录查询尚未接入，暂无可展示的发送状态。</p></div></section></div></main>`);
}
function subscriptionPage() {
  const pending = workspacePending('subscription'); if (pending) return pending;
  const data = remoteState(), lease = data.lease;
  if (!lease) return appShell('subscription', `<main class="content">${pageHeading('套餐与续费', '查看号码租期与当前套餐。', false)}${emptyNumbers()}</main>`);
  const model = consoleModel(lease), canRenew = data.demo && !['expired', 'unknown'].includes(model.status);
  const selectedTerm = workspacePresentation.renewalLeaseId === lease.id ? workspacePresentation.renewalTerm : 7;
  const chosen = terms.find(term => term.days === selectedTerm) || terms[0];
  const orders = data.bills.filter(order => order.leaseId === lease.id).slice(0, 4);
  const addon = { data: ['流量', '流量叠加包'], sms: ['发短信', '短信发送叠加包'], voice: ['语音分钟', '语音分钟叠加包'] }[workspacePresentation.addonType];
  return appShell('subscription', `<main class="content subscription-content">${pageHeading('套餐与续费', '看清当前租期，按现有服务流程管理续费。', false)}<div class="subscription-switcher"><span>管理号码</span>${leaseSwitcher() || `<strong>${esc(lease.number)}</strong>`}</div><section class="subscription-hero" aria-label="当前租赁"><div class="subscription-number"><span class="subscription-eyebrow">当前租赁</span><h2>${esc(lease.number)}</h2><p>${esc(lease.countryName)} · ${esc(lease.regionName)}</p>${leaseBadge(lease)}<dl><div><dt>开始日期</dt><dd>${formatDate(lease.startedAt)}</dd></div><div><dt>到期日期</dt><dd>${formatDate(lease.expiresAt)}</dd></div><div><dt>已记录租期</dt><dd>${Number.isFinite(lease.term) ? `${lease.term} 天` : '暂未提供'}</dd></div></dl></div>${overviewLeaseCountdown(lease)}<div class="subscription-hero-actions"><button class="primary-btn" data-action="renew" data-renew-choice="${chosen.days}" ${canRenew && !remoteAction ? '' : 'disabled'}>${icon('refresh-cw')}${data.demo ? '续费' : '续费暂不可用'}</button><a class="secondary-btn" href="${leaseLink('app/numbers', lease.id)}">查看号码详情</a>${data.demo ? '' : '<p>续费暂不可用</p>'}</div></section>
    ${overviewUsage()}
    <section class="subscription-section renewal-section"><div class="overview-section-head"><h2>延长租期</h2></div><p class="subscription-section-note">${model.status === 'expired' ? '当前租约已到期，恢复资格等待上游确认，暂不能续费。' : model.status === 'unknown' ? '租期数据不完整，暂不能续费。' : data.demo ? '选择续费时长。' : '续费商品与支付能力尚未接入，暂不展示可购买的租期或价格。'}</p>${data.demo ? `<div class="subscription-terms" data-motion-group role="group" aria-label="续费租期">${terms.map(term => `<button data-subscription-term="${term.days}" aria-pressed="${term.days === chosen.days}" ${canRenew && !remoteAction ? '' : 'disabled'}><span>${term.label}</span><strong>${term.days}<small> 天</small></strong><b>${remoteMoney(term.price, lease.currency)}</b></button>`).join('')}</div><div class="subscription-confirm"><span>${canRenew ? `已选 ${chosen.days} 天 · ${remoteMoney(chosen.price, lease.currency)}` : '当前租约暂不支持续费'}</span><button class="primary-btn" data-action="renew" data-renew-choice="${chosen.days}" ${canRenew && !remoteAction ? '' : 'disabled'}>确认续费${icon('arrow-right')}</button></div>` : `<div class="subscription-unavailable">${icon('clock-3')}<span>尚无可用续费商品</span><button class="secondary-btn" disabled>暂不可在线续费</button></div>`}</section>
    <section class="subscription-section addon-section"><div class="overview-section-head"><h2>购买叠加包</h2><div class="addon-types" data-motion-group role="group" aria-label="叠加包类型">${[['data', '流量'], ['sms', '发短信'], ['voice', '语音分钟']].map(([type, label]) => `<button data-addon-type="${type}" aria-pressed="${type === workspacePresentation.addonType}">${label}</button>`).join('')}</div></div><div class="addon-empty"><span class="overview-feature-icon">${icon(workspacePresentation.addonType === 'voice' ? 'phone' : workspacePresentation.addonType === 'sms' ? 'message-square-text' : 'smartphone')}</span><div><h3>${addon[1]}尚未接入</h3><p>商品、额度和价格尚未提供，暂不支持在线购买。</p></div><button class="secondary-btn" disabled>暂不可购买</button></div></section>
    <section class="subscription-section subscription-history"><div class="overview-section-head"><h2>订购与续费记录</h2><a class="link-btn" href="${leaseLink('app/billing', lease.id)}">查看全部订单${icon('arrow-right')}</a></div><div class="subscription-orders">${orders.length ? orders.map(orderSummary).join('') : '<p class="subscription-section-note">已载入的记录中暂无关联订单。</p>'}</div>${data.truncated?.bills ? '<p class="subscription-section-note">关联记录来自最近 200 笔账户订单。</p>' : ''}</section>
  </main>`);
}
function voicePage() {
  const lease = session.dataStatus === 'ready' ? remoteState().lease : null;
  const keys = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
  return appShell('voice', `<main class="content voice-content"><header class="voice-heading"><h1>语音通话</h1><span>功能开发中</span><p>语音能力尚未开放。这里展示未来的通话界面。</p></header><div class="voice-layout"><section class="voice-preview" aria-labelledby="voice-preview-title"><div class="voice-preview-top"><span>${icon('phone')}拨号盘预览</span><span>未开放</span></div><h2 id="voice-preview-title" class="visually-hidden">不可交互的语音拨号盘预览</h2><div class="voice-source">${lease ? esc(lease.number) : '尚未选择号码'}<small>仅供界面预览</small></div><div class="voice-number-placeholder">输入电话号码</div><div class="voice-dialpad" aria-hidden="true">${keys.map(([key, letters]) => `<span><strong>${key}</strong><small>${letters || '&nbsp;'}</small></span>`).join('')}</div><button class="voice-call-button" disabled aria-label="语音通话未开放，无法拨打">${icon('phone')}</button><p class="voice-preview-caption">拨号暂不可用</p><div class="voice-preview-note">${icon('circle-help')}<p><strong>语音功能尚未接入</strong><span>预览不会拨打电话或申请麦克风权限。</span></p></div></section><section class="voice-roadmap" aria-labelledby="voice-roadmap-title"><h2 id="voice-roadmap-title">功能预览</h2><p>以下为规划中的能力，当前均尚未开放。</p><div class="voice-features">${[['phone','拨打与接听','语音通话能力等待后续接入。'],['receipt-text','通话记录','通话记录的查询与展示尚未开放。'],['message-square-text','语音信箱','语音留言的接收与播放尚未开放。']].map(([symbol, title, text]) => `<article><span class="overview-feature-icon">${icon(symbol)}</span><div><h3>${title}</h3><p>${text}</p></div><span class="voice-feature-state">尚未开放</span></article>`).join('')}</div><div class="voice-availability"><span class="overview-feature-icon">${icon('clock-3')}</span><div><h3>敬请期待</h3><p>开放时间以实际服务接入情况为准。</p><a class="link-btn" href="${leaseLink('app/inbox', lease?.id)}">先查看接收的短信${icon('arrow-right')}</a></div></div></section></div></main>`);
}
function billingPage() {
  const pending = workspacePending('billing'); if (pending) return pending;
  const data = remoteState(), scope = routeParams().get('leaseId');
  const lease = data.leases.find(item => item.id === scope);
  const bills = data.bills.filter(bill => !scope || bill.leaseId === scope);
  return appShell('billing', `<main class="content">${pageHeading('订单与账单', '购买与同号续费，按号码留存。', false)}<div class="billing-toolbar"><strong>${lease ? esc(lease.number) : '全部号码'}</strong>${scope ? '<a class="secondary-btn" href="#/app/billing">查看全部订单</a>' : ''}<span>${scope ? `${bills.length} 笔已载入记录` : `${data.billsCount} 笔账户订单`}</span></div>${bills.length ? `<div class="billing-table"><div class="bill-row header"><span>订单与租期</span><span>关联号码</span><span>时间 / 金额</span><span>状态</span></div>${bills.map(bill => `<article class="bill-row"><div><strong>${esc(bill.kind)} · ${bill.term} 天</strong><small>${esc(bill.id)}</small></div>${bill.leaseId ? `<a href="${leaseLink('app/numbers', bill.leaseId)}">${esc(bill.number)}</a>` : `<span>${esc(bill.number)}</span>`}<div>${formatDate(bill.createdAt)}<small>${remoteMoney(bill.amount, bill.currency)}</small></div><span class="bill-status">${esc(bill.status === '演示已确认' ? (localDemo() ? '预览订单' : '沙盒已确认') : ({PENDING:'待交付', PROCESSING:'处理中', UNCERTAIN:'结果待核对', FAILED:'交付失败'}[bill.status] || bill.status))}${!localDemo() && data.demo && ['PENDING','PROCESSING','UNCERTAIN'].includes(bill.status) ? `<button class="link-btn" data-action="reconcile-order" data-order-id="${esc(bill.id)}" ${remoteAction ? 'disabled' : ''}>核对交付</button>` : ''}</span></article>`).join('')}</div>` : '<div class="empty-state compact"><h2>暂无订单记录</h2><p>完成租赁后，可在这里查看关联记录。</p></div>'}${data.truncated?.bills ? '<p class="card-muted">仅展示最近 200 笔账户订单，不代表完整历史。</p>' : ''}</main>`);
}
function settingsPage() {
  return appShell('settings', `<main class="content">${pageHeading('账户设置', '基本资料与显示偏好。', false)}<section class="settings-section"><h2>账户信息</h2><dl class="settings-list"><div><dt>邮箱</dt><dd>${esc(session.account?.email || '')}</dd></div><div><dt>数据来源</dt><dd>${localDemo() ? '当前浏览器' : '账户服务'}</dd></div></dl></section><section class="settings-section"><h2>显示偏好</h2><button class="secondary-btn" data-action="theme">${icon(state.theme === 'dark' ? 'sun' : 'moon')}${state.theme === 'dark' ? '切换浅色' : '切换深色'}</button></section>${localDemo() ? '<section class="settings-section"><h2>预览设置</h2><button class="secondary-btn" data-action="demo-scenes">切换或重置场景</button></section>' : ''}</main>`);
}
function demoScenesModal() {
  return `<div class="modal-backdrop product-ui once-ui" data-action="close-scenes"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="scenes-title"><div class="modal-head"><h2 id="scenes-title">预览场景</h2><button class="modal-close" data-action="close-scenes" aria-label="关闭" title="关闭">×</button></div><div class="modal-body"><p class="renew-description">切换场景会重置当前预览，不影响账户数据。</p><div class="scene-options">${Object.entries(OnceMock.scenes).map(([id, label]) => `<button class="secondary-btn" data-scene="${id}" aria-pressed="${OnceMock.scene === id}">${label}</button>`).join('')}</div><button class="secondary-btn reset-demo" data-action="reset-demo">${icon('refresh-cw')}重置当前场景</button></div></section></div>`;
}
function uxFooter() { return `<footer class="section ux-footer"><div class="container"><span>ONCE · 独享号码租赁</span><span>短信发送、MMS 与 Voice 暂未开放。</span></div></footer>`; }
