// Read-only PC calls for the LP integration page. No account login or SMS sending.
export const DEFAULT_PC_API = 'http://120.55.75.51/pingcode/api/open/v1';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inputError = message => Object.assign(new Error(message), { status: 400 });
export function endpointFor(settings, kind) {
  const path = kind === 'projects' ? settings.projectPath : settings.numbersPath;
  if (!path) throw inputError('项目查询接口尚未确认，请在「接口地址」中填写 PC 最新说明里的真实路径。');
  const root = new URL(settings.apiRoot);
  let url;
  try {
    if (/^https?:\/\//i.test(path)) url = new URL(path);
    else if (path.startsWith(root.pathname + '/')) url = new URL(path, root.origin);
    else if (path.startsWith('/api/')) {
      const index = root.pathname.indexOf('/api/');
      url = new URL((index < 0 ? '' : root.pathname.slice(0, index)) + path, root.origin);
    } else url = new URL(root.href.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  } catch { throw inputError('查询接口地址无效'); }
  if (url.origin !== root.origin || url.username || url.password || url.hash) throw inputError('查询接口必须属于配置的 PC 站点');
  return url;
}
export function configurePc(input, current) {
  if (!isObject(input)) throw inputError('设置格式不正确');
  const next = { ...current };
  for (const field of ['apiRoot', 'apiKey', 'projectPath', 'numbersPath']) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'string' || input[field].length > 2048 || /[\r\n\0]/.test(input[field])) throw inputError('PC 设置格式不正确');
    const value = input[field].trim();
    if (field === 'apiKey') { if (value) next.apiKey = value.replace(/^Bearer\s+/i, ''); }
    else next[field] = value;
  }
  let root; try { root = new URL(next.apiRoot); } catch { throw inputError('PC API 地址无效'); }
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) throw inputError('PC API 地址需要完整的 http(s) 地址');
  next.apiRoot = root.href.replace(/\/$/, '');
  if (next.projectPath) endpointFor(next, 'projects');
  if (!next.numbersPath) throw inputError('请填写号码查询接口路径');
  endpointFor(next, 'numbers');
  return next;
}
export function publicPc(settings) {
  const root = new URL(settings.apiRoot);
  const prefix = root.pathname.includes('/api/') ? root.pathname.slice(0, root.pathname.indexOf('/api/')) : '';
  return { apiRoot: settings.apiRoot, keyConfigured: Boolean(settings.apiKey), projectPath: settings.projectPath, numbersPath: settings.numbersPath, docsUrl: root.origin + prefix + '/personal-api/docs' };
}
export async function queryPc(settings, kind) {
  if (!['projects', 'numbers'].includes(kind)) throw inputError('只支持项目和号码查询');
  if (!settings.apiKey) throw inputError('请先填写 PC API Key 并保存');
  const url = endpointFor(settings, kind);
  const started = Date.now();
  const redact = text => String(text).split(settings.apiKey).join('[REDACTED]');
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer ' + settings.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('PC 响应超过 2 MB'); }
        chunks.push(Buffer.from(value));
      }
    }
    const rawBody = redact(Buffer.concat(chunks).toString('utf8'));
    let body = null; let json = true;
    try { body = JSON.parse(rawBody); } catch { json = false; }
    return { kind, method: 'GET', url: url.href, queriedAt: new Date(started).toISOString(), durationMs: Date.now() - started, status: response.status,
      ok: response.ok && json, body, rawBody,
      error: !response.ok ? `PC 返回 HTTP ${response.status}` : !json ? 'PC 返回的内容不是 JSON，请检查接口地址' : null };
  } catch (error) {
    return { kind, method: 'GET', url: url.href, queriedAt: new Date(started).toISOString(), durationMs: Date.now() - started, status: null, ok: false, body: null, rawBody: '',
      error: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'PC 查询超时，请稍后重试' : redact(error.message || '无法连接 PC') };
  }
}
