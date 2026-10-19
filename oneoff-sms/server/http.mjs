import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { ApiError } from './service.mjs';
import { verifyWebhook } from './providers.mjs';

const ORIGINS = new Set(['http://127.0.0.1:5188', 'http://127.0.0.1:3028']);
const HOSTS = new Set(['127.0.0.1:5188', '127.0.0.1:3028']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Mutations require application/json.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds 8192 bytes.');
    chunks.push(chunk);
  }
  try {
    req.rawBody = Buffer.concat(chunks);
    const body = JSON.parse(req.rawBody.toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Supply a JSON object.');
  }
}

function sessionToken(req, name = 'once_session') {
  const prefix = `${name}=`;
  return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

export function createHttpServer(service, { distPath = null, allowedHosts = HOSTS, allowedOrigins = ORIGINS, webhookSecret = '' } = {}) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (!allowedHosts.has(req.headers.host)) throw new ApiError(403, 'HOST_REJECTED', 'Only the local loopback host is allowed.');
      // Bootstrap creates a session, so protect it against cross-site requests as well.
      if ((req.headers.origin && !allowedOrigins.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-origin access is not allowed.');
      }
      const url = new URL(req.url, 'http://127.0.0.1:3028');
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        const result = service.bootstrap(sessionToken(req));
        if (result.isNew) res.setHeader('Set-Cookie', `once_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
        return send(res, 200, result.data);
      }
      if (url.pathname.startsWith('/api/')) {
        const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
        const body = isMutation ? await jsonBody(req) : null;
        if (url.pathname === '/api/providers/mock/webhook' && req.method === 'POST') {
          if (!verifyWebhook(webhookSecret, req.headers['x-once-timestamp'], req.rawBody, req.headers['x-once-signature'])) {
            throw new ApiError(403, 'INVALID_SIGNATURE', 'A valid, recent mock webhook signature is required.');
          }
          return send(res, 200, service.receiveSms(body));
        }
        if (url.pathname === '/api/providers/pingcode/webhook') throw new ApiError(503, 'PINGCODE_NOT_CONFIGURED', 'Live PingCode callback verification and order correlation are not configured.');
        if (url.pathname === '/api/admin/login' && req.method === 'POST') {
          const result = service.loginAdmin(body);
          res.setHeader('Set-Cookie', `once_admin=${result.token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=3600`);
          return send(res, 200, { authenticated: true, mode: 'demo' });
        }
        if (url.pathname.startsWith('/api/admin/')) {
          const token = sessionToken(req, 'once_admin');
          const actor = service.requireAdmin(token);
          if (url.pathname === '/api/admin/snapshot' && req.method === 'GET') return send(res, 200, service.adminSnapshot());
          if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
            service.logoutAdmin(token);
            res.setHeader('Set-Cookie', 'once_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0');
            return send(res, 200, { authenticated: false });
          }
          if (url.pathname === '/api/admin/lease-sms' && req.method === 'POST') return send(res, 200, service.adminLeaseSms(actor, body));
          const leaseConfig = /^\/api\/admin\/(lease-plans|lease-resources)\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
          if (leaseConfig && req.method === 'PATCH') return send(res, 200, service[leaseConfig[1] === 'lease-plans' ? 'updateLeasePlan' : 'updateLeaseResource'](actor, leaseConfig[2], body));
          if (url.pathname === '/api/admin/mock-sms' && req.method === 'POST') return send(res, 200, service.adminMockSms(actor, body));
          if (url.pathname === '/api/admin/services' && req.method === 'POST') return send(res, 201, service.createPlatform(actor, body));
          const capability = /^\/api\/admin\/resources\/([a-zA-Z0-9_-]+)\/services\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
          if (capability && req.method === 'PATCH') return send(res, 200, service.updateNumberService(actor, capability[1], capability[2], body));
          const failure = /^\/api\/admin\/tasks\/([a-zA-Z0-9_-]+)\/fail$/.exec(url.pathname);
          if (failure && req.method === 'POST') return send(res, 200, service.failTask(actor, failure[1], body));
          const config = /^\/api\/admin\/(products|services|resources)\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
          if (config && req.method === 'PATCH') {
            const method = { products: 'updateProduct', services: 'updateService', resources: 'updateResource' }[config[1]];
            return send(res, 200, service[method](actor, config[2], body));
          }
          const settlement = /^\/api\/admin\/tasks\/([a-zA-Z0-9_-]+)\/settle$/.exec(url.pathname);
          if (settlement && req.method === 'POST') return send(res, 200, service.resolveSettlement(actor, settlement[1], body));
          throw new ApiError(404, 'NOT_FOUND', 'Administrator route not found.');
        }
        const viewerId = service.viewerForSession(sessionToken(req));
        if (url.pathname === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 2000\nevent: ready\ndata: {}\n\n');
          const unsubscribe = service.subscribe(viewerId, () => { if (!res.destroyed) res.write('event: change\ndata: {}\n\n'); });
          const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000);
          heartbeat.unref();
          res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
          return;
        }
        if (url.pathname === '/api/wallet/test-credit' && req.method === 'POST') return send(res, 200, service.topUp(viewerId, body));
        if (url.pathname === '/api/leases' && req.method === 'POST') {
          const result = service.createLease(viewerId, body); return send(res, result.replayed ? 200 : 201, result);
        }
        const leaseMatch = /^\/api\/leases\/([a-zA-Z0-9_-]+)(?:\/(renew))?$/.exec(url.pathname);
        if (leaseMatch && !leaseMatch[2] && req.method === 'GET') return send(res, 200, { lease: service.getLease(viewerId, leaseMatch[1]) });
        if (leaseMatch?.[2] === 'renew' && req.method === 'POST') return send(res, 200, service.renewLease(viewerId, leaseMatch[1], body));
        if (url.pathname === '/api/tasks' && req.method === 'POST') {
          const result = service.createTask(viewerId, body);
          return send(res, result.replayed ? 200 : 201, result);
        }
        if (url.pathname === '/api/preferences' && req.method === 'PATCH') return send(res, 200, service.preferences(viewerId, body));
        const match = /^\/api\/tasks\/([a-zA-Z0-9_-]+)(?:\/(cancel|feedback))?$/.exec(url.pathname);
        if (match) {
          if (!match[2] && req.method === 'GET') return send(res, 200, { task: service.getTask(viewerId, match[1]) });
          if (match[2] === 'cancel' && req.method === 'POST') return send(res, 200, service.cancelTask(viewerId, match[1]));
          if (match[2] === 'feedback' && req.method === 'POST') return send(res, 201, service.feedback(viewerId, match[1], body));
        }
        throw new ApiError(404, 'NOT_FOUND', 'Local API route not found.');
      }
      if (distPath && ['GET', 'HEAD'].includes(req.method)) {
        const root = resolve(distPath);
        const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (file !== root && !file.startsWith(root + sep)) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
        let content;
        let extension = extname(file);
        try {
          content = await readFile(file);
        } catch {
          if (extension) throw new ApiError(404, 'NOT_FOUND', 'File not found.');
          content = await readFile(resolve(root, 'index.html'));
          extension = '.html';
        }
        res.writeHead(200, { 'Content-Type': TYPES[extension] ?? 'application/octet-stream' });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      throw new ApiError(404, 'NOT_FOUND', 'Build the frontend, or use the Vite development server.');
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Local demo request failed:', error);
      if (!res.headersSent) send(res, error instanceof ApiError ? error.status : 500, {
        error: { code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof ApiError ? error.message : 'The local demo could not complete this request.' },
      });
      else res.end();
    }
  });
}
