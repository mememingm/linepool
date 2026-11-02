import { lazy, Suspense, useEffect, useState } from 'react';
import { isAdminPath } from '../linepool/admin/navigation';
import { isAgentPath } from '../linepool/agent/navigation';
const AdminShell = lazy(() => import('../linepool/admin/AdminShell'));
const AgentAdminShell = lazy(() => import('../linepool/agent/AgentAdminShell'));
import WelcomeLogin from '../linepool/welcome/WelcomeLogin';
import WelcomePasswordRecovery from '../linepool/welcome/WelcomePasswordRecovery';
import { OriginalScene } from '../linepool/welcome/WelcomeShared';
const WorkspaceReferenceShell = lazy(() => import('../linepool/workspace-reference/WorkspaceReferenceShell'));
import { isShellPath } from '../linepool/workspace-reference/navigation';
import HomePage from '../linepool/home/HomePage';
const AsciiSharksDemo = lazy(() => import('../linepool/ascii-sharks/AsciiSharksDemo'));
import { handleSiteLink, normalizeAddress } from './router';

function WorkspaceSkeleton() {
  return <main className="lp-shell-page lp-shell-loading" role="status" aria-label="正在加载工作台"><aside /><section><i /><i /><i /></section></main>;
}

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
  if (path === '/ascii-sharks') return <Suspense fallback={<main className="lp-site-not-found" style={{ background: '#080e12', color: '#dce7e3' }} role="status">正在唤醒字符海洋…</main>}><AsciiSharksDemo /></Suspense>;
  if (path === '/') return <HomePage />;
  if (path === '/forgot-password' || path === '/reset-password') return <><OriginalScene /><WelcomePasswordRecovery key={path} reset={path === '/reset-password'} /></>;
  const welcomePath = path === '/login' || path === '/register';
  if (welcomePath) return <><OriginalScene /><WelcomeLogin key={path} /></>;
  if (isAdminPath(path)) return <Suspense fallback={<main className="lp-site-not-found" role="status">正在加载管理后台…</main>}><AdminShell address={address} /></Suspense>;
  if (isAgentPath(path)) return <Suspense fallback={<main className="lp-site-not-found" role="status">正在加载代理中心…</main>}><AgentAdminShell address={address} /></Suspense>;
  if (isShellPath(path)) return <Suspense fallback={<WorkspaceSkeleton />}><WorkspaceReferenceShell /></Suspense>;
  return <main className="lp-site-not-found"><h1>页面不存在</h1><p>这个页面已移除或地址不正确。</p><a href="/">返回首页</a></main>;
}
