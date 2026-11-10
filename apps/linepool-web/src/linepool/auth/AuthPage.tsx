import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, RefreshCw } from 'lucide-react';
import type { LoginInput, RegisterInput, User } from '../api/contracts';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { primeWorkspace, queryClient } from '../api/query-client';
import { apiMessage } from '../workspace-reference/workspace-data';
import { isAgentPath } from '../agent/navigation';
import { loginDestination } from '../welcome/WelcomeLogin';
import { PcLoginButton } from '../agent/pc-components';
import { navigate } from '../../app/router';
import { DisplayToolbar } from '../preferences/DisplayControls';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flaps, reducedMotion, useClock } from '../home/Flaps';
import '../home/home.css';
import './auth.css';

const api = createLinepoolApi();
export const AUTH_PATHS = { login: '/login', register: '/register' } as const;

// Illustrative board traffic only; the board header labels it as a sample.
const senders = [
  { from: 'TELEGRAM', to: '+1 415 ··· 0142' }, { from: 'WHATSAPP', to: '+44 7700 ··· 21' },
  { from: 'GOOGLE', to: '+65 8123 ··· 07' }, { from: 'TELEGRAM', to: '+49 151 ··· 88' },
  { from: 'WHATSAPP', to: '+31 6 ··· 4410' }, { from: 'GOOGLE', to: '+1 604 ··· 7731' },
] as const;
type Arrival = { id: number; time: string; from: string; to: string; code: string };
const sampleCode = () => String(Math.floor(100000 + Math.random() * 900000));
const utcMinute = () => new Date().toISOString().slice(11, 16);

function isAgentRedirect() {
  try {
    const redirect = new URL(new URLSearchParams(window.location.search).get('redirect') ?? '/', window.location.origin);
    return redirect.origin === window.location.origin && !redirect.hash && isAgentPath(redirect.pathname);
  } catch { return false; }
}

