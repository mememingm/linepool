import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { Cable, MessageSquare, Settings2, Smartphone } from 'lucide-react';
import type { PcMessage } from '../../api/contracts';
import { Card } from '../../ui/card';
import { DateText, State } from '../../admin/primitives';
import { CopyValue } from '../../business';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { AgentChartPanel, type MetricPeriod } from '../legacy-shared';
import { PcConnectionStatus, pcCapabilityLabels, pcError } from '../pc-components';
import { canReceive, numberState, numberStateLabels, numberStates, PcBars, PcEmpty, PcMetricCards, PcTextLink, usePcMessages, type PcPageProps } from './shared';

const STATS_SAMPLE = 100;
const pad = (value: number) => String(value).padStart(2, '0');
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Buckets the newest messages by local hour (today) or day; returns whether the sample covers the whole window. */
function codeVolume(messages: PcMessage[], total: number, period: MetricPeriod, now: Date) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period !== 'today') start.setDate(start.getDate() - (period === '7d' ? 6 : 29));
  const buckets: { key: string; label: string; value: number }[] = [];
  if (period === 'today') for (let hour = 0; hour <= now.getHours(); hour++) buckets.push({ key: String(hour), label: `${pad(hour)}:00`, value: 0 });
  else for (const day = new Date(start); day <= now; day.setDate(day.getDate() + 1)) buckets.push({ key: dayKey(day), label: `${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, value: 0 });
  for (const message of messages) {
    const received = new Date(message.receivedAt);
    if (received < start || received > now) continue;
    const bucket = buckets.find(item => item.key === (period === 'today' ? String(received.getHours()) : dayKey(received)));
    if (bucket) bucket.value++;
  }
  const oldest = messages.at(-1);
  const complete = messages.length >= total || Boolean(oldest && new Date(oldest.receivedAt) < start);
  return { buckets, complete, count: buckets.reduce((sum, bucket) => sum + bucket.value, 0) };
}

export default function OverviewPage({ user, session, connection }: PcPageProps) {
  const p = useDisplayPreferences();
  const [period, setPeriod] = useState<MetricPeriod>('7d');
  const messages = usePcMessages(user.id, connection.id, { page: 1, pageSize: STATS_SAMPLE });
  const shop = useQuery({ queryKey: ['pc-shop', user.id], queryFn: async ({ signal }) => (await api.pcShop({ signal })).data, staleTime: 30_000 }, queryClient);
  const now = Date.now();
  const numbers = session.numbers;
  const receivable = numbers.filter(number => canReceive(number, connection, now)).length;
  const volume = messages.data ? codeVolume(messages.data.data, messages.data.pagination.totalItems, period, new Date(now)) : null;
  const states = numberStates.map(state => ({ key: state, label: p.t(numberStateLabels[state]), value: numbers.filter(number => numberState(number, now) === state).length, tone: state === 'AVAILABLE' ? 'success' : state === 'TERM_PENDING' ? 'info' : 'warning' })).filter(row => row.value > 0);
  const recent = messages.data?.data.slice(0, 5) ?? [];
  return <>
    <PcMetricCards metrics={[
      { label: '已同步号码', value: numbers.length, href: '/agent/inventory', icon: Smartphone },
      { label: '可取码号码', value: receivable, href: '/agent/inventory?state=AVAILABLE', icon: Cable, note: connection.enabledCapabilities.includes('SMS_CODE') ? undefined : '短信验证码能力未启用' },
      { label: '在售商品', value: shop.data?.products.filter(product => product.isActive && !product.adminHold).length, href: '/agent/products', icon: Settings2, note: shop.data && !shop.data.shop ? '尚未开店' : undefined },
      { label: '收到的短信', value: messages.data?.pagination.totalItems, href: '/agent/messages', icon: MessageSquare },
    ]} />
    {!connection.lastSyncedAt && <p className="lp-admin-warning" role="status">{p.t('PC 授权已建立，号码和短信尚未完成首次同步。')}</p>}
    <div className="lp-agent-chart-grid">
      <AgentChartPanel title={p.t('近期接码数量')} description={p.t('按短信接收时间统计，使用本机时区。')} period={period} onPeriodChange={setPeriod}>
        {messages.error ? <State loading={false} error={pcError(messages.error)} retry={() => void messages.refetch()} /> : volume ? <>
          <PcBars label="近期接码数量" empty="该时间段内没有收到短信" rows={volume.buckets} />
          <p className="lp-admin-context lp-agent-chart-note">{p.t('本时间段共')} {p.n(volume.count)} {p.t('条')}{!volume.complete && ` · ${p.t('仅统计最近 100 条短信，实际数量可能更多')}`}</p>
        </> : <State loading error="" retry={() => void messages.refetch()} />}
      </AgentChartPanel>
      <AgentChartPanel title={p.t('号码状态分布')} description={p.t('按 PC 连接返回的号码能力与资源期限划分。')}>
        <PcBars label="号码状态分布" empty="暂无已同步号码" rows={states} />
      </AgentChartPanel>
    </div>
    <div className="lp-agent-overview-grid">
      <Card className="lp-admin-section lp-agent-overview-panel"><div className="lp-admin-section-heading"><h2>{p.t('我的代理账号')}</h2><PcConnectionStatus connection={connection} /></div><div className="lp-agent-overview-body">
        <strong className="lp-agent-account-name">{user.displayName}</strong><p className="lp-admin-context">{p.t('PC 账号')} · {connection.externalAccountId}</p>
        {session.officialShop && <p className="lp-agent-official-shop" role="status"><span className="lp-admin-status lp-pc-status" data-tone="success">{p.t('官方店铺')}</span>{p.t('你的号码正在本站前台销售。')}</p>}
        <dl className="lp-agent-overview-facts"><div><dt>{p.t('最近同步')}</dt><dd><DateText value={connection.lastSyncedAt} /></dd></div><div><dt>{p.t('启用能力')}</dt><dd>{connection.enabledCapabilities.filter(capability => capability === 'SMS_CODE').map(capability => p.t(pcCapabilityLabels[capability])).join(' / ') || p.t('未启用')}</dd></div></dl>
        <PcTextLink href="/agent/connection">{p.t('管理 PC 连接')}</PcTextLink>
      </div></Card>
      <Card className="lp-admin-section lp-agent-overview-panel"><div className="lp-admin-section-heading"><h2>{p.t('常用操作')}</h2></div><div className="lp-agent-shortcuts">{[
        { path: '/agent/inventory', title: '号码库存', description: '管理自己 PC 连接中的号码，查看资源状态并进入取码。', icon: Smartphone },
        { path: '/agent/messages', title: '验证码与短信', description: '查看自己号码收到的短信，等待并复制验证码。', icon: MessageSquare },
        { path: '/agent/products', title: '店铺商品', description: '管理自己店铺在前台出售的商品和积分价格。', icon: Settings2 },
      ].map(item => <a href={item.path} key={item.path}><item.icon size={20} aria-hidden="true" /><span><strong>{p.t(item.title)}</strong><small>{p.t(item.description)}</small></span></a>)}</div></Card>
    </div>
    <Card className="lp-admin-section"><div className="lp-admin-section-heading"><h2>{p.t('最近收到的短信')}</h2><PcTextLink href="/agent/messages">{p.t('查看全部')}</PcTextLink></div>
      {messages.isPending && <State loading error="" retry={() => void messages.refetch()} />}
      {messages.data && (recent.length ? <ul className="lp-agent-recent-messages">{recent.map(message => <li key={message.id}><div><strong>{message.phoneNumber}</strong><span>{message.sender}</span><DateText value={message.receivedAt} /></div><p>{message.body}</p>{message.verificationCode && <CopyValue inline value={message.verificationCode} label={p.t('复制验证码')} />}</li>)}</ul>
        : <PcEmpty icon={MessageSquare} title="暂无短信记录" action={<PcTextLink href="/agent/messages">{p.t('进入验证码与短信')}</PcTextLink>}>{p.t('同步到本连接的短信会显示在这里。')}</PcEmpty>)}
    </Card>
  </>;
}
