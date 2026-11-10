import { ArrowUpRight, Network } from 'lucide-react';
import { Card } from '../../ui/card';
import { DateText, Table } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { agentHref, subagentHref } from '../navigation';
import type { AgentDashboardData } from './types';

/** §5.1-5 下级代理经营概览. Partner agents only; rows are direct subagents' aggregates. */
export function AgentSettlementTable({ data }: { data?: AgentDashboardData }) {
  const p = useDisplayPreferences();
  const rows = data?.subagents ?? [];
  const currency = data?.currency ?? 'USD';
  const amount = (minor: number | null) => minor == null ? '—' : `${(minor / 100).toFixed(2)} ${currency}`;
  const profit = (minor: number | null) => data?.costStatus === 'SYNCED' && minor != null ? amount(minor) : '—';
  return <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>下级代理经营概览</h2><a href={agentHref('agents')}>全部下级 <ArrowUpRight size={14} /></a></div>
    {rows.length ? <Table columns={['下级代理', '我向下级销售额', '接码量', '当前库存', '我的毛利', '最近活跃']} label="下级代理经营概览">{rows.map(row => <tr key={row.agentId}>
      <td><a href={subagentHref(row.agentId)}>{row.name}</a></td><td className="lp-admin-numeric">{amount(row.salesMinor)}</td>
      <td className="lp-admin-numeric">{p.n(row.codeCount)}</td><td className="lp-admin-numeric">{p.n(row.inventoryCount)}</td>
      <td className="lp-admin-numeric">{profit(row.profitMinor)}</td><td><DateText value={row.lastActiveAt} /></td>
    </tr>)}</Table> : <div className="lp-admin-state"><Network size={24} /><p>暂无直属下级经营数据</p></div>}
  </Card>;
}
