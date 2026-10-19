import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronDown, ChevronRight, CircleHelp, Database, History, LayoutGrid, ListTodo, Menu, Moon, RefreshCw, ScanLine, ShieldCheck, Sun, Wallet } from 'lucide-react';
import { api, errorText } from './api';
import { DemoBadge, Modal, Spinner, Toast } from './components';
import { AccountDialog, CancelDialog, FeedbackDialog, TaskDrawer } from './dialogs';
import { FinancePage, HistoryPage } from './pages';
import { PageMotion } from './motion';
import { AdminPage } from './admin';
import { type Bootstrap, type PageId, type Task, type Lease, type LeaseResource } from './types';

import { LeaseMarket, MyLeases, LeaseDrawer, LeasePurchaseDialog, LeaseBills, LeaseHelp } from './lease-pages';

const navigation = [
  { id: 'market', label: '号码商城', icon: LayoutGrid },
  { id: 'tasks', label: '我的号码', icon: ListTodo },
  { id: 'history', label: '历史一次取码', icon: History },
  { id: 'finance', label: '账单与钱包', icon: Wallet },
  { id: 'help', label: '帮助中心', icon: CircleHelp },
  { id: 'admin', label: '运营后台', icon: ShieldCheck },
] as const;
const currentPage = (): PageId => {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return navigation.find(n => n.id === hash)?.id ?? 'market';
};


