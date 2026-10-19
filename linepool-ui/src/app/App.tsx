import { lazy, Suspense, useEffect, useState } from 'react';
import { isAdminPath } from '../linepool/admin/navigation';
const AdminShell = lazy(() => import('../linepool/admin/AdminShell'));
import WelcomePage from '../linepool/welcome/WelcomePage';
import WelcomeLogin from '../linepool/welcome/WelcomeLogin';
import WorkspaceReferenceShell from '../linepool/workspace-reference/WorkspaceReferenceShell';
import { isShellPath } from '../linepool/workspace-reference/navigation';
import { handleSiteLink, normalizeAddress } from './router';

export default function App() {
  const [address, setAddress] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const sync = () => {
      normalizeAddress();
      setAddress(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    document.addEventListener('click', handleSiteLink);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      document.removeEventListener('click', handleSiteLink);
    };
  }, []);
  const path = address.split('?')[0];
  if (path === '/') return <WelcomePage />;
  if (path === '/login' || path === '/register') return <WelcomeLogin key={path} />;
  if (isAdminPath(path)) return <Suspense fallback={<main className="lp-site-not-found" role="status">正在加载管理后台…</main>}><AdminShell address={address} /></Suspense>;
  if (isShellPath(path)) return <WorkspaceReferenceShell />;
  return <main className="lp-site-not-found"><h1>页面不存在</h1><p>这个页面已移除或地址不正确。</p><a href="/">返回首页</a></main>;
}
