import { useState } from 'react';
import { LogIn } from 'lucide-react';
import type { PcAuthStartInput, PcCapability, PcConnection } from '../api/contracts';
import { LinepoolApiError } from '../api/client';
import { workspaceApi as api } from '../api/query-client';
import { apiErrorMessages, apiFailureMessage } from '../i18n/api-errors';
import { apiMessage } from '../workspace-reference/workspace-data';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { ActionButton, DateText, Facts } from '../admin/primitives';

export const pcCapabilityLabels: Record<PcCapability, string> = { SMS_CODE: '短信验证码', NUMBER_LEASE: '号码租用', SEND_SMS: '发送短信' };
const statusLabels: Record<PcConnection['status'], string> = {
  ACTIVE: '连接正常', UNAUTHORIZED: '尚未授权', REFRESHING: '正在续期', UNKNOWN: '授权结果待核对', REAUTH_REQUIRED: '需要重新授权',
};
export function pcError(cause: unknown) {
  if (cause instanceof LinepoolApiError && !apiErrorMessages[cause.code]) return `${cause.message} (${cause.code})`;
  return apiMessage(cause);
}
export function PcLoginButton({ purpose = 'AGENT_LOGIN', label = '使用 PinClode 登录', appearance = 'admin' }: { purpose?: PcAuthStartInput['purpose']; label?: string; appearance?: 'admin' | 'auth' }) {
  const p = useDisplayPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    if (busy) return;
    setBusy(true); setError('');
    try { window.location.assign((await api.pcAuthStart({ purpose })).data.authorizeUrl); }
    catch (cause) { setError(pcError(cause)); setBusy(false); }
  }
  return <div className="lp-pc-login">{appearance === 'auth' ? <button type="button" className="lp-pass-submit" disabled={busy} aria-busy={busy} onClick={() => void start()}><span>{p.t(busy ? '正在打开授权页面…' : label)}</span><LogIn size={17} /></button> : <ActionButton variant="accent" busy={busy} onClick={() => void start()}><LogIn size={16} />{p.t(busy ? '正在打开授权页面…' : label)}</ActionButton>}{error && <p className={appearance === 'auth' ? 'lp-auth-error' : 'lp-admin-error'} role="alert">{error}</p>}</div>;
}
export function PcAuthFailure({ code }: { code: string | null }) {
  const p = useDisplayPreferences();
  if (!code) return null;
  return <p className="lp-admin-error" role="alert">{p.t('PinClode 授权未完成：')}{apiFailureMessage(code, 400)}</p>;
}
export function PcConnectionStatus({ connection }: { connection: PcConnection }) {
  const p = useDisplayPreferences();
  return <span className="lp-admin-status lp-pc-status" data-tone={connection.status === 'ACTIVE' ? 'success' : connection.status === 'REFRESHING' ? 'info' : 'warning'}>{p.t(statusLabels[connection.status])}</span>;
}
export function PcConnectionFacts({ connection }: { connection: PcConnection }) {
  const p = useDisplayPreferences();
  return <><Facts rows={[
    [p.t('PC 账号'), connection.externalAccountId], [p.t('连接状态'), <PcConnectionStatus connection={connection} />],
    [p.t('访问授权到期'), <DateText value={connection.accessExpiresAt} />], [p.t('续期授权到期'), <DateText value={connection.refreshExpiresAt} />],
    [p.t('最近同步'), <DateText value={connection.lastSyncedAt} />], [p.t('下次轮询'), <DateText value={connection.nextPollAt} />],
  ]} />{connection.problem && <p className="lp-admin-warning" role="status">{connection.problem}</p>}</>;
}