function ArrivalsBoard({ t }: { t: (source: string) => string }) {
  const [rows, setRows] = useState<Arrival[]>(() => senders.slice(0, 5).map((sender, index) => ({ id: index, time: utcMinute(), ...sender, code: sampleCode() })));
  useEffect(() => {
    if (reducedMotion()) return;
    let id = rows.length;
    const timer = window.setInterval(() => {
      const sender = senders[id % senders.length]!;
      setRows(current => [{ id: id++, time: utcMinute(), ...sender, code: sampleCode() }, ...current].slice(0, 5));
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="lp-arrivals" role="img" aria-label={t('示例收码看板')}>
    <div className="lp-arrivals-head"><span>{t('时间')}</span><span>{t('来自')}</span><span>{t('号码')}</span><span>{t('验证码')}</span></div>
    {rows.map((row, index) => <div key={row.id} className="lp-arrivals-row" data-latest={index === 0 || undefined}>
      <span>{row.time}</span><span>{row.from}</span><span>{row.to}</span>
      <span>{index === 0 ? <Flaps text={row.code} className="lp-flaps-row" /> : row.code}</span>
    </div>)}
  </div>;
}

function strength(password: string) {
  return [password.length >= 8, password.length >= 12, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password) && /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
}

export default function AuthPage({ register }: { register: boolean }) {
  const p = useDisplayPreferences();
  const { t } = p;
  const clock = useClock();
  const agentLogin = !register && isAgentRedirect();
  const switchingAccount = new URLSearchParams(window.location.search).get('switchAccount') === 'local';
  const [checking, setChecking] = useState(true);
  const [connection, setConnection] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setConnection(''); setChecking(true);
    try {
      const result = await api.me({ signal });
      if (!signal?.aborted) {
        setCurrentUser(result.data);
        if (!switchingAccount) navigate(loginDestination(result.data), true);
      }
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof LinepoolApiError && cause.status === 401) setCurrentUser(null);
      else setConnection(apiMessage(cause));
    } finally { if (!signal?.aborted) setChecking(false); }
  }, [switchingAccount]);
  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, [checkSession]);
  useEffect(() => {
    const title = document.title;
    document.title = `${t(register ? '注册' : agentLogin ? '代理登录' : '登录')} · LINEPOOL`;
    return () => { document.title = title; };
  }, [register, agentLogin, t]);

  async function submit() {
    if (busy) return;
    setFailure('');
    if (register && password !== confirmation) { setFailure('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      const input: LoginInput | RegisterInput = register ? { email, password, displayName } : { email, password };
      const result = 'displayName' in input ? await api.register(input) : await api.login(input);
      setPassword(''); setConfirmation('');
      queryClient.clear();
      await primeWorkspace(result.data);
      navigate(loginDestination(result.data), true);
    } catch (cause) { setFailure(apiMessage(cause)); }
    finally { setBusy(false); }
  }
  const switchTo = (next: 'login' | 'register') => navigate(AUTH_PATHS[next] + window.location.search);
  const trackCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));
  const spotlight = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
    event.currentTarget.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
    event.currentTarget.dataset.lit = '';
  };
  const dim = (event: PointerEvent<HTMLElement>) => { delete event.currentTarget.dataset.lit; };
  const score = strength(password);
  const scoreLabel = ['太短', '一般', '良好', '强', '很强'][score]!;
  const error = failure || connection;
  const cancelDestination = currentUser ? loginDestination(currentUser) : '/';
  const cancelLabel = currentUser?.role === 'ADMIN' ? '返回管理后台' : currentUser?.authKind === 'PINCLODE' ? '取消切换，返回代理中心' : currentUser ? '返回工作台' : '返回首页';

  return <div className="lp-home lp-auth" lang={p.locale}>
    <aside className="lp-auth-board" aria-label={t('LINEPOOL 账户')} onPointerMove={spotlight} onPointerLeave={dim}>
      <div className="lp-auth-board-top">
        <a href="/" className="lp-auth-brand"><b>LINE</b><em>pool</em></a>
        <span className="lp-auth-clock"><i className="lp-dot" />UTC {clock}</span>
      </div>
      <div className="lp-auth-board-title">
        <p>{t('收码看板')} · {t('示例')}</p>
        <h2>{t(register ? '一个账户，' : agentLogin ? '连接与验证码，' : '每一条验证码，')}<br /><em>{t(register ? '从这里出发。' : agentLogin ? '在这里查看。' : '准时到站。')}</em></h2>
      </div>
      <ArrivalsBoard t={t} />
      <p className="lp-auth-board-foot"><span>{t('号码')} · {t('短信')} · {t('积分')}</span><span>{t('仅接收短信')}</span></p>
    </aside>

    <main className="lp-auth-main">
      <header className="lp-auth-top">
        <a href="/" className="lp-auth-brand lp-auth-brand-mobile"><b>LINE</b><em>pool</em></a>
        <DisplayToolbar />
        <a href="/" className="lp-home-text-link lp-auth-back"><ArrowLeft size={15} />{t('返回首页')}</a>
      </header>

      <section className="lp-pass" aria-labelledby="lp-auth-title">
        <div className="lp-pass-head">
          <span>LINEPOOL · {register ? 'NEW PASS' : agentLogin ? 'AGENT PASS' : 'BOARDING PASS'}</span>
          <span>GATE {register ? 'R-02' : 'L-01'}</span>
        </div>
        <div className="lp-pass-tabs" role="tablist" aria-label={t('账户入口')} data-active={register ? 'register' : 'login'}>
          <button type="button" role="tab" aria-selected={!register} onClick={() => register && switchTo('login')}>{t('登录')}</button>
          <button type="button" role="tab" aria-selected={register} onClick={() => !register && switchTo('register')}>{t('注册')}</button>
        </div>
        <div className="lp-pass-body">
          <h1 id="lp-auth-title">{checking ? t('正在加载账户') : register ? t('创建你的 LINEPOOL 账户') : switchingAccount ? t('切换本站账号') : t('欢迎回来')}</h1>
          <p className="lp-pass-sub">{switchingAccount ? t('登录后进入该账号的工作台或管理后台，PC 连接授权会保留。') : register ? t('从一个账户开始，选择适合你的号码。') : t(agentLogin ? '代理使用下方 PinClode 入口登录自己的连接。' : '登录后继续查看你的号码、短信与积分。')}</p>

          <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}>
            <fieldset disabled={busy || checking}>
              {register && <label className="lp-line-field"><span>{t('昵称')}</span><input name="displayName" autoComplete="nickname" required maxLength={80} placeholder={t('怎么称呼你')} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>}
              <label className="lp-line-field"><span>{t(register ? '邮箱' : '账号')}</span><input name="email" type={register ? 'email' : 'text'} autoComplete="username" inputMode={register ? 'email' : 'text'} required maxLength={254} placeholder={t(register ? '输入你的邮箱地址' : '输入账号或邮箱')} value={email} onChange={event => setEmail(event.target.value)} aria-describedby={error ? 'lp-auth-error' : undefined} /></label>
              <div className="lp-line-field">
                <span className="lp-line-field-row"><label htmlFor="lp-auth-password">{t('密码')}</label>{!register && <button type="button" className="lp-auth-link" onClick={() => navigate(`/forgot-password${email && email !== 'admin' ? `?email=${encodeURIComponent(email)}` : ''}`)}>{t('忘记密码？')}</button>}</span>
                <span className="lp-line-password"><input id="lp-auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} placeholder={register ? t('至少 8 个字符') : t('输入密码')} value={password} onChange={event => setPassword(event.target.value)} onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={t(showPassword ? '隐藏密码' : '显示密码')} title={t(showPassword ? '隐藏密码' : '显示密码')}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
                {capsLock && <small className="lp-line-hint" role="status">{t('大写锁定已开启')}</small>}
                {register && password && <span className="lp-strength" data-score={score} aria-label={`${t('密码强度')}：${t(scoreLabel)}`}>{[0, 1, 2, 3].map(index => <i key={index} data-on={index < score || undefined} />)}<small>{t(scoreLabel)}</small></span>}
              </div>
              {register && <label className="lp-line-field"><span className="lp-line-field-row">{t('确认密码')}{confirmation && confirmation === password && <Check size={15} className="lp-line-ok" aria-label={t('密码一致')} />}</span><input name="confirmPassword" type="password" autoComplete="new-password" required maxLength={72} placeholder={t('再次输入密码')} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
              {error && <p id="lp-auth-error" className="lp-auth-error" role="alert">{t(error)}</p>}
              {connection
                ? <button type="button" className="lp-pass-submit" onClick={() => void checkSession()}><span>{t('重新连接')}</span><RefreshCw size={17} /></button>
                : <button type="submit" className="lp-pass-submit"><span>{busy ? t('正在提交…') : register ? t('创建账户') : t('登录')}</span><ArrowRight size={18} /></button>}
            </fieldset>
          </form>
          {switchingAccount && <p className="lp-auth-switch"><button type="button" className="lp-auth-link" disabled={busy || checking} onClick={() => navigate(cancelDestination)}>{t(cancelLabel)}</button></p>}
          <p className="lp-auth-switch">{register ? t('已有账户？') : t('没有账户？')}<button type="button" className="lp-auth-link" disabled={busy} onClick={() => switchTo(register ? 'login' : 'register')}>{register ? t('登录') : t('注册')}</button></p>
          {!register && <div className="lp-auth-pc-entry"><PcLoginButton appearance="auth" /></div>}
        </div>
        <div className="lp-pass-stub">
          <p>{register ? t('注册后自动进入工作台，新账户积分余额为 0。') : t('本站普通用户使用账号或邮箱与密码登录。代理使用 PinClode 登录。')}</p>
          <span className="lp-barcode" aria-hidden />
          <span className="lp-pass-stub-code" aria-hidden>ADMIT ONE · RECEIVE ONLY</span>
        </div>
      </section>
    </main>
  </div>;
}
