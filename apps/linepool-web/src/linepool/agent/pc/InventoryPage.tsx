import { useState } from 'react';
import { Download, RefreshCw, Smartphone } from 'lucide-react';
import type { PcNumber } from '../../api/contracts';
import { Card } from '../../ui/card';
import { ActionButton, DateText, Facts, Modal, Table, regionName } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { navigate } from '../../../app/router';
import { AgentPager } from '../subagent-shared';
import { exportCsv, Filter } from '../pages/shared';
import { pcCapabilityLabels } from '../pc-components';
import { canReceive, numberState, numberStateLabels, numberStates, NumberStateBadge, PcEmpty, PcTextLink, type NumberState, type PcPageProps } from './shared';

const isState = (value: string | null): value is NumberState => numberStates.some(state => state === value);

export default function InventoryPage({ session, connection, params, refetch, refreshing }: PcPageProps & { params: URLSearchParams; refetch: () => void; refreshing: boolean }) {
  const p = useDisplayPreferences();
  const initial = params.get('state');
  const [state, setState] = useState<NumberState | ''>(isState(initial) ? initial : '');
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<PcNumber | null>(null);
  const now = Date.now();
  const numbers = session.numbers;
  const regions = [...new Set(numbers.map(number => number.regionId))].sort();
  const query = search.trim();
  const rows = numbers.filter(number => (!state || numberState(number, now) === state) && (!region || number.regionId === region) && (!query || number.phoneNumber.includes(query)));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);
  const filtered = Boolean(state || region || query);
  function update(change: () => void) { change(); setPage(1); }
  function capabilityText(number: PcNumber) {
    return number.capabilities.filter(capability => capability === 'SMS_CODE').map(capability => p.t(pcCapabilityLabels[capability])).join(' / ') || p.t('当前站点无可用能力');
  }
  function openMessages(number: PcNumber) { navigate(`/agent/messages?numberId=${encodeURIComponent(number.id)}`); }
  return <Card className="lp-admin-section lp-agent-page-card">
    <div className="lp-admin-toolbar lp-agent-inventory-toolbar">
      <Filter title={p.t('号码状态')}><select value={state} onChange={event => update(() => setState(isState(event.target.value) ? event.target.value : ''))}><option value="">{p.t('全部状态')}</option>{numberStates.map(key => <option key={key} value={key}>{p.t(numberStateLabels[key])}</option>)}</select></Filter>
      <Filter title={p.t('国家')}><select value={region} onChange={event => update(() => setRegion(event.target.value))}><option value="">{p.t('全部国家')}</option>{regions.map(value => <option key={value} value={value}>{regionName(value)}</option>)}</select></Filter>
      <span className="lp-agent-inventory-search"><Filter title={p.t('搜索号码')}><input value={search} maxLength={64} placeholder={p.t('例如 +1')} onChange={event => update(() => setSearch(event.target.value))} /></Filter></span>
      <div className="lp-agent-toolbar-actions">
        <ActionButton busy={refreshing} onClick={refetch}><RefreshCw size={15} />{p.t('刷新号码')}</ActionButton>
        <ActionButton disabled={!rows.length} onClick={() => exportCsv('agent-numbers.csv', [[p.t('号码'), p.t('国家'), p.t('号码状态'), p.t('能力'), p.t('资源到期')], ...rows.map(number => [number.phoneNumber, regionName(number.regionId), p.t(numberStateLabels[numberState(number, now)]), capabilityText(number), number.resourceExpiresAt ?? ''])])}><Download size={15} />{p.t('导出号码')}</ActionButton>
      </div>
    </div>
    <p className="lp-admin-context lp-agent-page-context">{p.t('号码来自你自己的 PC 连接。')}{p.t('共')} {p.n(numbers.length)} {p.t('个号码')}{filtered && ` · ${p.t('筛选后')} ${p.n(rows.length)}`}</p>
    {visible.length ? <div className="lp-agent-inventory-table"><Table label="PC 连接号码" columns={[p.t('号码'), p.t('国家'), p.t('号码状态'), p.t('能力'), p.t('资源到期'), '']}>{visible.map(number => <tr key={number.id}>
      <td><strong>{number.phoneNumber}</strong></td><td>{regionName(number.regionId)}</td><td><NumberStateBadge state={numberState(number, now)} /></td><td>{capabilityText(number)}</td><td><DateText value={number.resourceExpiresAt} /></td>
      <td><div className="lp-agent-row-actions"><ActionButton size="sm" onClick={() => setDetail(number)}>{p.t('详情')}</ActionButton><ActionButton size="sm" onClick={() => openMessages(number)}>{p.t('查看短信')}</ActionButton></div></td>
    </tr>)}</Table></div>
      : <PcEmpty icon={Smartphone} title={numbers.length ? '没有匹配的号码' : '暂无号码库存'} action={numbers.length ? <ActionButton size="sm" onClick={() => update(() => { setState(''); setRegion(''); setSearch(''); })}>{p.t('清除筛选')}</ActionButton> : <PcTextLink href="/agent/connection">{p.t('查看连接状态')}</PcTextLink>}>
        {p.t(numbers.length ? '请调整筛选条件或搜索其他号码。' : connection.lastSyncedAt ? '当前 PC 连接尚无已同步号码。' : 'PC 授权已建立，等待首次号码同步。')}
      </PcEmpty>}
    {rows.length > 0 && <AgentPager page={current} pageSize={pageSize} totalItems={rows.length} totalPages={totalPages} busy={false} onChange={(next, size) => { setPage(next); setPageSize(size); }} />}
    {detail && <Modal title={p.t('号码详情')} onClose={() => setDetail(null)} variant="drawer"><div className="lp-admin-dialog-body"><Facts rows={[
      [p.t('号码'), detail.phoneNumber], [p.t('国家'), regionName(detail.regionId)], [p.t('号码状态'), <NumberStateBadge state={numberState(detail, now)} />],
      [p.t('能力'), capabilityText(detail)], [p.t('资源到期'), <DateText value={detail.resourceExpiresAt} />], [p.t('PC 账号'), connection.externalAccountId],
      [p.t('可等待新验证码'), p.t(canReceive(detail, connection, now) ? '是' : '否')],
    ]} /><div className="lp-agent-drawer-actions"><ActionButton variant="accent" onClick={() => openMessages(detail)}>{p.t('查看该号码短信')}</ActionButton></div></div></Modal>}
  </Card>;
}
