#!/usr/bin/env node
// LP integration page: query PC projects/numbers and inspect inbound Webhooks.
import { DEFAULT_PC_API, configurePc, publicPc, queryPc } from './pc-client.mjs';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = '/api/webhooks/pingcode';
const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf('--' + name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`--${name} 缺少参数`);
  return args[index + 1];
}
const port = Number(flag('port', '8890'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');
const origin = `http://127.0.0.1:${port}`;
const dataDir = resolve(flag('data-dir', join(HERE, '.local', 'pc-live')));
const eventsFile = join(dataDir, 'events.json');
const attemptsFile = join(dataDir, 'attempts.json');
let secret = flag('secret', process.env.PINGCODE_WEBHOOK_SECRET) || '';
let publicUrl = flag('public-url', process.env.PINGCODE_WEBHOOK_URL) || '';
const load = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
let events = load(eventsFile);
let attempts = load(attemptsFile).slice(0, 300);
const seen = new Set(events.map(row => row.eventId));
const pcSettingsFile = join(dataDir, 'pc-settings.json');
const savedPc = existsSync(pcSettingsFile) ? JSON.parse(readFileSync(pcSettingsFile, 'utf8')) : {};
let pc = configurePc({ apiRoot: process.env.PINGCODE_API_ROOT || savedPc.apiRoot || DEFAULT_PC_API, apiKey: process.env.PINGCODE_API_KEY || '', projectPath: process.env.PINGCODE_PROJECT_PATH || savedPc.projectPath || '', numbersPath: savedPc.numbersPath || '/numbers?limit=50' }, {});
let queryResults = { projects: null, numbers: null };
const busy = { projects: false, numbers: false };
const streams = new Set();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const badInput = message => Object.assign(new Error(message), { status: 400 });
function save(path, value) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2));
  renameSync(path + '.tmp', path);
}
function state() { return { endpoint: publicUrl || origin + PATH, publicUrl, secretConfigured: Boolean(secret), attempts, pc: publicPc(pc), queryResults, busy }; }
function publish() {
  const message = 'data: ' + JSON.stringify(state()) + '\n\n';
  for (const stream of streams) stream.write(message);
}
function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function bodyOf(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 256 * 1024) throw Object.assign(new Error('请求内容超过 256 KB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  const raw = await bodyOf(req);
  try { return JSON.parse(raw.toString('utf8')); } catch { throw badInput('请求格式不正确'); }
}
function webhook(raw, req, res) {
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { /* Keep raw request for inspection. */ }
  const eventId = req.headers['x-pingcode-event-id'] ?? '';
  const timestamp = req.headers['x-pingcode-timestamp'] ?? '';
  const signature = req.headers['x-pingcode-signature'] ?? '';
  const record = { id: randomUUID(), source: 'external', receivedAt: new Date().toISOString(), eventId,
    payload: payload ?? null, rawBody: raw.toString('utf8'),
    headers: Object.fromEntries(Object.entries(req.headers).filter(([name]) => name.startsWith('x-pingcode-') || name === 'content-type' || name === 'user-agent')) };
  function finish(status, reason, outcome) {
    const response = status === 200 ? { received: true, duplicate: outcome === 'duplicate' } : { received: false, reason };
    const next = [{ ...record, status, reason, outcome, response }, ...attempts].slice(0, 300);
    save(attemptsFile, next); attempts = next;
    reply(res, status, response); publish();
  }
  const reject = (status, reason) => finish(status, reason, 'rejected');
  if (!secret) return reject(503, 'webhook-secret-not-configured');
  if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return reject(401, 'timestamp-invalid-or-expired');
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) return reject(401, 'signature-invalid');
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return reject(401, 'signature-invalid');
  if (!object(payload)) return reject(400, 'body-not-json-object');
  if (typeof eventId !== 'string' || !eventId || payload.eventId !== eventId) return reject(400, 'event-id-mismatch');
  if (seen.has(eventId)) return finish(200, null, 'duplicate');
  const next = [{ ...record, eventId }, ...events];
  save(eventsFile, next); events = next; seen.add(eventId);
  finish(200, null, 'accepted');
}
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const path = new URL(req.url, origin).pathname;
    if (req.method === 'POST' && path === PATH) return webhook(await bodyOf(req), req, res);
    // Expose the callback path to PC; keep this local control page on localhost.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return reply(res, 403, { error: '请在本机打开测试页面' });
    if (req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(res, 403, { error: '不允许跨域操作' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: '请求格式不正确' });
    }
    if (req.method === 'GET' && assets.has(path)) {
      const [file, mime] = assets.get(path);
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      return res.end(readFileSync(join(HERE, file)));
    }
    if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && path === '/api/state') return reply(res, 200, state());
    if (req.method === 'GET' && path === '/api/updates') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('data: ' + JSON.stringify(state()) + '\n\n'); streams.add(res);
      req.on('close', () => streams.delete(res)); return;
    }
    if (req.method === 'POST' && path === '/api/pc/settings') {
      const next = configurePc(await jsonBody(req), pc);
      save(pcSettingsFile, { apiRoot: next.apiRoot, projectPath: next.projectPath, numbersPath: next.numbersPath });
      pc = next; queryResults = { projects: null, numbers: null };
      reply(res, 200, { saved: true }); publish(); return;
    }
    if (req.method === 'POST' && path === '/api/pc/query') {
      const input = await jsonBody(req);
      if (!object(input) || !['projects', 'numbers'].includes(input.kind)) throw badInput('只支持项目和号码查询');
      const kind = input.kind;
      if (busy[kind]) return reply(res, 409, { error: '正在查询，请稍候' });
      busy[kind] = true; publish();
      try {
        const settings = pc;
        const result = await queryPc(settings, kind);
        if (pc !== settings) return reply(res, 409, { error: 'PC 设置已变化，请重新查询' });
        const next = { ...queryResults, [kind]: result };
        save(join(dataDir, 'last-queries.json'), next); queryResults = next;
        reply(res, 200, result);
      } finally { busy[kind] = false; publish(); }
      return;
    }
    if (req.method === 'POST' && path === '/api/settings') {
      const input = await jsonBody(req);
      if (!object(input)) throw badInput('请求格式不正确');
      if (input.secret !== undefined && (typeof input.secret !== 'string' || input.secret.length > 512)) throw badInput('密钥格式不正确');
      let nextUrl = publicUrl;
      if (input.url !== undefined) {
        if (typeof input.url !== 'string') throw badInput('接收地址无效');
        if (!input.url || input.url === origin + PATH) nextUrl = '';
        else {
          let url; try { url = new URL(input.url); } catch { throw badInput('请输入完整的接收地址'); }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== PATH) throw badInput('接收地址应为 http(s)://你的域名/api/webhooks/pingcode');
          nextUrl = url.href;
        }
      }
      publicUrl = nextUrl;
      if (input.secret?.trim()) secret = input.secret.trim();
      reply(res, 200, { saved: true }); publish(); return;
    }
    reply(res, 404, { error: '接口不存在' });
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent && !res.destroyed) reply(res, error.status ?? 500, { error: error.status ? error.message : '接收端操作失败，请查看终端' });
  }
});
const heartbeat = setInterval(() => { for (const stream of streams) stream.write(': keepalive\n\n'); }, 25000);
heartbeat.unref();
server.requestTimeout = 15000;
server.on('error', error => { clearInterval(heartbeat); console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`Webhook 测试页面：${origin}/`); console.log(`接收路径：${PATH}`); });
