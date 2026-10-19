import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));
const apiTarget = process.env.LINEPOOL_API_TARGET ?? 'http://127.0.0.1:3010';
async function protectWorkspacePages(request: IncomingMessage, response: ServerResponse, next: () => void) {
  const address = request.url ?? '/';
  const pathname = new URL(address, 'http://localhost').pathname;
  if (!/^\/(app|admin)(\/|$)/.test(pathname)) return next();
  response.setHeader('Cache-Control', 'no-store');
  try {
    const admin = /^\/admin(\/|$)/.test(pathname);
    const access = await fetch(`${apiTarget}/api/${admin ? 'admin/session' : 'auth/me'}`, {
      headers: { Cookie: request.headers.cookie ?? '' }, signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    await access.body?.cancel();
    if (access.ok) {
      // Also migrate API-only cookies when an old session reaches a protected page.
      const cookies = access.headers.getSetCookie();
      if (cookies.length) response.setHeader('Set-Cookie', cookies);
      return next();
    }
    if (access.status === 401) {
      response.writeHead(302, { Location: `/login?redirect=${encodeURIComponent(pathname + new URL(address, 'http://localhost').search)}` });
      return response.end();
    }
    response.statusCode = access.status === 403 ? 403 : 503;
  } catch { response.statusCode = 503; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const denied = response.statusCode === 403;
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${denied ? '无访问权限' : '服务暂不可用'} · LINEPOOL</title><body><main><h1>${denied ? '403 · 无管理后台访问权限' : '503 · 暂时无法验证身份'}</h1><p>${denied ? '当前账号无法访问管理后台。' : '请稍后重试。'}</p><a href="/app">返回工作台</a></main></body></html>`);
}
const pageAuthentication: Plugin = {
  name: 'workspace-page-authentication',
  configureServer(server) { server.middlewares.use((req, res, next) => { void protectWorkspacePages(req, res, next); }); },
  configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void protectWorkspacePages(req, res, next); }); },
};
export default defineConfig(({ mode }) => ({
  resolve: { alias: [
    { find: /^@linepool\/ui-react$/, replacement: path('./dist/linepool-ui.js') },
    { find: '@linepool/ui-react/styles.css', replacement: path('./dist/linepool-ui.css') },
  ] },
  // The site consumes an already compiled library; do not Fast Refresh that bundle.
  plugins: [pageAuthentication, react({ exclude: /\/dist\// }), tailwindcss(), {
    name: 'unchanged-upstream-aliases',
    resolveId(source, importer) {
      if (!source.startsWith('@/') || !importer) return;
      if (importer.replaceAll('\\', '/').includes('/catalog/vendor/')) {
        return this.resolve(path(`./catalog/${source.slice(2)}`), importer, { skipSelf: true });
      }
      const library = importer.replaceAll('\\', '/').includes('/vendor/magic/') ? 'magic' : 'beautiful';
      return this.resolve(path(`./src/vendor/${library}/src/${source.slice(2)}`), importer, { skipSelf: true });
    },
  }, {
    name: 'website-public-assets',
    apply: 'build',
    generateBundle() {
      if (mode !== 'web') return;
      // Keep upstream originals intact; publish only the website's runtime assets.
      for (const directory of ['authkit-reference', 'illustrations', 'login-scene']) {
        for (const entry of readdirSync(path(`./public/${directory}`), { recursive: true })) {
          const file = entry.toString().replaceAll('\\', '/');
          if (!/\.(css|html|js|png|svg|ttf|woff2)$/.test(file)) continue;
          this.emitFile({ type: 'asset', fileName: `${directory}/${file}`, source: readFileSync(path(`./public/${directory}/${file}`)) });
        }
      }
    },
  }],
  appType: 'spa',
  server: {
    host: '127.0.0.1', port: 5178, strictPort: true,
    proxy: { '/api': apiTarget },
  },
  preview: {
    host: '127.0.0.1', port: 5178, strictPort: true,
    proxy: { '/api': apiTarget },
  },
  build: mode === 'web' ? { outDir: 'web-dist', copyPublicDir: false } : {
    // Keep the compiled component package watched during site development.
    outDir: mode === 'development' ? 'web-dist' : 'dist',
    lib: { entry: path('./src/index.ts'), formats: ['es'], fileName: 'linepool-ui', cssFileName: 'linepool-ui' },
    rollupOptions: { external: (id: string) => /^(react|react-dom|motion|next-themes|class-variance-authority|clsx|tailwind-merge|glimm|liveline|iconoir-react)(\/|$)/.test(id) },
  },
}));