export default function App() {
  const [page, setPage] = useState<PageId>(currentPage);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [realtime, setRealtime] = useState(false);

  const [now, setNow] = useState(Date.now());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{ resource?: LeaseResource; lease?: Lease } | null>(null);
  const [cancelTask, setCancelTask] = useState<Task | null>(null);
  const [feedbackTask, setFeedbackTask] = useState<Task | null>(null);
  const [account, setAccount] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const clockOffset = useRef(0);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutationCount = useRef(0);
  const eventPending = useRef(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  const refresh = useCallback(async (): Promise<boolean> => {
    if (mutationCount.current) return false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const sequence = ++generation.current;
    setSyncing(true);
    try {
      const snapshot = await api<Bootstrap>('/bootstrap', { signal: controller.signal });
      if (sequence !== generation.current) return false;
      clockOffset.current = Date.parse(snapshot.serverNow) - Date.now();
      setData(snapshot); setNow(Date.now() + clockOffset.current);
      setConnectionError(''); 
      document.documentElement.dataset.theme = snapshot.preferences.theme;
      return true;
    } catch (error) {
      if (!controller.signal.aborted && sequence === generation.current) setConnectionError(errorText(error));
      return false;
    } finally {
      if (sequence === generation.current) {
        request.current = null; setSyncing(false);
        if (eventPending.current && !mutationCount.current) { eventPending.current = false; queueMicrotask(() => void refresh()); }
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { if (!document.hidden && !request.current && !mutationCount.current) void refresh(); }, 8000);
    const tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    const visibility = () => { if (!document.hidden && !mutationCount.current) void refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { request.current?.abort(); clearInterval(poll); clearInterval(tick); document.removeEventListener('visibilitychange', visibility); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [refresh]);
  useEffect(() => {
    if (!data?.viewer.id) return;
    const events = new EventSource('/api/events');
    const changed = () => {
      if (request.current || mutationCount.current) eventPending.current = true;
      else void refresh();
    };
    events.onopen = () => { setRealtime(true); changed(); };
    events.onerror = () => setRealtime(false);
    events.addEventListener('change', changed);
    return () => { events.close(); setRealtime(false); };
  }, [data?.viewer.id, refresh]);
  useEffect(() => {
    const changed = () => setPage(currentPage());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => { document.title = `${navigation.find(n => n.id === page)?.label} · ONCE`; }, [page]);

  async function mutate<T>(work: () => Promise<T>): Promise<T> {
    mutationCount.current++;
    request.current?.abort(); request.current = null; generation.current++;
    setSyncing(false);
    try { return await work(); }
    finally { mutationCount.current--; }
  }
  function mergeTask(task: Task) {
    setData(previous => previous ? { ...previous, tasks: [task, ...previous.tasks.filter(t => t.id !== task.id)].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) } : previous);
  }
  async function purchased(lease: Lease) {
    setData(previous => previous ? { ...previous, leases: [lease, ...previous.leases.filter(l => l.id !== lease.id)] } : previous);
    setPurchase(null); setSelectedLeaseId(lease.id); window.location.hash = '/tasks';
    notify(lease.status === 'FAILED' ? '开通失败，未扣测试额度。' : '租约已保存，测试租金已结算。');
    await refresh();
  }
  async function confirmCancel() {
    if (!cancelTask) return;
    const result = await mutate(() => api<{ task: Task }>(`/tasks/${encodeURIComponent(cancelTask.id)}/cancel`, { method: 'POST', body: '{}' }));
    mergeTask(result.task); setCancelTask(null);
    notify(result.task.settlementStatus === 'TEST_REFUNDED' ? '订单已取消，预占测试额度已退回。' : '订单已取消，请查看结算状态。');
    await refresh();
  }
  async function saveFeedback(message: string) {
    if (!feedbackTask) return;
    await mutate(() => api(`/tasks/${encodeURIComponent(feedbackTask.id)}/feedback`, { method: 'POST', body: JSON.stringify({ message }) }));
    setFeedbackTask(null); notify('反馈已保存在本地数据库，未发送给在线客服。');
  }
  async function changeTheme() {
    if (!data || themeBusy) return;
    const theme = data.preferences.theme === 'light' ? 'dark' : 'light';
    setThemeBusy(true);
    try {
      await mutate(() => api('/preferences', { method: 'PATCH', body: JSON.stringify({ theme }) }));
      setData(previous => previous ? { ...previous, preferences: { theme } } : previous);
      document.documentElement.dataset.theme = theme;
      await refresh();
    } catch (error) { notify(errorText(error), 'error'); }
    finally { setThemeBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); notify('已复制到剪贴板。'); }
    catch { notify('浏览器未允许复制，请手动选择内容。', 'error'); }
  }
  function openTask(task: Task) { setSelectedTaskId(task.id); }
  const selectedTask = data?.tasks.find(t => t.id === selectedTaskId);
  const selectedLease = data?.leases.find(l => l.id === selectedLeaseId);
  const activeCount = data?.leases.filter(l => l.status === 'ACTIVE').length ?? 0;
  const navLinks = navigation.map(({ id, label, icon: Icon }) => <a key={id} href={`#/${id}`} className={`nav-link ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setMobileMenu(false)}><Icon size={19} /><span>{label}</span>{id === 'tasks' && activeCount > 0 && <span className="nav-count">{activeCount}</span>}</a>);

  return <div className="app-shell"><a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>跳到主内容</a><aside className="sidebar"><a className="brand" href="#/market" aria-label="ONCE 工作台"><span className="brand-symbol"><ScanLine size={23} strokeWidth={2.5} /></span><span>ONCE<small>独占号码租赁</small></span></a><div className="nav-caption">工作空间</div><nav aria-label="主导航">{navLinks}</nav><div className="sidebar-bottom"><div className="environment"><Database size={16} /><span>本地演示环境<small><span className={`live-dot ${connectionError ? 'offline' : ''}`} />{data ? connectionError ? '连接中断' : realtime ? '实时更新已连接' : '自动重连中' : '等待连接'}</small></span><ShieldCheck size={15} /></div><button className="profile-button" disabled={!data} onClick={() => setAccount(true)}><span className="avatar">D</span><span>Demo workspace<small>本地工作区</small></span><ChevronDown size={16} /></button></div></aside>
    <div className="app-main"><header className="topbar"><button className="icon-button mobile-menu-button" title="打开导航" aria-label="打开导航" onClick={() => setMobileMenu(true)}><Menu size={21} /></button><div className="breadcrumb"><span>工作台</span><ChevronRight size={14} /><strong>{navigation.find(n => n.id === page)?.label}</strong></div><div className="top-actions"><DemoBadge /><span className="top-separator" /><button className="icon-button" aria-label={data?.preferences.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} title={data?.preferences.theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} disabled={!data || themeBusy} onClick={() => void changeTheme()}>{themeBusy ? <Spinner /> : data?.preferences.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><a className="icon-button desktop-help" href="#/help" title="帮助中心" aria-label="帮助中心"><CircleHelp size={19} /></a><button className="avatar top-avatar" aria-label="查看本地工作区" disabled={!data} onClick={() => setAccount(true)}>D</button></div></header>
    <main id="main" tabIndex={-1} className="main-content">{connectionError && <div className="connection-banner" role="alert"><AlertCircle size={18} /><span>{connectionError}{data && ' 当前展示上次同步的数据。'}</span><button className="text-button" disabled={syncing} onClick={() => void refresh()}><RefreshCw size={15} />重试</button></div>}{!data ? <div className="initial-state">{!connectionError && <><Spinner /><h1>正在连接本地工作区</h1><p>读取 SQLite 数据</p></>}{connectionError && <><Database size={34} /><h1>暂时无法连接</h1><p>本地 API 需运行在 127.0.0.1:3028</p><button className="button primary" disabled={syncing} onClick={() => void refresh()}>{syncing ? <Spinner /> : <RefreshCw size={16} />}重新连接</button></>}</div> : <>
      <PageMotion active={page === 'tasks'}><MyLeases data={data} now={now} onOpen={lease => setSelectedLeaseId(lease.id)} /></PageMotion>
      <PageMotion active={page === 'market'}><LeaseMarket data={data} onSelect={resource => setPurchase({ resource })} /></PageMotion>
      <PageMotion active={page === 'history'}><HistoryPage data={data} now={now} onOpen={openTask} onCopy={copy} /></PageMotion>
      <PageMotion active={page === 'finance'}><LeaseBills data={data} onOpen={lease => setSelectedLeaseId(lease.id)} /><FinancePage data={data} now={now} onOpen={openTask} onRefresh={refresh} /></PageMotion>
      <PageMotion active={page === 'help'}><LeaseHelp /></PageMotion>
      <PageMotion active={page === 'admin'}><AdminPage active={page === 'admin'} /></PageMotion>
      <footer className="page-footer"><span>ONCE<span className="footer-dot">·</span>独占号码租赁</span><span>本地演示 / 无真实交易<a href="#/help" aria-label="查看服务规则"><ArrowUpRight size={13} /></a></span></footer>
    </>}</main></div>
    {mobileMenu && <Modal title="ONCE · 工作空间" onClose={() => setMobileMenu(false)} className="navigation-dialog"><nav aria-label="移动导航">{navLinks}</nav><button className="profile-button" disabled={!data} onClick={() => { setMobileMenu(false); setAccount(true); }}><span className="avatar">D</span><span>Demo workspace<small>本地工作区</small></span><ChevronRight size={16} /></button></Modal>}
    {selectedLease && <LeaseDrawer lease={selectedLease} now={now} onClose={() => setSelectedLeaseId(null)} onCopy={copy} onRenew={() => setPurchase({ lease: selectedLease })} />}
    {purchase && data && <LeasePurchaseDialog {...purchase} viewerId={data.viewer.id} plans={data.leasePlans} onClose={() => setPurchase(null)} onDone={purchased} />}
    {selectedTask && <TaskDrawer key={selectedTask.id} task={selectedTask} now={now} onClose={() => setSelectedTaskId(null)} onCopy={copy} onRefresh={refresh} onCancel={() => setCancelTask(selectedTask)} onFeedback={() => setFeedbackTask(selectedTask)} />}
    {cancelTask && <CancelDialog task={cancelTask} onClose={() => setCancelTask(null)} onConfirm={confirmCancel} />}
    {feedbackTask && <FeedbackDialog task={feedbackTask} onClose={() => setFeedbackTask(null)} onSubmit={saveFeedback} />}
    {account && data && <AccountDialog viewer={data.viewer} onClose={() => setAccount(false)} />}
    <Toast message={toast?.message ?? null} tone={toast?.tone} />
  </div>;
}
