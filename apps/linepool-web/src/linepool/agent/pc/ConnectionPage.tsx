import { useState } from 'react';
import { Cable } from 'lucide-react';
import type { PcSession } from '../../api/contracts';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { PcConnectionFacts, PcLoginButton, pcCapabilityLabels, pcError } from '../pc-components';
import { canReceive, PcFeedback, pcSessionKey, type PcPageProps } from './shared';

export default function ConnectionPage({ user, session, connection }: PcPageProps) {
  const p = useDisplayPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const now = Date.now();
  const smsSupported = connection.capabilities.includes('SMS_CODE');
  async function changeCapabilities(enabled: boolean) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.pcConnection(enabled ? ['SMS_CODE'] : []);
      queryClient.setQueryData<PcSession>(pcSessionKey(user.id), previous => previous ? { ...previous, connection: result.data } : previous);
      setNotice(p.t('能力设置已保存'));
    } catch (cause) { setError(pcError(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <PcFeedback error={error} notice={notice} />
    <div className="lp-agent-account-summary">
      <div><span>{p.t('PC 账号')}</span><strong>{connection.externalAccountId}</strong></div>
      <div><span>{p.t('已同步号码')}</span><strong>{p.n(session.numbers.length)}</strong></div>
      <div><span>{p.t('可取码号码')}</span><strong>{p.n(session.numbers.filter(number => canReceive(number, connection, now)).length)}</strong></div>
    </div>
    <div className="lp-agent-overview-grid">
      <Card id="pc-connection" className="lp-admin-section lp-pc-panel lp-agent-overview-panel"><div className="lp-pc-section-head"><h2><Cable size={19} />{p.t('授权与同步')}</h2><PcLoginButton purpose="REAUTHORIZE" label="重新授权 PinClode" /></div>
        <PcConnectionFacts connection={connection} />
      </Card>
      <Card className="lp-admin-section lp-pc-panel lp-agent-overview-panel"><div className="lp-pc-section-head"><h2>{p.t('连接能力')}</h2></div>
        <div className="lp-pc-capabilities lp-agent-capabilities">
          <label className="lp-admin-checkbox"><Checkbox checked={connection.enabledCapabilities.includes('SMS_CODE')} disabled={busy || !smsSupported} onCheckedChange={checked => void changeCapabilities(checked === true)} />{p.t('启用短信验证码')}</label>
          <p className="lp-admin-context">{p.t(smsSupported ? '关闭后停止新增取码操作，保留本地历史。' : '当前 PC 连接不支持短信验证码。')}</p>
          <dl className="lp-agent-overview-facts"><div><dt>{p.t('PC 授权的能力')}</dt><dd>{connection.capabilities.map(capability => p.t(pcCapabilityLabels[capability])).join(' / ') || p.t('无')}</dd></div><div><dt>{p.t('本站已启用')}</dt><dd>{connection.enabledCapabilities.filter(capability => capability === 'SMS_CODE').map(capability => p.t(pcCapabilityLabels[capability])).join(' / ') || p.t('未启用')}</dd></div></dl>
        </div>
      </Card>
    </div>
  </>;
}
