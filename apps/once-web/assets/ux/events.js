async function readMessages(messageId = '') {
  const lease = remoteState().lease;
  if (!lease) return;
  const viewVersion = workspaceRouteVersion, owner = selectionKey();
  const currentView = () => viewVersion === workspaceRouteVersion && owner === selectionKey() && lease.id === selectedLeaseId;
  try {
    if (localDemo()) {
      await OnceMock.markRead(lease.id, messageId);
      if (!currentView()) return;
      await loadSnapshot(lease.id, { quiet: true });
    }
    else {
      const messages = messagesForView();
      const read = [...new Set(messages.filter(message => message.isRead || !messageId || message.id === messageId).map(message => message.id))];
      localStorage.setItem(readKey(lease.id), JSON.stringify(read));
    }
  } catch (error) { if (currentView()) showToast(errorMessage(error, '已读状态保存失败。'), 'error'); }
  if (currentView()) render({ background: currentHash() === 'app/inbox' });
}
function showMessagePanel(panel, moveFocus = false) {
  workspacePresentation.messagePanel = panel;
  const workspace = document.querySelector('.message-workspace');
  if (!workspace) return;
  const previous = workspace.dataset.messagePanel;
  workspace.dataset.messagePanel = panel;
  if (previous !== panel && window.matchMedia('(max-width:1100px)').matches) {
    const view = workspace.querySelector({ list: '.inbox-list', detail: '.message-conversation', info: '.message-inspector-container' }[panel]);
    animateWorkspace(view, { opacity: [0, 1], y: [4, 0] }, { duration: .18 });
  }
  if (moveFocus) {
    const target = workspace.querySelector({ list: '.inbox-item.active, .inbox-list-head h2', detail: '.conversation-header h2', info: '.inspector-heading h2' }[panel]);
    target?.focus({ preventScroll: true });
  }
}
async function resetDemo(scene) {
  if (!localDemo() || remoteAction) return;
  try {
    OnceMock.reset(scene);
    window.showScenes = false; window.showRenew = false;
    selectedLeaseId = ''; workspaceUI.messageId = ''; workspaceUI.search = ''; workspaceUI.filter = 'all'; workspaceUI.inboxFilter = 'all'; workspaceUI.mobileDetail = false;
    inventoryCache = null; inventoryError = '';
    wizard = { country:null, region:null, term:null, number:null, step:1, agreed:false };
    const url = new URL(location.href); url.searchParams.set('scenario', scene); url.hash = '/app/numbers';
    history.replaceState(null, '', url);
    await loadSnapshot(''); render();
    showToast('本地演示场景已重置，账户数据未改变。');
  } catch (error) { showToast(errorMessage(error), 'error'); }
}
function renderWizardStep() {
  render();
  const title = document.querySelector('.wizard-title h2');
  if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
// Presentation only: reuse the existing router, snapshots and business handlers.
const workspaceMotionJobs = new Map();
const workspaceRingValues = new Map();
const workspaceSeenMessages = new Map();
let workspaceSkeletonTimer;
function animateWorkspace(element, keyframes, options = {}) {
  if (!element) return null;
  workspaceMotionJobs.get(element)?.stop();
  workspaceMotionJobs.delete(element);
  if (!window.Motion || reducedNumberMotion()) return null;
  const animation = Motion.animate(element, keyframes, { duration: .21, ease: [.22, 1, .36, 1], ...options });
  workspaceMotionJobs.set(element, animation);
  animation.then(() => { if (workspaceMotionJobs.get(element) === animation) workspaceMotionJobs.delete(element); });
  return animation;
}
function syncWorkspaceMarkers(root = document, animate = true) {
  const groups = [...root.querySelectorAll('[data-motion-group]')];
  if (root.matches?.('[data-motion-group]')) groups.unshift(root);
  for (const group of groups) {
    if (!group.closest('.workspace-v3, .workspace-dialog')) continue;
    const selected = group.querySelector('[aria-current="page"], [aria-pressed="true"]');
    if (!selected?.getClientRects().length) continue;
    let marker = group.querySelector(':scope > [data-motion-indicator]');
    const bounds = group.getBoundingClientRect(), target = selected.getBoundingClientRect();
    const x = target.left - bounds.left + group.scrollLeft, y = target.top - bounds.top + group.scrollTop;
    const geometry = `${x}:${y}:${target.width}:${target.height}`;
    if (marker) marker.style.opacity = selected.disabled ? '.45' : '1';
    if (marker?.dataset.motionTarget === geometry && animate) continue;
    const previous = marker?.getBoundingClientRect();
    if (!marker) {
      marker = document.createElement('span'); marker.dataset.motionIndicator = ''; marker.setAttribute('aria-hidden', 'true'); group.prepend(marker);
    }
    workspaceMotionJobs.get(marker)?.stop();
    marker.dataset.motionTarget = geometry;
    marker.style.opacity = selected.disabled ? '.45' : '1';
    marker.style.width = `${target.width}px`; marker.style.height = `${target.height}px`;
    marker.style.transform = `translate(${x}px, ${y}px)`;
    if (animate && previous?.width && previous.height) animateWorkspace(marker, {
      x: [previous.left - bounds.left + group.scrollLeft, x], y: [previous.top - bounds.top + group.scrollTop, y],
      scaleX: [previous.width / target.width, 1], scaleY: [previous.height / target.height, 1]
    });
  }
}
function syncWorkspaceMotion() {
  const root = app.querySelector('.workspace-v3');
  for (const [element, animation] of workspaceMotionJobs) if (!element.isConnected) { animation.stop(); workspaceMotionJobs.delete(element); }
  if (!root) return;
  syncWorkspaceMarkers();
  root.querySelectorAll('.number-picker').forEach(picker => {
    if (picker.onceMotionBound) return;
    picker.onceMotionBound = true;
    picker.addEventListener('toggle', () => syncWorkspaceMarkers(picker, false));
    // Presentation only: leave the existing data-lease click and route handlers intact.
    picker.addEventListener('keydown', event => {
      const summary = picker.querySelector('summary');
      const choices = [...picker.querySelectorAll('.picker-options button:not(:disabled)')];
      if (event.key === 'Escape' && picker.open) {
        event.preventDefault(); event.stopPropagation(); picker.open = false; summary?.focus(); return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !choices.length) return;
      event.preventDefault(); picker.open = true;
      const current = choices.indexOf(document.activeElement);
      const selected = choices.findIndex(button => button.getAttribute('aria-pressed') === 'true');
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : current < 0 ? Math.max(0, selected) : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices[next].focus({ preventScroll: true }); choices[next].scrollIntoView({ block: 'nearest' });
    });
    picker.addEventListener('click', event => {
      if (event.target.closest('.picker-options button[data-lease]')) picker.open = false;
    });
    picker.addEventListener('focusout', event => {
      if (event.relatedTarget && !picker.contains(event.relatedTarget)) picker.open = false;
    });
  });
  root.querySelectorAll('[data-lease-ring][data-ring-value]').forEach(ring => {
    const circle = ring.querySelector('.ring-value'), value = Number(ring.dataset.ringValue);
    if (!Number.isFinite(value)) return;
    const key = `${selectionKey()}:${ring.dataset.leaseRing}`, previous = workspaceRingValues.get(key);
    workspaceRingValues.set(key, value);
    if (!circle || previous === value) return;
    circle.style.strokeDasharray = `${value} 100`;
    animateWorkspace(circle, { strokeDasharray: [`${previous ?? 0} 100`, `${value} 100`] }, { duration: .36 });
  });
  if (session.dataStatus === 'ready' && selectedLeaseId) {
    const key = `${selectionKey()}:${selectedLeaseId}`, seen = workspaceSeenMessages.get(key) || new Set();
    remoteState().messages.forEach(message => seen.add(message.id));
    workspaceSeenMessages.set(key, new Set([...seen].slice(-400)));
  }
  while (workspaceRingValues.size > 64) workspaceRingValues.delete(workspaceRingValues.keys().next().value);
  while (workspaceSeenMessages.size > 32) workspaceSeenMessages.delete(workspaceSeenMessages.keys().next().value);
  if (workspacePresentation.pendingLeaseId) paintWorkspaceSelection(workspacePresentation.pendingLeaseId, workspacePresentation.selectionError);
}
// Dismiss only the visible picker; account data, selection and routes are untouched.
document.addEventListener('pointerdown', event => {
  document.querySelectorAll('.number-picker[open]').forEach(picker => {
    if (!picker.contains(event.target)) picker.open = false;
  });
});
function syncWorkspaceAttributes(current, next) {
  for (const name of current.getAttributeNames()) if (!next.hasAttribute(name)) current.removeAttribute(name);
  for (const attribute of next.attributes) current.setAttribute(attribute.name, attribute.value);
}
function patchWorkspaceChoices(current, next) {
  const buttons = [...current.querySelectorAll(':scope > a, :scope > button')];
  const replacements = [...next.querySelectorAll(':scope > a, :scope > button')];
  if (buttons.length !== replacements.length) { current.replaceChildren(...next.childNodes); return; }
  buttons.forEach((button, index) => {
    syncWorkspaceAttributes(button, replacements[index]);
    if (button.innerHTML !== replacements[index].innerHTML) button.replaceChildren(...replacements[index].childNodes);
  });
}
function syncWorkspaceDialog(next) {
  let current = app.querySelector('.workspace-dialog');
  if (current?.dataset.closing && next) { current.remove(); current = null; }
  if (next && !current) {
    next.classList.add('workspace-dialog'); app.append(next);
    animateWorkspace(next, { opacity: [0, 1] }, { duration: .17 });
    animateWorkspace(next.querySelector('.modal'), { opacity: [0, 1], y: [8, 0], scale: [.985, 1] }, { duration: .29 });
  } else if (next && current) {
    for (const selector of ['.renew-current', '.renew-options', '.notice', '.modal-foot', '.scene-options']) {
      const before = current.querySelector(selector), after = next.querySelector(selector);
      if (!before || !after) continue;
      if (before.matches('[data-motion-group]')) patchWorkspaceChoices(before, after);
      else if (before.innerHTML !== after.innerHTML) before.replaceChildren(...after.childNodes);
    }
  } else if (current && !current.dataset.closing) {
    current.dataset.closing = 'true'; current.inert = true;
    animateWorkspace(current, { opacity: 0 }, { duration: .17 });
    const exit = animateWorkspace(current.querySelector('.modal'), { opacity: 0, y: 8, scale: .985 }, { duration: .24 });
    if (exit) exit.then(() => current.remove()); else current.remove();
  }
}
function renderWorkspaceShell(html) {
  const current = app.querySelector('.workspace-v3');
  if (!current || session.status !== 'authenticated') return false;
  const template = document.createElement('template'); template.innerHTML = html;
  const next = template.content.querySelector('.workspace-v3');
  if (!next || current.dataset.workspaceOwner !== next.dataset.workspaceOwner) return false;
  const notice = app.querySelector(':scope > .storage-notice'), nextNotice = template.content.querySelector('.storage-notice');
  if (notice && !nextNotice) notice.remove();
  else if (nextNotice && !notice) app.prepend(nextNotice);
  else if (notice && nextNotice && notice.innerHTML !== nextNotice.innerHTML) notice.replaceChildren(...nextNotice.childNodes);
  const changedPage = current.dataset.workspacePage !== next.dataset.workspacePage;
  const nav = current.querySelector('.sidebar-nav');
  patchWorkspaceChoices(nav, next.querySelector('.sidebar-nav'));
  for (const selector of ['.breadcrumb', '.app-toolbar', '.environment-banner']) {
    const before = current.querySelector(selector), after = next.querySelector(selector);
    if (before && after && before.outerHTML !== after.outerHTML) { syncWorkspaceAttributes(before, after); before.replaceChildren(...after.childNodes); }
  }
  const before = current.querySelector('.app-main > .content'), after = next.querySelector('.app-main > .content');
  if (!before || !after) return false;
  if (changedPage || !renderWorkspaceRefresh(html, currentHash())) {
    before.replaceWith(after);
    animateWorkspace(after, { opacity: [0, 1], y: [6, 0] });
  }
  current.dataset.workspacePage = next.dataset.workspacePage;
  syncWorkspaceDialog(template.content.querySelector('.modal-backdrop'));
  return true;
}
function clearWorkspaceSelection() {
  clearTimeout(workspaceSkeletonTimer);
  workspacePresentation.pendingLeaseId = ''; workspacePresentation.selectionError = '';
  app.querySelectorAll('.workspace-v3 .is-switching').forEach(node => { node.classList.remove('is-switching', 'is-waiting'); node.setAttribute('aria-busy', 'false'); });
  app.querySelectorAll('.context-state').forEach(node => node.remove());
  app.querySelectorAll('[data-context-inert]').forEach(node => { node.inert = false; node.removeAttribute('data-context-inert'); });
}
function paintWorkspaceSelection(id, error = '') {
  const content = app.querySelector('.workspace-v3 .content');
  if (!content) return;
  workspacePresentation.pendingLeaseId = id; workspacePresentation.selectionError = error;
  content.classList.add('is-switching'); content.setAttribute('aria-busy', String(!error));
  const lease = remoteState().leases.find(item => item.id === id);
  content.querySelectorAll('.overview-number-row, .picker-options [data-lease]').forEach(button => {
    button.classList.toggle('selected', button.dataset.lease === id); button.setAttribute('aria-pressed', String(button.dataset.lease === id));
  });
  const pickerLabel = content.querySelector('.number-picker summary > span:not(.ui-icon), .message-toolbar > strong, .subscription-switcher > strong');
  if (pickerLabel) pickerLabel.textContent = lease?.number || '所选号码';
  app.querySelectorAll('.workspace-v3 .sidebar-nav a').forEach(link => {
    const [path, query = ''] = link.getAttribute('href').split('?');
    if (!['#/app/overview', '#/app/inbox', '#/app/send', '#/app/subscription'].includes(path)) return;
    const params = new URLSearchParams(query); params.set('leaseId', id);
    link.setAttribute('href', `${path}?${params}`);
  });
  const target = content.querySelector('.overview-number-hero, .message-workspace, .send-workspace, .subscription-hero');
  if (!target) return;
  for (const node of content.querySelectorAll('.overview-recent, .subscription-section, .overview-usage')) {
    if (!node.inert) { node.inert = true; node.dataset.contextInert = ''; }
  }
  for (const child of target.children) if (!child.matches('.context-state') && !child.inert) { child.inert = true; child.dataset.contextInert = ''; }
  let overlay = target.querySelector(':scope > .context-state');
  if (!overlay) { overlay = document.createElement('section'); overlay.className = 'context-state'; target.append(overlay); }
  overlay.setAttribute('role', error ? 'alert' : 'status');
  const markup = `<span class="context-number">${esc(lease?.number || '所选号码')}</span><h2>${error ? '号码详情读取失败' : '正在读取号码详情'}</h2><p>${esc(error || '正在同步该号码的租期和消息…')}</p>${error ? '<button class="secondary-btn" data-action="retry-lease">重新读取</button>' : '<div class="context-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>'}`;
  if (overlay.innerHTML !== markup) { overlay.innerHTML = markup; bindEvents(overlay); }
  clearTimeout(workspaceSkeletonTimer);
  if (!error) workspaceSkeletonTimer = setTimeout(() => content.classList.add('is-waiting'), 180);
  else content.classList.remove('is-waiting');
  syncWorkspaceMarkers(content);
}
const workspaceCopyStates = new WeakMap();
function clearWorkspaceCopyFeedback(button) {
  const previous = workspaceCopyStates.get(button);
  if (!previous) return;
  clearTimeout(previous.timer); button.classList.remove('copy-confirmed');
  if (previous.label) button.setAttribute('aria-label', previous.label); else button.removeAttribute('aria-label');
  workspaceCopyStates.delete(button);
}
function workspaceCopyFeedback(button) {
  if (!button.closest('.workspace-v3') || !button.querySelector('.ui-icon')) return;
  const previous = workspaceCopyStates.get(button);
  if (previous) clearTimeout(previous.timer);
  const label = previous ? previous.label : button.getAttribute('aria-label');
  button.classList.add('copy-confirmed'); button.setAttribute('aria-label', '已复制');
  const timer = setTimeout(() => clearWorkspaceCopyFeedback(button), 380);
  workspaceCopyStates.set(button, { label, timer });
}
window.addEventListener('resize', () => syncWorkspaceMarkers(document, false));
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
  for (const [element, animation] of workspaceMotionJobs) { animation.stop(); element.style.removeProperty('transform'); element.style.removeProperty('opacity'); }
  workspaceMotionJobs.clear();
  app.querySelectorAll('.workspace-dialog[data-closing]').forEach(dialog => dialog.remove());
  const reading = app.querySelector('.message-reading');
  if (reading?.dataset.pendingMessageId !== undefined) { delete reading.dataset.pendingMessageId; workspaceReadingTransitions.set(reading, {}); }
  app.querySelectorAll('[data-ring-value] .ring-value').forEach(circle => { circle.style.strokeDasharray = `${circle.closest('[data-ring-value]').dataset.ringValue} 100`; });
  syncWorkspaceMarkers(document, false);
  if (app.querySelector('.workspace-v3') && session.dataStatus === 'ready') render({ background: true });
});
function bindEvents(root = document) {
  root.querySelector('[data-auth-form]')?.addEventListener('submit', handleAuthSubmit);
  root.querySelector('#lease-search')?.addEventListener('input', event => { workspaceUI.search = event.target.value; render({ numbersPickerOnly: true }); });
  root.querySelectorAll('[data-number-scroll]').forEach(button => button.onclick = () => {
    const rail = document.querySelector('.numbers-content .asset-scroll');
    rail?.scrollBy({ left: Number(button.dataset.numberScroll) * rail.clientWidth * 0.8, behavior: reducedNumberMotion() ? 'instant' : 'smooth' });
  });
  const rail = root.querySelector('.numbers-content .asset-scroll') || root.querySelector('.asset-scroll');
  rail?.addEventListener('scroll', updateNumberScrollControls, { passive: true });
  rail?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !event.target.matches('[data-lease]')) return;
    const cards = [...rail.querySelectorAll('[data-lease]')], index = cards.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    cards[next]?.focus({ preventScroll: true });
    cards[next]?.click();
  });
  root.querySelectorAll('[data-lease]').forEach(button => button.onclick = () => {
    if (remoteAction) return;
    const id = button.dataset.lease;
    workspaceUI.mobileDetail = true; workspaceUI.messageId = ''; workspaceUI.inboxFilter = 'all';
    const compose = isSendPage() ? routeParams().get('compose') || workspacePresentation.composerType : '';
    const target = leaseLink(currentHash(), id, ['sms', 'mms'].includes(compose) ? `&compose=${compose}` : '');
    if (currentHash() === 'app/numbers') syncNumberSelection(id, id !== selectedLeaseId);
    if (location.hash !== target) location.hash = target;
    else if (currentHash() !== 'app/numbers') render();
  });
  root.querySelectorAll('[data-status]').forEach(button => button.onclick = () => { workspaceUI.filter = button.dataset.status; render({ numbersPickerOnly: true }); });
  root.querySelectorAll('[data-message-filter]').forEach(button => button.onclick = () => { workspaceUI.inboxFilter = button.dataset.messageFilter; render({ background: true }); });
  root.querySelectorAll('[data-open-message]').forEach(button => button.onclick = async () => {
    const messageId = button.dataset.openMessage;
    workspacePresentation.messagePanel = 'detail';
    workspaceUI.messageId = messageId;
    const params = routeParams();
    params.set('leaseId', selectedLeaseId);
    params.set('messageId', messageId);
    history.replaceState(null, '', `#/app/inbox?${params}`);
    render({ background: true });
    showMessagePanel('detail', window.matchMedia('(max-width: 680px)').matches);
    await readMessages(messageId);
  });
  root.querySelectorAll('button[data-message-panel]').forEach(button => button.onclick = () => showMessagePanel(button.dataset.messagePanel, true));
  root.querySelectorAll('[data-composer-type]').forEach(button => button.onclick = () => {
    workspacePresentation.composerType = button.dataset.composerType;
    const params = routeParams(); params.set('compose', workspacePresentation.composerType);
    history.replaceState(null, '', `#/${currentHash()}?${params}`);
    render({ background: true });
  });
  root.querySelectorAll('[data-subscription-term]').forEach(button => button.onclick = () => {
    const term = terms.find(item => item.days === Number(button.dataset.subscriptionTerm));
    if (!term) return;
    workspacePresentation.renewalLeaseId = selectedLeaseId;
    workspacePresentation.renewalTerm = term.days;
    render({ background: true });
  });
  root.querySelectorAll('[data-addon-type]').forEach(button => button.onclick = () => { workspacePresentation.addonType = button.dataset.addonType; render({ background: true }); });
  root.querySelectorAll('[data-scene]').forEach(button => button.onclick = () => resetDemo(button.dataset.scene));
  root.querySelectorAll('[data-country]').forEach(button => button.onclick = () => { wizard.country = button.dataset.country; wizard.region = null; wizard.term = null; wizard.number = null; wizard.step = 2; renderWizardStep(); });
  root.querySelectorAll('[data-region]').forEach(button => button.onclick = () => { wizard.region = button.dataset.region; render(); });
  root.querySelectorAll('[data-term]').forEach(button => button.onclick = () => { wizard.term = Number(button.dataset.term); render(); });
  root.querySelectorAll('[data-number]').forEach(button => button.onclick = () => { wizard.number = button.dataset.number; render(); });
  root.querySelectorAll('[data-agreed]').forEach(button => button.onchange = () => { wizard.agreed = button.checked; render(); });
  root.querySelectorAll('[data-renew]').forEach(button => button.onclick = () => { window.renewDays = Number(button.dataset.renew); render(); });
  root.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
    const action = button.dataset.action;
    if (action === 'theme') { state.theme = state.theme === 'light' ? 'dark' : 'light'; saveState(); render(); }
    if (action === 'switch-auth' && session.status !== 'submitting') { authEmail = document.querySelector('#auth-email')?.value || authEmail; session.error = ''; authMode = button.dataset.mode; navigate(authMode); }
    if (action === 'retry-session') await checkSession();
    if (action === 'refresh-inventory') await loadInventory();
    if (action === 'logout') await logout();
    if (action === 'refresh-data') { if (workspacePresentation.pendingLeaseId) await onWorkspaceRoute(); else { await loadSnapshot(); render(); } }
    if (action === 'retry-lease') await onWorkspaceRoute();
    if (action === 'clear-search') { workspaceUI.search = ''; workspaceUI.filter = 'all'; render({ numbersPickerOnly: true }); }
    if (action === 'number-list') { workspaceUI.mobileDetail = false; if (currentHash() === 'app/numbers') syncNumberSelection(routeParams().get('leaseId') || selectedLeaseId, document.querySelector('.asset-detail')?.getAttribute('aria-busy') === 'true'); else render(); }
    if (action === 'read-all') await readMessages();
    if (action === 'demo-scenes') { window.showScenes = true; render(); }
    if (action === 'close-scenes') { window.showScenes = false; render(); }
    if (action === 'reset-demo') await resetDemo(OnceMock.scene);
    if (action === 'back') { wizard.step = Math.max(1, wizard.step - 1); renderWizardStep(); }
    if (action === 'next') { wizard.step = Math.min(5, wizard.step + 1); renderWizardStep(); }
    if (action === 'confirm') await createLease();
    if (action === 'renew') {
      const lease = remoteState().lease;
      if (!lease || !remoteState().demo || ['expired', 'unknown'].includes(consoleModel(lease).status)) return;
      window.renewDays = terms.find(term => term.days === Number(button.dataset.renewChoice))?.days || 7;
      window.renewBase = new Date(lease.expiresAt).getTime(); window.showRenew = true; render();
    }
    if (action === 'close-modal') { window.showRenew = false; render(); }
    if (action === 'confirm-renew') await confirmRenewal();
    if (action === 'copy') {
      const value = button.dataset.value || '';
      const copied = () => { workspaceCopyFeedback(button); showToast('已复制选中内容。'); };
      const failed = () => { clearWorkspaceCopyFeedback(button); showToast('浏览器未允许复制，请手动选择。', 'error'); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(copied).catch(failed);
      else {
        const input = document.createElement('textarea'); input.value = value; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select();
        try { if (!document.execCommand('copy')) throw new Error('Copy failed'); copied(); } catch { failed(); }
        input.remove();
      }
    }
    if (action === 'reconcile-order') {
      if (localDemo() || remoteAction || !remoteState().demo) return;
      remoteAction = 'reconcile-order'; render();
      try {
        const id = encodeURIComponent(button.dataset.orderId);
        let result = await apiRequest(`/demo/orders/${id}`);
        if (['PENDING', 'UNCERTAIN'].includes(result.status)) result = await apiRequest(`/demo/orders/${id}/${result.status === 'PENDING' ? 'process' : 'reconcile'}`, { method: 'POST', body: {} });
        await loadSnapshot(result.leaseId || selectedLeaseId, { quiet: true });
        showToast(result.status === 'DEMO_CONFIRMED' ? '沙盒交付已确认，租约已保存。' : result.status === 'FAILED' ? '交付失败，沙盒库存已解除本次预留。' : '结果尚未确认，库存仍保留，请稍后核对。');
      } catch (error) { showToast(errorMessage(error), 'error'); }
      finally { remoteAction = ''; render(); }
    }
    if (action === 'demo-message') {
      const lease = remoteState().lease;
      if (!lease || remoteAction || !remoteState().demo || ['expired', 'unknown'].includes(consoleModel(lease).status)) return;
      remoteAction = 'demo-message'; render();
      try {
        if (localDemo()) await apiRequest(`/leases/${encodeURIComponent(lease.id)}/demo-message`, { method: 'POST', body: {} });
        else {
          const signature = `incoming:${lease.id}`;
          const body = operationPayload(signature, eventId => ({ eventId, leaseId: lease.id, providerMessageId: eventId, sender: 'Sandbox service', title: '沙盒收件', body: '这是一条合成沙盒消息。', receivedAt: new Date().toISOString() }));
          const result = await apiRequest('/demo/events', { method: 'POST', body });
          if (result.status !== 'PROCESSED') throw new Error('收件结果尚未确认，请刷新或核对事件后重试。');
          completeOperation(signature);
        }
        await loadSnapshot(lease.id, { quiet: true });
        showToast(session.dataStatus === 'ready' ? '收到一条演示短信，发送额度未扣减。' : '收件已保存，账户刷新失败，请重新读取。');
      }
      catch (error) { showToast(errorMessage(error), 'error'); }
      finally { remoteAction = ''; render(); }
    }
  });
}
let workspaceRouteVersion = 0;
function syncNumberSelection(id = selectedLeaseId, busy = false) {
  document.querySelectorAll('.asset-row').forEach(row => {
    const selected = row.dataset.lease === id;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  });
  positionNumberSelection(id);
  const detail = document.querySelector('.asset-detail');
  if (detail) {
    detail.setAttribute('aria-busy', String(busy));
    for (const child of detail.children) child.inert = busy || child.matches('.number-detail-outgoing');
  }
}
async function onWorkspaceRoute() {
  stopWorkspaceRefresh();
  workspaceRefreshFailures = 0;
  const version = ++workspaceRouteVersion;
  if (document.querySelector('.asset-detail[aria-busy="true"], .overview-content[aria-busy="true"], .workspace-v3 .is-switching')) snapshotVersion++;
  const route = currentHash();
  const inlineWorkspace = ['app', 'app/overview', 'app/inbox', 'app/send', 'app/subscription'].includes(route) && session.status === 'authenticated' && session.dataStatus === 'ready' && Boolean(document.querySelector('.workspace-v3'));
  const inlineSwitch = route === 'app/numbers' && session.status === 'authenticated' && session.dataStatus === 'ready' && Boolean(document.querySelector('.number-workspace')) && !document.querySelector('.modal');
  window.showRenew = false; window.showScenes = false;
  clearWorkspaceSelection();
  const id = routeParams().get('leaseId');
  workspaceUI.messageId = isSendPage() ? '' : routeParams().get('messageId') || '';
  if (route === 'app/inbox' && !isSendPage()) workspacePresentation.messagePanel = workspaceUI.messageId ? 'detail' : 'list';
  if (isSendPage() && ['sms', 'mms'].includes(routeParams().get('compose'))) workspacePresentation.composerType = routeParams().get('compose');
  if (id) workspaceUI.mobileDetail = true;
  if (inlineWorkspace && id) {
    if (id === selectedLeaseId) {
      snapshotVersion++;
      render();
      if (route === 'app/inbox' && workspaceUI.messageId) await readMessages(workspaceUI.messageId);
      return;
    }
    // Switch presentation only; the existing cache and request version own the data.
    render();
    paintWorkspaceSelection(id);
    const data = await loadSnapshot(id, { quiet: true, preserveOnError: true, preferCache: true });
    if (version !== workspaceRouteVersion) return;
    if (data) {
      clearWorkspaceSelection();
      render();
      const panel = document.querySelector('.overview-number-info, .message-workspace, .send-workspace, .subscription-hero');
      animateWorkspace(panel, { opacity: [0, 1], y: [4, 0] }, { duration: .19 });
      if (route === 'app/inbox' && workspaceUI.messageId) await readMessages(workspaceUI.messageId);
    } else if (session.status === 'authenticated' && session.snapshot) {
      paintWorkspaceSelection(id, session.dataError || '号码详情暂时无法读取，请重试。');
    } else { clearWorkspaceSelection(); render(); }
    return;
  }
  if (inlineSwitch && id) {
    // Also invalidate an older request when returning to the already displayed number.
    if (id === selectedLeaseId) { snapshotVersion++; syncNumberSelection(); syncWorkspaceRefresh(); return; }
    syncNumberSelection(id, true);
    const data = await loadSnapshot(id, { quiet: true, preserveOnError: true, preferCache: true });
    if (version !== workspaceRouteVersion) return;
    if (data) render({ numbersOnly: true });
    else if (session.status === 'authenticated' && session.snapshot) {
      history.replaceState(null, '', leaseLink(route, selectedLeaseId));
      syncNumberSelection();
      syncWorkspaceRefresh();
      showToast(session.dataError || '号码切换未完成，请重试。', 'error');
    } else render();
    return;
  }
  if (session.status === 'authenticated' && id && id !== selectedLeaseId) await loadSnapshot(id);
  if (version !== workspaceRouteVersion) return;
  if (session.dataStatus === 'ready' && route === 'app/inbox' && workspaceUI.messageId) await readMessages(workspaceUI.messageId);
  if (version !== workspaceRouteVersion) return;
  render(); window.scrollTo(0, 0);
}
let workspaceRefreshTimer;
let workspaceRefreshController;
let workspaceRefreshVersion = 0;
let workspaceRefreshFailures = 0;
let workspaceRefreshTime = '';
function workspaceTimeSignature() {
  return JSON.stringify(remoteState().leases.map(lease => {
    const model = consoleModel(lease);
    return [lease.id, model.status, model.remaining];
  }));
}
function canRefreshWorkspace() {
  return session.status === 'authenticated' && session.dataStatus === 'ready' && Boolean(selectedLeaseId)
    && ['app', 'app/overview', 'app/numbers', 'app/inbox', 'app/send', 'app/subscription'].includes(currentHash())
    && (!routeParams().get('leaseId') || routeParams().get('leaseId') === selectedLeaseId)
    && !remoteAction && !window.showRenew && !window.showScenes && !document.hidden && navigator.onLine !== false;
}
function stopWorkspaceRefresh() {
  clearTimeout(workspaceRefreshTimer);
  workspaceRefreshController?.abort();
  workspaceRefreshController = null;
  workspaceRefreshVersion++;
}
function syncWorkspaceRefresh(delay = 5000) {
  stopWorkspaceRefresh();
  if (canRefreshWorkspace()) workspaceRefreshTimer = setTimeout(refreshWorkspace, delay);
}
async function refreshWorkspace() {
  if (!canRefreshWorkspace()) return;
  const version = workspaceRefreshVersion, snapshot = snapshotVersion;
  const owner = selectionKey(), id = selectedLeaseId, route = location.hash;
  const controller = new AbortController();
  workspaceRefreshController = controller;
  try {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const data = validateNumberSnapshot(await apiRequest(`/state?leaseId=${encodeURIComponent(id)}`, { signal }), id);
    if (version !== workspaceRefreshVersion || snapshot !== snapshotVersion || owner !== selectionKey()
      || id !== selectedLeaseId || route !== location.hash || !canRefreshWorkspace()) return;
    const previous = remoteState();
    const changed = JSON.stringify(data) !== JSON.stringify(previous) || workspaceRefreshTime !== workspaceTimeSignature();
    if (JSON.stringify(data.leases) !== JSON.stringify(previous.leases) || JSON.stringify(data.bills) !== JSON.stringify(previous.bills)) {
      numberSnapshots.clear(); numberRequests.clear(); numberCacheGeneration++;
    }
    numberSnapshots.set(`${owner}:${id}`, { data, time: Date.now() });
    session.snapshot = data;
    session.dataError = '';
    workspaceRefreshFailures = 0;
    if (changed) render({ background: true });
  } catch (error) {
    if (version !== workspaceRefreshVersion || controller.signal.aborted) return;
    workspaceRefreshFailures++;
    // Keep the current view and retry with backoff; manual refresh retains its error UI.
    if (session.status !== 'authenticated') render();
  } finally {
    if (version === workspaceRefreshVersion) syncWorkspaceRefresh(Math.min(60000, 5000 * 2 ** Math.min(workspaceRefreshFailures, 4)));
  }
}
function sameWorkspaceMarkup(current, next) {
  if (!current.querySelector('[data-motion-indicator]')) return current.innerHTML === next.innerHTML;
  const copy = current.cloneNode(true);
  copy.querySelectorAll('[data-motion-indicator]').forEach(marker => marker.remove());
  return copy.innerHTML === next.innerHTML;
}
function patchWorkspaceMessages(current, next, animateNew = true) {
  const old = new Map([...current.querySelectorAll('[data-open-message]')].map(row => [row.dataset.openMessage, row]));
  const seen = workspaceSeenMessages.get(`${selectionKey()}:${selectedLeaseId}`);
  const fragment = document.createDocumentFragment();
  const marker = current.querySelector(':scope > [data-motion-indicator]');
  if (marker) fragment.append(marker);
  for (const row of [...next.children]) {
    const key = row.dataset.openMessage, existing = old.get(key);
    if (existing) {
      syncWorkspaceAttributes(existing, row);
      if (existing.innerHTML !== row.innerHTML) existing.replaceChildren(...row.childNodes);
      fragment.append(existing);
    } else {
      fragment.append(row);
      if (animateNew && key && seen && !seen.has(key)) row.dataset.newMessage = '';
    }
  }
  current.replaceChildren(fragment);
  current.querySelectorAll('[data-new-message]').forEach(row => {
    animateWorkspace(row, { opacity: [0, 1], y: [6, 0] }); row.removeAttribute('data-new-message');
  });
}
function patchWorkspaceComposer(current, next) {
  patchWorkspaceChoices(current.querySelector('.composer-types'), next.querySelector('.composer-types'));
  if (current.dataset.editorMode === next.dataset.editorMode) return;
  current.dataset.editorMode = next.dataset.editorMode;
  for (const selector of ['.composer-status', '.composer-footer']) {
    const before = current.querySelector(selector), after = next.querySelector(selector);
    before.replaceChildren(...after.childNodes);
  }
  current.querySelectorAll('label').forEach((label, index) => { label.textContent = next.querySelectorAll('label')[index].textContent; });
  current.querySelectorAll('input, textarea').forEach((input, index) => syncWorkspaceAttributes(input, next.querySelectorAll('input, textarea')[index]));
  const attachment = current.querySelector('.mms-attachment-placeholder'), replacement = next.querySelector('.mms-attachment-placeholder');
  if (attachment && !replacement) attachment.remove();
  if (!attachment && replacement) current.querySelector('.composer-footer').before(replacement);
}
const workspaceReadingTransitions = new WeakMap();
function patchWorkspaceReading(current, next, header, nextHeader, immediate = false) {
  const id = next.dataset.messageId;
  if (!immediate && current.dataset.pendingMessageId === id) return;
  workspaceMotionJobs.get(current)?.stop();
  const token = {};
  workspaceReadingTransitions.set(current, token);
  if (!immediate && current.dataset.messageId === id) {
    delete current.dataset.pendingMessageId; current.style.opacity = '1'; current.style.removeProperty('transform'); current.setAttribute('aria-busy', 'false'); return;
  }
  current.dataset.pendingMessageId = id; current.setAttribute('aria-busy', 'true');
  const owner = selectionKey(), lease = selectedLeaseId;
  const commit = () => {
    if (!current.isConnected || workspaceReadingTransitions.get(current) !== token || selectionKey() !== owner || selectedLeaseId !== lease) return;
    current.replaceChildren(...next.childNodes); current.dataset.messageId = id; delete current.dataset.pendingMessageId;
    current.setAttribute('aria-busy', 'false'); current.scrollTop = 0;
    current.style.opacity = '1'; current.style.removeProperty('transform');
    if (header && nextHeader) {
      const restoreFocus = header.contains(document.activeElement);
      header.replaceChildren(...nextHeader.childNodes); bindEvents(header);
      if (restoreFocus) header.querySelector('h2')?.focus({ preventScroll: true });
    }
    bindEvents(current);
    animateWorkspace(current, { opacity: [0, 1], y: [3, 0] }, { duration: .14 });
  };
  if (!immediate && current.dataset.messageId && !reducedNumberMotion() && window.Motion) {
    const exit = animateWorkspace(current, { opacity: 0 }, { duration: .12 });
    exit.then(commit);
  } else commit();
}
function renderWorkspaceRefresh(html, route) {
  const page = isSendPage() ? 'app/send' : route;
  const selectors = {
    'app': ['.overview-content', '.sidebar-nav'],
    'app/overview': ['.overview-content', '.sidebar-nav'],
    'app/numbers': ['.asset-list', '.number-detail-content'],
    'app/inbox': ['.message-toolbar', '.inbox-list-head .section-row', '.message-filters', '.inbox-list-head > p', '.message-scroll', '.message-demo-action', '.conversation-header', '.message-reading', '.message-composer', '.message-inspector', '.sidebar-nav'],
    'app/send': ['.message-toolbar', '.message-composer', '.send-history', '.sidebar-nav'],
    'app/subscription': ['.subscription-switcher', '.subscription-hero', '.renewal-section', '.addon-section', '.subscription-history', '.sidebar-nav']
  }[page];
  if (!selectors) return false;
  const template = document.createElement('template');
  template.innerHTML = html;
  const viewSelector = { app: '.overview-content', 'app/overview': '.overview-content', 'app/numbers': '.number-workspace', 'app/inbox': '.message-workspace', 'app/send': '.send-workspace', 'app/subscription': '.subscription-content' }[page];
  if (!app.querySelector(viewSelector) || !template.content.querySelector(viewSelector)) return false;
  const focus = document.activeElement;
  const focusAttribute = ['id', 'data-open-message', 'data-lease', 'data-action', 'data-message-filter', 'data-composer-type', 'data-subscription-term', 'data-addon-type'].find(name => focus?.hasAttribute(name));
  const focusSelector = focusAttribute ? `[${focusAttribute}="${CSS.escape(focus.getAttribute(focusAttribute))}"]` : '';
  const scroll = ['.asset-scroll', '.message-scroll', '.inbox-detail', '.message-reading'].map(selector => {
    const element = app.querySelector(selector);
    return { selector, left: element?.scrollLeft || 0, top: element?.scrollTop || 0 };
  });
  const extraOpen = app.querySelector('.lease-extra')?.open;
  const reading = app.querySelector('.message-reading'), nextReading = template.content.querySelector('.message-reading');
  const context = app.querySelector('.message-workspace, .send-workspace'), nextContext = template.content.querySelector('.message-workspace, .send-workspace');
  const changedLease = context && nextContext && context.dataset.leaseContext !== nextContext.dataset.leaseContext;
  const changedMessage = reading && nextReading && (changedLease || reading.dataset.messageId !== nextReading.dataset.messageId || reading.dataset.pendingMessageId !== undefined);
  let patched = false;
  for (const selector of selectors) {
    const current = app.querySelector(selector), next = template.content.querySelector(selector);
    if (!current || !next) continue;
    patched = true;
    if (selector === '.conversation-header' && changedMessage) continue;
    if (selector === '.message-reading' && changedMessage) {
      if (current.dataset.messageId !== next.dataset.messageId) {
        const readingScroll = scroll.find(item => item.selector === selector);
        if (readingScroll) readingScroll.top = 0;
      }
      patchWorkspaceReading(current, next, app.querySelector('.conversation-header'), template.content.querySelector('.conversation-header'), changedLease);
      continue;
    }
    if (current.matches('[data-motion-group]')) { patchWorkspaceChoices(current, next); continue; }
    if (['.renewal-section', '.addon-section'].includes(selector)) {
      for (const nextGroup of [...next.querySelectorAll('[data-motion-group]')]) {
        const group = current.querySelector(`.${CSS.escape(nextGroup.classList[0])}`);
        if (group) { patchWorkspaceChoices(group, nextGroup); nextGroup.replaceWith(group); }
      }
      current.replaceChildren(...next.childNodes); bindEvents(current); continue;
    }
    if (selector === '.message-composer') { patchWorkspaceComposer(current, next); bindEvents(current); continue; }
    if (sameWorkspaceMarkup(current, next)) continue;
    syncWorkspaceAttributes(current, next);
    if (selector === '.message-scroll') patchWorkspaceMessages(current, next, !changedLease);
    else current.replaceChildren(...next.childNodes);
    bindEvents(current);
  }
  if (!patched) return false;
  if (context && nextContext) { context.dataset.leaseContext = nextContext.dataset.leaseContext; context.dataset.messagePanel = nextContext.dataset.messagePanel; }
  const extra = app.querySelector('.lease-extra');
  if (extra && extraOpen !== undefined) extra.open = extraOpen;
  for (const item of scroll) {
    const element = app.querySelector(item.selector);
    if (element) { element.scrollLeft = item.left; element.scrollTop = item.top; }
  }
  if (route === 'app/numbers') syncNumberSelection();
  if (focusSelector && document.activeElement !== focus) app.querySelector(focusSelector)?.focus({ preventScroll: true });
  syncWorkspaceMotion();
  return true;
}
document.addEventListener('visibilitychange', () => document.hidden ? stopWorkspaceRefresh() : syncWorkspaceRefresh(0));
window.addEventListener('offline', stopWorkspaceRefresh);
window.addEventListener('online', () => syncWorkspaceRefresh(0));
window.addEventListener('pagehide', stopWorkspaceRefresh);
window.addEventListener('pageshow', () => syncWorkspaceRefresh());

function handleDialogKeys(event) {
  if (!window.showRenew && !window.showScenes) return;
  if (event.key === 'Escape') { window.showRenew = false; window.showScenes = false; render(); }
  if (event.key === 'Tab') {
    const controls = [...document.querySelectorAll('.modal button:not(:disabled), .modal a[href]')];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
