import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { PcConnection } from '../api/contracts';
import { workspaceApi as api } from '../api/query-client';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { useAdminActivity } from './Presentation';
import { ActionButton, DateText, State, Table } from './primitives';
import { PcConnectionStatus, PcLoginButton, pcCapabilityLabels, pcError } from '../agent/pc-components';
import '../agent/pc.css';
import OfficialShop from './OfficialShop';

export default function PcConnections({ revision }: { revision: number }) {
  const p = useDisplayPreferences();
  const { begin } = useAdminActivity();
  const [connections, setConnections] = useState<PcConnection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [polling, setPolling] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const finish = begin();
    setLoading(true); setError('');
    void api.adminPcConnections({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setConnections(result.data);
    }).catch(cause => { if (!controller.signal.aborted) setError(pcError(cause)); })
      .finally(() => { finish(); if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); finish(); };
  }, [revision, refresh, begin]);
  async function poll(id: string) {
    if (polling) return;
    setPolling(id); setActionError(''); setNotice('');
    const finish = begin();
    try {
      const result = await api.adminPcPoll(id);
      setNotice(p.t(result.data.requested ? '轮询请求已登记，等待后台同步。' : '本次未登记轮询请求，请刷新连接状态。'));
      setRefresh(value => value + 1);
    } catch (cause) { setActionError(pcError(cause)); }
    finally { finish(); setPolling(''); }
  }
  // Unified agent model: PC accounts join as agents; the legacy self-service button stays only where such a connection exists (Mock).
  const legacySelfService = connections?.some(connection => connection.ownerKind === 'SELF_SERVICE');
  return <><OfficialShop revision={revision + refresh} /><div className="lp-admin-section-heading"><p className="lp-admin-context">{p.t('查看本站代理连接。号码和短信由后台轮询同步。')}</p>{legacySelfService && <PcLoginButton purpose="SELF_SERVICE" label="授权 / 更新自营连接" />}</div>
    {actionError && <p className="lp-admin-error lp-pc-inline" role="alert">{actionError}</p>}{notice && <p className="lp-pc-notice lp-pc-inline" role="status">{notice}</p>}
    <State loading={loading} error={error} data={connections} retry={() => setRefresh(value => value + 1)} empty={connections?.length === 0} />
    {Boolean(connections?.length) && <Table label="本站 PC 连接" columns={[p.t('所属主体'), p.t('PC 账号 / 连接'), p.t('授权状态'), p.t('启用能力'), p.t('授权期限'), p.t('同步状态'), '']}>{connections!.map(connection => <tr key={connection.id}><td><strong>{p.t(connection.ownerKind === 'SELF_SERVICE' ? '本站自营' : '代理')}</strong>{connection.agentId && <small>{connection.agentId}</small>}</td><td><strong>{connection.externalAccountId}</strong><small>{connection.id}</small></td><td><PcConnectionStatus connection={connection} />{connection.problem && <small role="status">{connection.problem}</small>}</td><td>{connection.enabledCapabilities.map(capability => p.t(pcCapabilityLabels[capability])).join(' / ') || p.t('未启用')}</td><td><small>{p.t('访问授权')}</small><DateText value={connection.accessExpiresAt} /><small>{p.t('续期授权')}</small><DateText value={connection.refreshExpiresAt} /></td><td><small>{p.t('最近同步')}</small><DateText value={connection.lastSyncedAt} /><small>{p.t('下次轮询')}</small><DateText value={connection.nextPollAt} /></td><td><ActionButton size="sm" disabled={Boolean(polling)} busy={polling === connection.id} onClick={() => void poll(connection.id)}><RefreshCw size={15} />{p.t('请求同步')}</ActionButton></td></tr>)}</Table>}
  </>;
}
