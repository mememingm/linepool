import { isShellPath } from '../linepool/workspace-reference/navigation';
import { isAdminPath } from '../linepool/admin/navigation';
import { isAgentPath } from '../linepool/agent/navigation';

export function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('Navigation must stay on this site');
  const address = url.pathname + url.search + url.hash;
  if (address === window.location.pathname + window.location.search + window.location.hash) return;
  if (replace) window.history.replaceState(null, '', address);
  else window.history.pushState(null, '', address);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function normalizeAddress() {
  const { pathname, search, hash } = window.location;
  const legacyShell = '#workspace-reference-shell';
  if (hash === legacyShell || hash.startsWith(legacyShell + '/') || hash.startsWith(legacyShell + '?')) {
    window.history.replaceState(null, '', '/app' + hash.slice(legacyShell.length));
    return;
  }
  const aliases: Record<string, string> = { '/welcome': '/', '/home-v2': '/', '/sign-in': '/login', '/sign-up': '/register' };
  if (aliases[pathname]) window.history.replaceState(null, '', aliases[pathname] + search);
  else if (pathname.length > 1 && pathname.endsWith('/')) window.history.replaceState(null, '', pathname.replace(/\/+$/, '') + search + hash);
}

function isAppPage(path: string) {
  return path === '/' || path === '/ascii-sharks' || path === '/login' || path === '/register' || path === '/forgot-password' || path === '/reset-password' || isShellPath(path) || isAdminPath(path) || isAgentPath(path);
}

// Use composedPath so links inside the homepage's Shadow DOM work too.
// Keep native behavior for section anchors, new tabs, downloads and external links.
export function handleSiteLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.composedPath().find(node => node instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.rel.split(/\s+/).includes('external')) return;
  const url = new URL(link.href);
  if (url.origin !== window.location.origin || url.hash || !isAppPage(url.pathname)) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
}
