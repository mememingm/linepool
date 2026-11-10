import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { createLinepoolApi, LinepoolApiError } from '../api/client';
import { apiMessage } from '../workspace-reference/workspace-data';
import { PreferenceControls, useWelcomePreferences } from './WelcomeShared';
import { queryClient } from '../api/query-client';

const api = createLinepoolApi();

export default function WelcomePasswordRecovery({ reset }: { reset: boolean }) {
  const p = useWelcomePreferences();
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') ?? '');
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invalidToken, setInvalidToken] = useState(reset && !/^[a-f0-9]{64}$/.test(token));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [sent, setSent] = useState(false);
  const [changed, setChanged] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const title = reset ? '重置密码' : '找回密码';

  useEffect(() => {
    const previous = document.title;
    document.title = `${p.t(title)} · LINEPOOL`;
    return () => { document.title = previous; };
  }, [title, p.locale]);
  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setInterval(() => setRetryAfter(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter > 0]);

  async function submit() {
    if (busy || (!reset && retryAfter > 0)) return;
    setFailure('');
    if (reset && password !== confirmation) { setFailure('两次输入的新密码不一致'); return; }
    if (reset && new TextEncoder().encode(password).length > 72) { setFailure('密码不能超过 72 个 UTF-8 字节'); return; }
    setBusy(true);
    try {
      if (reset) {
        await api.resetPassword({ token, newPassword: password });
        queryClient.clear();
        setChanged(true); setPassword(''); setConfirmation('');
        window.history.replaceState(null, '', '/reset-password');
      } else {
        await api.forgotPassword({ email });
        setSent(true); setRetryAfter(60);
      }
    } catch (cause) {
      if (cause instanceof LinepoolApiError && cause.code === 'INVALID_RESET_TOKEN') setInvalidToken(true);
      setFailure(apiMessage(cause));
    } finally { setBusy(false); }
  }

  return <div className="lp-welcome-page"><main className="lp-welcome-auth" data-theme={p.theme} lang={p.locale}>
    <header className="lp-welcome-masthead"><a className="lp-welcome-brand" href="/">LINEPOOL</a><div className="lp-welcome-header-actions"><PreferenceControls preferences={p} /><a href="/login"><ArrowLeft size={15} />{p.t('返回登录')}</a></div></header>
    <div className="lp-welcome-auth-layout"><section className="lp-welcome-introduction"><p>LINEPOOL</p><h1>{p.t('你的号码与短信，')}<br />{p.t('在这里连接。')}</h1><p>{p.t('一个账户，管理号码、使用期限与收到的短信。')}</p></section>
      <section className="lp-welcome-auth-panel" aria-labelledby="lp-recovery-title">
        <div className="lp-welcome-auth-heading"><h2 id="lp-recovery-title">{p.t(changed ? '密码已重置' : title)}</h2><p>{p.t(changed ? '请使用新密码重新登录，其他设备上的登录已失效。' : reset ? '设置新密码，重新访问你的账户。' : '输入注册邮箱，我们会向该邮箱发送重置链接。')}</p></div>
        {invalidToken && <p className="lp-welcome-error" role="alert">{p.t('重置链接无效或已过期，请重新申请。')}</p>}
        {sent && <p className="lp-welcome-recovery-notice" role="status">{p.t('如果该邮箱已注册且账号可用，你会收到重置邮件。请检查收件箱和垃圾邮件。')}</p>}
        {!changed && !invalidToken && <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}><fieldset disabled={busy}>
          {reset ? <><div className="lp-welcome-field"><label htmlFor="lp-reset-password">{p.t('新密码')}</label><span className="lp-welcome-password"><input id="lp-reset-password" name="newPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={72} placeholder={p.t('至少 8 个字符')} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={p.t(showPassword ? '隐藏密码' : '显示密码')}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></div>
            <label>{p.t('确认新密码')}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} placeholder={p.t('再次输入密码')} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>
            : <label>{p.t('注册邮箱')}<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder={p.t('输入你的邮箱地址')} value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} /></label>}
          <button className="lp-welcome-submit" type="submit" disabled={!reset && retryAfter > 0}><ArrowRight size={17} />{p.t(busy ? '正在提交…' : reset ? '确认重置密码' : sent || retryAfter > 0 ? '重新发送' : '发送重置链接')}{!reset && retryAfter > 0 ? ` (${retryAfter}s)` : ''}</button>
        </fieldset></form>}
        {failure && !invalidToken && <p className="lp-welcome-error" role="alert">{p.t(failure)}</p>}
        {changed ? <a className="lp-welcome-submit" href="/login">{p.t('返回登录')}</a> : <p className="lp-welcome-auth-switch">{reset && <a href="/forgot-password">{p.t('重新申请重置链接')}</a>}<a href="/login">{p.t('返回登录')}</a></p>}
        <div className="lp-welcome-account-note"><p>{p.t('仅适用本站普通账号。PinClode 代理请通过 PinClode 重新授权。')}</p><p>{p.t('重置链接 30 分钟内有效，且只能使用一次。')}</p><p>{p.t('无法使用注册邮箱时，请联系管理员协助重置密码。')}</p><a href="/agent">{p.t('使用 PinClode 登录代理中心')}</a></div>
      </section>
    </div>
  </main></div>;
}
