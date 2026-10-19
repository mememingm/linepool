import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, RefreshCw } from 'lucide-react';
import type { LoginInput, RegisterInput, User } from '../api/contracts';
import { apiMessage } from '../workspace-reference/workspace-data';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { isAdminPath } from '../admin/navigation';
import { parseShellRoute, shellHref } from '../workspace-reference/navigation';
import { navigate } from '../../app/router';
import { OriginalScene, PreferenceControls, useWelcomePreferences } from './WelcomeShared';

export function loginDestination(role: User['role']) {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  if (redirect) {
    try {
      const url = new URL(redirect, window.location.origin);
      const localRoute = url.pathname + url.search;
      if (url.origin === window.location.origin && !url.hash && (
        role === 'ADMIN' ? isAdminPath(url.pathname) : parseShellRoute(localRoute).page !== 'not-found'
      )) return localRoute;
    } catch { /* Invalid return addresses fall back to the role's home page. */ }
  }
  return role === 'ADMIN' ? '/admin' : shellHref('dashboard');
}

export function WelcomeAccess({ loading, error, needsLogin, authenticate, retry, initialRegister = false }: {
  loading: boolean; error: string; needsLogin: boolean;
  authenticate: (input: LoginInput | RegisterInput) => Promise<void>; retry: () => void; initialRegister?: boolean;
}) {
  const p = useWelcomePreferences();
  const register = initialRegister;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    const title = document.title;
    document.title = `${p.t(register ? '注册' : '登录')} · LINEPOOL`;
    return () => { document.title = title; };
  }, [register, p.locale]);
  async function submit() {
    if (busy) return;
    setFailure('');
    if (register && password !== confirmation) { setFailure('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      await authenticate(register ? { email, password, displayName } : { email, password });
      setPassword(''); setConfirmation('');
    } catch (cause) { setFailure(apiMessage(cause)); }
    finally { setBusy(false); }
  }
  return <div className="lp-welcome-page"><OriginalScene /><main className="lp-welcome-auth" data-theme={p.theme} lang={p.locale}>
    <header className="lp-welcome-masthead"><a className="lp-welcome-brand" href="/">LINEPOOL</a><div className="lp-welcome-header-actions"><PreferenceControls preferences={p} /><a href="/"><ArrowLeft size={15} />{p.t('返回首页')}</a></div></header>
    <div className="lp-welcome-auth-layout"><section className="lp-welcome-introduction"><p>LINEPOOL</p><h1>{p.t('你的号码与短信，')}<br />{p.t('在这里连接。')}</h1><p>{p.t('一个账户，管理号码、使用期限与收到的短信。')}</p></section>
      <section className="lp-welcome-auth-panel" aria-labelledby="lp-welcome-auth-title"><div className="lp-welcome-auth-heading"><h2 id="lp-welcome-auth-title">{loading ? p.t('正在加载账户') : !needsLogin && error ? p.t('连接失败') : register ? p.t('创建你的 LINEPOOL 账户') : p.t('登录 LINEPOOL')}</h2><p>{register ? p.t('从一个账户开始，选择适合你的号码。') : p.t('欢迎回来。登录并继续访问你的工作台。')}</p></div>
        {loading ? <p role="status">{p.t('正在连接 API…')}</p> : needsLogin ? <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}><fieldset disabled={busy}>
          {register && <label>{p.t('昵称')}<input name="displayName" autoComplete="nickname" required maxLength={80} placeholder={p.t('怎么称呼你')} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>}
          <label>{p.t(register ? '邮箱' : '账号')}<input name="email" type={register ? 'email' : 'text'} autoComplete="username" inputMode={register ? 'email' : 'text'} required maxLength={254} placeholder={p.t(register ? '输入你的邮箱地址' : '输入账号或邮箱')} value={email} onChange={event => setEmail(event.target.value)} aria-describedby={failure || error ? 'lp-welcome-auth-error' : undefined} /></label>
          <div className="lp-welcome-field"><label htmlFor="lp-welcome-password">{p.t('密码')}</label><span className="lp-welcome-password"><input id="lp-welcome-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} placeholder={register ? p.t('至少 8 个字符') : p.t('输入密码')} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={p.t(showPassword ? '隐藏密码' : '显示密码')} title={p.t(showPassword ? '隐藏密码' : '显示密码')}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></div>
          {register && <label>{p.t('确认密码')}<input name="confirmPassword" type="password" autoComplete="new-password" required maxLength={72} placeholder={p.t('再次输入密码')} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
          <button className="lp-welcome-submit" type="submit"><ArrowRight size={17} />{busy ? p.t('正在提交…') : register ? p.t('创建账户') : p.t('登录')}</button>
        </fieldset></form> : null}
        {(failure || error) && <p id="lp-welcome-auth-error" className="lp-welcome-error" role="alert">{p.t(failure || error)}</p>}
        {!loading && !needsLogin && error && <button className="lp-welcome-submit" type="button" onClick={retry}><RefreshCw size={16} />{p.t('重新连接')}</button>}
        {needsLogin && !loading && <p className="lp-welcome-auth-switch">{register ? p.t('已有账户？') : p.t('没有账户？')}<button type="button" disabled={busy} onClick={() => navigate(`${register ? '/login' : '/register'}${window.location.search}`)}>{register ? p.t('Sign in · 登录') : p.t('Sign up · 注册')}</button></p>}
        <div className="lp-welcome-account-note"><p>{register ? p.t('注册后自动进入工作台，新账户积分余额为 0。') : p.t('使用账号或邮箱与密码登录，查看属于你的号码与短信。')}</p></div>
      </section>
    </div>
  </main></div>;
}
const api = createLinepoolApi();
export default function WelcomeLogin() {
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const result = await api.me({ signal });
      if (!signal?.aborted) navigate(loginDestination(result.data.role), true);
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof LinepoolApiError && cause.status === 401) setNeedsLogin(true);
      else setError(apiMessage(cause));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);
  async function authenticate(input: LoginInput | RegisterInput) {
    const result = 'displayName' in input ? await api.register(input) : await api.login(input);
    navigate(loginDestination(result.data.role), true);
  }
  return <WelcomeAccess loading={loading} error={error} needsLogin={needsLogin} authenticate={authenticate} retry={() => void checkSession()} initialRegister={window.location.pathname === '/register'} />;
}
