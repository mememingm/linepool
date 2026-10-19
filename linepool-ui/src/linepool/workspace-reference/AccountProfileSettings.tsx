import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Mail, Pencil, Smartphone, UserRound } from 'lucide-react';
import { accountProfileInputSchema, type Account, type AccountProfileInput } from '../api/contracts';
import { LinepoolApiError } from '../api/client';
import { ActionButton } from '../components';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from './workspace-data';
import './AccountProfileSettings.css';

type Field = AccountProfileInput['field'];
type Props = {
  account: Account;
  updateProfile: (input: AccountProfileInput) => Promise<Account>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export default function AccountProfileSettings({ account, updateProfile, disabled = false, onBusyChange }: Props) {
  const p = useDisplayPreferences();
  const id = useId();
  const [editor, setEditor] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'value' | 'password' | null>(null);
  const [saved, setSaved] = useState('');
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const triggers = useRef<Partial<Record<Field, HTMLDivElement | null>>>({});
  const closing = useRef<Field | null>(null);
  const fields = [
    { field: 'displayName', label: '账户名称', value: account.displayName, action: '修改账户名称', icon: UserRound },
    { field: 'email', label: '登录邮箱', value: account.email, action: '更换邮箱', icon: Mail },
    { field: 'phoneNumber', label: '手机号', value: account.phoneNumber ?? '', action: account.phoneNumber ? '更换手机号' : '添加手机号', icon: Smartphone },
  ] as const;
  const active = fields.find(item => item.field === editor);
  const normalized = editor === 'email' ? draft.trim().toLowerCase() : draft.trim();
  const unchanged = !active || normalized === active.value;

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (editor) input.current?.focus();
    else if (closing.current) { triggers.current[closing.current]?.querySelector<HTMLButtonElement>('button')?.focus(); closing.current = null; }
  }, [editor]);

  function clearError() { setError(''); setErrorField(null); }
  function open(field: Field, value: string) {
    if (lock.current || disabled) return;
    setEditor(field); setDraft(value); setPassword(''); setSaved(''); clearError();
  }
  function close() {
    closing.current = editor;
    setEditor(null); setDraft(''); setPassword(''); clearError();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || lock.current || disabled || unchanged) return;
    const candidate = editor === 'displayName'
      ? { field: editor, displayName: draft }
      : editor === 'email'
        ? { field: editor, email: draft, currentPassword: password }
        : { field: editor, phoneNumber: draft, currentPassword: password };
    const parsed = accountProfileInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const passwordIssue = parsed.error.issues.some(issue => issue.path[0] === 'currentPassword');
      setErrorField(passwordIssue ? 'password' : 'value');
      setError(passwordIssue ? '请输入当前密码（8–72 个字符，最多 72 个 UTF-8 字节）'
        : editor === 'displayName' ? '账户名称需为 1–80 个字符'
          : editor === 'email' ? '请输入有效的邮箱地址' : '请输入包含国家区号的手机号，例如 +8613812345678');
      return;
    }
    lock.current = true; setBusy(true); clearError();
    try {
      await updateProfile(parsed.data);
      setSaved(editor === 'displayName' ? '账户名称已保存' : editor === 'email' ? '邮箱已更新，下次请使用新邮箱登录' : '手机号已保存');
      close();
    } catch (failure) {
      setError(failure instanceof LinepoolApiError && failure.code === 'REQUEST_TIMEOUT'
        ? '保存请求超时，请刷新账户资料确认后重试' : apiMessage(failure));
      setErrorField(failure instanceof LinepoolApiError
        ? failure.code === 'INVALID_CURRENT_PASSWORD' ? 'password' : failure.code === 'EMAIL_EXISTS' ? 'value' : null : null);
    } finally {
      setPassword(''); lock.current = false; setBusy(false);
    }
  }

  return <section className="lp-shell-view-settings-group lp-account-profile" aria-labelledby={`${id}-title`}>
    <div className="lp-shell-view-settings-heading"><h2 id={`${id}-title`}>{p.t('账户资料')}</h2><span className="lp-shell-view-meta">{p.t('管理名称与联系方式')}</span></div>
    <div className="lp-account-profile-rows">
      {fields.map(item => <div className="lp-account-profile-item" key={item.field}>
        <div className="lp-account-profile-row">
          <item.icon size={18} aria-hidden="true" />
          <div><strong>{p.t(item.label)}</strong><span className={!item.value ? 'is-empty' : undefined}>{item.value || p.t('未设置')}</span></div>
          <div className="lp-account-profile-trigger" ref={node => { triggers.current[item.field] = node; }}><ActionButton size="sm" disabled={busy || disabled} aria-expanded={editor === item.field} aria-controls={`${id}-${item.field}-editor`} onClick={() => open(item.field, item.value)}><Pencil size={13} aria-hidden="true" />{p.t(item.action)}</ActionButton></div>
        </div>
        <div id={`${id}-${item.field}-editor`} hidden={editor !== item.field}>
          {editor === item.field && <form className="lp-account-profile-editor" noValidate onSubmit={event => void save(event)} aria-labelledby={`${id}-editor-title`} aria-busy={busy} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); } }}>
            <h3 id={`${id}-editor-title`}>{p.t(item.action)}</h3>
            <p id={`${id}-help`} className="lp-shell-view-meta">{p.t(editor === 'displayName' ? '账户名称会同步显示在工作台和侧边栏。' : editor === 'email' ? '更换后使用新邮箱登录，其他设备的登录会话将退出。' : '手机号仅作为联系资料，暂不支持手机号登录或短信验证。')}</p>
            <div className="lp-account-profile-fields">
              <label htmlFor={`${id}-value`}><span>{p.t(editor === 'email' ? '新邮箱' : editor === 'phoneNumber' ? '新手机号' : '账户名称')}</span>
                <input ref={input} id={`${id}-value`} name={editor} type={editor === 'email' ? 'email' : editor === 'phoneNumber' ? 'tel' : 'text'} autoComplete={editor === 'email' ? 'email' : editor === 'phoneNumber' ? 'tel' : 'nickname'} maxLength={editor === 'displayName' ? 80 : editor === 'email' ? 254 : 16} placeholder={editor === 'phoneNumber' ? '+8613812345678' : undefined} value={draft} required disabled={busy || disabled} aria-invalid={errorField === 'value' || undefined} aria-describedby={`${id}-help${errorField === 'value' ? ` ${id}-error` : ''}`} onChange={event => { setDraft(event.target.value); clearError(); }} />
              </label>
              {editor !== 'displayName' && <label htmlFor={`${id}-password`}><span>{p.t('当前密码')}</span><input id={`${id}-password`} name="currentPassword" type="password" autoComplete="current-password" maxLength={72} value={password} required disabled={busy || disabled} aria-invalid={errorField === 'password' || undefined} aria-describedby={errorField === 'password' ? `${id}-error` : undefined} onChange={event => { setPassword(event.target.value); clearError(); }} /></label>}
            </div>
            {editor === 'phoneNumber' && <p className="lp-shell-view-meta">{p.t('请带上国家区号，例如中国大陆 +86。')}</p>}
            {error && <p id={`${id}-error`} className="lp-shell-view-error" role="alert">{p.t(error)}</p>}
            <div className="lp-account-profile-actions"><ActionButton type="submit" variant="primary" busy={busy} busyLabel={p.t('正在保存…')} disabled={disabled || unchanged || !normalized || (editor !== 'displayName' && !password)}>{p.t('保存修改')}</ActionButton><ActionButton disabled={busy || disabled} onClick={close}>{p.t('取消')}</ActionButton></div>
          </form>}
        </div>
      </div>)}
    </div>
    <div className="lp-account-profile-status" role="status">{saved && <><CheckCircle2 size={15} aria-hidden="true" /><span>{p.t(saved)}</span></>}</div>
  </section>;
}
