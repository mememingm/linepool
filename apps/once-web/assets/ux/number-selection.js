/* My Numbers: account-scoped snapshots and Motion DOM transitions. */
const numberSnapshots = new Map();
const numberRequests = new Map();
let numberCacheGeneration = 0;
const numberCacheTTL = 60000;

function validateNumberSnapshot(data, leaseId = '') {
  if (!data || !Array.isArray(data.leases) || !Array.isArray(data.messages) || !Array.isArray(data.bills) || !Object.hasOwn(data, 'lease') || (leaseId && data.lease?.id !== leaseId)) throw new Error('账户数据格式不完整，请重试。');
  return data;
}

async function loadNumberSnapshot(leaseId, preferCache = false) {
  if (!preferCache) {
    numberSnapshots.clear();
    numberRequests.clear();
    numberCacheGeneration++;
  }
  const owner = selectionKey(), key = `${owner}:${leaseId}`, generation = numberCacheGeneration;
  const cached = numberSnapshots.get(key);
  if (preferCache && cached && Date.now() - cached.time < numberCacheTTL) return cached.data;
  if (preferCache && numberRequests.has(key)) return numberRequests.get(key);
  const request = apiRequest(`/state${leaseId ? `?leaseId=${encodeURIComponent(leaseId)}` : ''}`).then(data => {
    validateNumberSnapshot(data, leaseId);
    if (generation === numberCacheGeneration && owner === selectionKey() && session.status === 'authenticated' && data.lease) {
      const resolvedKey = `${owner}:${data.lease.id}`;
      numberSnapshots.delete(resolvedKey);
      numberSnapshots.set(resolvedKey, { data, time: Date.now() });
      if (numberSnapshots.size > 32) numberSnapshots.delete(numberSnapshots.keys().next().value);
    }
    return data;
  }).finally(() => { if (numberRequests.get(key) === request) numberRequests.delete(key); });
  numberRequests.set(key, request);
  return request;
}

const reducedNumberMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let numberDetailAnimations = [];
function replaceNumberDetail(detail, nextDetail) {
  numberDetailAnimations.forEach(animation => animation.stop());
  numberDetailAnimations = [];
  detail.querySelector('.number-detail-outgoing')?.remove();
  const previous = detail.querySelector('.number-detail-content');
  const incoming = nextDetail.querySelector('.number-detail-content');
  const height = detail.getBoundingClientRect().height;
  detail.style.minHeight = `${height}px`;
  detail.replaceChildren(incoming);
  detail.dataset.leaseDetail = nextDetail.dataset.leaseDetail;
  if (!previous || !window.Motion || reducedNumberMotion()) return;
  previous.classList.add('number-detail-outgoing');
  previous.inert = true;
  previous.setAttribute('aria-hidden', 'true');
  detail.append(previous);
  const outgoing = Motion.animate(previous, { opacity: [1, 0] }, { duration: 0.12, ease: 'easeOut' });
  outgoing.then(() => previous.remove());
  numberDetailAnimations = [outgoing, Motion.animate(incoming, { opacity: [0.65, 1], y: [3, 0] }, { duration: 0.18, ease: [0.22, 1, 0.36, 1] })];
}

function updateNumberScrollControls() {
  const rail = document.querySelector('.numbers-content .asset-scroll');
  if (!rail) return;
  const overflow = rail.scrollWidth - rail.clientWidth > 2;
  document.querySelector('.number-scroll-controls')?.classList.toggle('is-hidden', !overflow);
  document.querySelectorAll('[data-number-scroll]').forEach(button => {
    button.disabled = !overflow || (Number(button.dataset.numberScroll) < 0 ? rail.scrollLeft <= 2 : rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2);
  });
}
function positionNumberSelection(id, animate = true) {
  const rail = document.querySelector('.numbers-content .asset-scroll');
  const selected = [...(rail?.querySelectorAll('.asset-row') || [])].find(row => row.dataset.lease === id);
  if (!rail) return;
  let marker = rail.querySelector('.number-selection-indicator');
  if (!selected) { marker?.remove(); updateNumberScrollControls(); return; }
  const fresh = !marker;
  if (fresh) {
    marker = document.createElement('span');
    marker.className = 'number-selection-indicator';
    marker.setAttribute('aria-hidden', 'true');
    rail.append(marker);
  }
  const x = selected.offsetLeft, y = selected.offsetTop + selected.offsetHeight - 3;
  const changed = marker.dataset.lease !== id;
  marker.dataset.lease = id;
  if (window.Motion && animate && !fresh && changed && !reducedNumberMotion()) {
    Motion.animate(marker, { x, y, width: selected.offsetWidth }, { duration: 0.22, ease: [0.22, 1, 0.36, 1] });
  } else {
    marker.style.transform = `translate(${x}px, ${y}px)`;
    marker.style.width = `${selected.offsetWidth}px`;
  }
  const start = selected.offsetLeft - 4, end = selected.offsetLeft + selected.offsetWidth + 4;
  if (start < rail.scrollLeft || end > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: start < rail.scrollLeft ? Math.max(0, start) : end - rail.clientWidth, behavior: animate && !reducedNumberMotion() ? 'smooth' : 'instant' });
  updateNumberScrollControls();
}
window.addEventListener('resize', () => positionNumberSelection(routeParams().get('leaseId') || selectedLeaseId, false));
