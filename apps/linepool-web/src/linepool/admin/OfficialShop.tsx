import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { queryClient, workspaceApi as api } from '../api/query-client';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import SelectField from '../SelectField';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { apiMessage } from '../workspace-reference/workspace-data';
import { ActionButton, DateText, Facts, State } from './primitives';
import './official-shop.css';

/**
 * Unified agent model: every PinClode account is an agent; the official storefront sells the numbers of the agent
 * an administrator designates here. Changing it suspends the previous official shop and keeps it as history.
 */
export default function OfficialShop({ revision }: { revision: number }) {
  const p = useDisplayPreferences();
  const shops = useQuery({ queryKey: ['admin-shops', revision], queryFn: async ({ signal }) => (await api.adminShops({ signal })).data, staleTime: 0 }, queryClient);
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const official = shops.data?.official ?? null;
  const candidates = shops.data?.candidates.filter(agent => agent.agentId !== official?.agentId) ?? [];
  async function designate() {
    if (busy || !agentId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.adminSetOfficialShop({ agentId, reason });
      setNotice(p.t(result.data.changed ? '官方店铺已更新，号码库存会在下次同步后刷新。' : '该代理已经是官方店铺。'));
      setAgentId(''); setReason('');
      await shops.refetch();
    } catch (cause) { setError(apiMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Card className="lp-admin-section lp-admin-official-shop">
    <div className="lp-admin-section-heading"><h2><Store size={18} aria-hidden="true" /> {p.t('官方店铺')}</h2></div>
    <div className="lp-admin-official-shop-body">
      <p className="lp-admin-context">{p.t('所有 PC 账号都以代理身份登录。前台销售的是“官方店铺”所指定代理的号码；更换后旧店铺停用并保留记录。')}</p>
      <State loading={shops.isPending} error={shops.error ? apiMessage(shops.error) : ''} data={shops.data} retry={() => void shops.refetch()} />
      {shops.data && (official ? <Facts rows={[
        [p.t('当前代理'), `${official.displayName} · PC ${official.externalAccountId}`],
        [p.t('可售库存格子'), p.n(official.availableSlots)],
        [p.t('指定时间'), <DateText value={official.createdAt} />],
      ]} /> : <p className="lp-admin-warning" role="status">{p.t('尚未指定官方店铺，前台暂无可售号码。')}</p>)}
      {shops.data && <form className="lp-admin-official-shop-form" onSubmit={event => { event.preventDefault(); void designate(); }}><fieldset disabled={busy}>
        <label>{p.t(official ? '更换为代理' : '指定代理')}<SelectField aria-label={p.t('选择代理')} value={agentId} onValueChange={setAgentId}
          options={[{ value: '', label: p.t(candidates.length ? '请选择已登录过的代理' : '暂无其他代理，请先让对方在代理入口登录') },
            ...candidates.map(agent => ({ value: agent.agentId, label: `${agent.displayName} · PC ${agent.externalAccountId} · ${p.n(agent.numbers)} ${p.t('个号码')}${agent.role === 'ADMIN' ? ` · ${p.t('管理员')}` : ''}` }))]} /></label>
        <label>{p.t('操作原因')}<Input required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <ActionButton type="submit" variant="accent" busy={busy} disabled={!agentId || reason.trim().length < 3}>{p.t(official ? '更换官方店铺' : '指定为官方店铺')}</ActionButton>
      </fieldset></form>}
      {error && <p className="lp-admin-error" role="alert">{error}</p>}
      {notice && <p className="lp-pc-notice" role="status">{notice}</p>}
    </div>
  </Card>;
}
