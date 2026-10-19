import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import gsap from 'gsap';
import UserAvatar from '../UserAvatar';
import SelectField from '../SelectField';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, ChevronsDown, ChevronsUp, Ellipsis, Inbox, MessageSquare, RefreshCw, Search, ShieldCheck, ShoppingBag, Smartphone, Star, Timer, X } from 'lucide-react';
import { Button } from '../../vendor/beautiful/src/components/atoms/Button';
import { ProgressRing } from '../../vendor/beautiful/src/components/atoms/ProgressRing';
import { CopyValue } from '../business';
import { balance as demoBalance, messages as demoMessages, numbers as demoNumbers, orders as demoOrders } from './shared';
import { apiMessage } from '../workspace-reference/workspace-data';
import type { ReferenceData, ReferenceMessage } from '../workspace-reference/reference-data';
import { shellHref } from '../workspace-reference/navigation';
import './Reference.css';
import './DashboardOverview.css';

const serviceAssets: Record<string, string> = {
  Telegram: new URL('./assets/telegram.svg', import.meta.url).href,
  WhatsApp: new URL('./assets/whatsapp.svg', import.meta.url).href,
  Google: new URL('./assets/google.png', import.meta.url).href,
};
const demoInbox = [demoMessages[0], demoMessages[4], demoMessages[6], demoMessages[2]];
// Local fixtures drive both the drawn curves and the selected values, not live records.
const monthTrends: Record<string, { weeks: number[]; days: number[] }> = {
  '08': { weeks: [8, 9, 11, 10], days: [1, 1, 2, 1, 2, 1, 2] },
  '09': { weeks: [10, 11, 14, 12], days: [1, 2, 2, 1, 2, 2, 2] },
  '10': { weeks: [9, 12, 19, 16], days: [1, 2, 2, 3, 1, 2, 3] },
  '11': { weeks: [0, 0, 0, 0], days: [0, 0, 0, 0, 0, 0, 0] },
};
const demoMonths = ['08', '09', '10', '11'];
type ReferenceLinks = Partial<Record<'dashboard' | 'purchase' | 'numbers' | 'inbox' | 'orders' | 'services', string>>;
const originalCurves = {
  muted: 'M0 119 C32 127 30 86 60 88 S91 126 126 127 S156 139 182 155 S209 116 249 95 S305 66 339 73 S387 86 413 117 S452 131 488 140 S528 137 561 121 S625 110 670 118',
  blue: 'M0 120 C25 112 42 132 64 134 S89 103 115 103 S149 110 164 92 C186 98 199 144 218 154 S247 120 257 94 S278 75 306 74 S340 66 365 60 S407 65 432 96 S472 133 511 137 S580 112 615 113 S649 121 670 122',
  coral: 'M0 120 C24 108 40 118 65 129 S100 104 120 100 S153 103 169 90 S196 41 218 56 S251 91 263 135 S287 165 323 172 S370 182 389 187 S419 190 441 153 S478 102 515 89 S568 65 602 79 S648 106 670 147',
};
const chartPointsByRange = {
  weeks: [{ x: 120, y: 103 }, { x: 339, y: 73 }, { x: 488, y: 140 }, { x: 615, y: 113 }],
  days: [{ x: 60, y: 88 }, { x: 164, y: 92 }, { x: 257, y: 94 }, { x: 365, y: 60 }, { x: 432, y: 96 }, { x: 561, y: 121 }, { x: 615, y: 113 }],
};

function smoothCurve(points: { x: number; y: number }[]) {
  if (!points.length) return '';
  return points.reduce((path, point, index) => {
    if (!index) return `M${point.x} ${point.y}`;
    const previous = points[index - 1];
    const beforePrevious = points[index - 2] ?? previous;
    const next = points[index + 1] ?? point;
    const controlOneX = previous.x + (point.x - beforePrevious.x) / 6;
    const lowY = Math.min(previous.y, point.y);
    const highY = Math.max(previous.y, point.y);
    const controlOneY = Math.max(lowY, Math.min(highY, previous.y + (point.y - beforePrevious.y) / 6));
    const controlTwoX = point.x - (next.x - previous.x) / 6;
    const controlTwoY = Math.max(lowY, Math.min(highY, point.y - (next.y - previous.y) / 6));
    return `${path} C${controlOneX} ${controlOneY} ${controlTwoX} ${controlTwoY} ${point.x} ${point.y}`;
  }, '');
}

function RoundButton({ label, children, onClick, href, disabled = false }: { label: string; children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean }) {
  if (href) return <a className="lp-ref-round" aria-label={label} title={label} href={href}>{children}</a>;
  return <button type="button" className="lp-ref-round" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function ServiceLogo({ service }: { service: string }) {
  return serviceAssets[service] ? <img className="lp-ref-service-logo" src={serviceAssets[service]} alt="" width="20" height="20" /> : <span className="lp-ref-service-placeholder" aria-hidden="true">{service.slice(0, 1)}</span>;
}

export default function ReferenceWorkspace({ links = {}, messageHref, numberHref, data, refreshing = false, onRefresh, onMarkRead, showSearch = true, enhancedMotion = false }: {
  links?: ReferenceLinks; messageHref?: (message: ReferenceMessage) => string; numberHref?: (numberId: string) => string;
  data?: ReferenceData; refreshing?: boolean; showSearch?: boolean; enhancedMotion?: boolean;
  onRefresh?: () => Promise<boolean>; onMarkRead?: (ids: string[]) => Promise<unknown>;
} = {}) {
  const p = useDisplayPreferences();
  const chartFillId = useId().replace(/:/g, '');
  const numbers = data?.numbers ?? demoNumbers;
  const messages = data?.messages ?? demoMessages;
  const inbox = data ? messages.slice(0, 4) : demoInbox;
  const months = data?.months ?? demoMonths;
  const balance = data?.balance ?? demoBalance;
  const name = data?.userName ?? '林晓';
  const services = data?.services ?? ['Google', 'Telegram', 'WhatsApp'];
  const destinations = { dashboard: shellHref('dashboard'), purchase: shellHref('purchase'), numbers: shellHref('numbers'), inbox: shellHref('inbox'), orders: shellHref('orders'), services: shellHref('regions'), ...links };
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState(data?.currentMonth ?? '10');
  const [range, setRange] = useState('30');
  const [chartIndex, setChartIndex] = useState(1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [series, setSeries] = useState({ messages: true, numbers: true });
  const [selected, setSelected] = useState<ReferenceMessage | null>(null);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');
  const [readingMessage, setReadingMessage] = useState(false);
  const readLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const dotPositioned = useRef(false);
  const profile = useRef<HTMLElement>(null);
  const filteredInbox = showSearch ? inbox.filter(message => `${message.sender} ${message.code} ${numbers.find(number => number.id === message.numberId)?.phone}`.toLowerCase().includes(query.toLowerCase())) : inbox;
  const activeNumbers = numbers.filter(number => number.status === 'ACTIVE' && (!showSearch || `${number.country} ${p.t(number.country)} ${number.phone} ${number.service}`.toLowerCase().includes(query.toLowerCase())));
  const activeNumbersPreview = [...activeNumbers].sort((left, right) => left.remaining - right.remaining).slice(0, 3);
  const activeCount = numbers.filter(number => number.status === 'ACTIVE').length;
  const activeRate = numbers.length ? Math.round(activeCount / numbers.length * 100) : 0;
  const selectedNumber = numbers.find(number => number.id === selected?.numberId);
  const liveTrend = data?.trends[month] ?? (data ? data.trends[data.currentMonth] : undefined);
  const periods = liveTrend ? (range === '7' ? liveTrend.days : liveTrend.weeks) : (range === '7' ? monthTrends[month].days : monthTrends[month].weeks).map((value, index) => ({
    label: p.t(range === "7" ? "第 {count} 天" : "第 {count} 周", { count: p.n(index + 1) }), messages: value,
    numbers: month === '11' ? 0 : (range === '7' ? [4, 4, 5, 5, 4, 5, 5] : [3, 4, 5, 5])[index],
  }));
  const chartTotal = periods.reduce((total, value) => total + value.messages, 0);
  const chartInteractive = Boolean(data) || chartTotal > 0;
  const maximumValue = Math.max(1, ...periods.flatMap(period => [period.messages, period.numbers]));
  const tickCount = Math.min(4, maximumValue);
  const tickStep = Math.ceil(maximumValue / tickCount);
  const maximum = data ? tickStep * tickCount : maximumValue;
  const quantityTicks = Array.from({ length: tickCount + 1 }, (_, index) => index * tickStep);
  const pointY = (value: number) => 210 - value / maximum * 170;
  const dataPoints = {
    messages: periods.map((period, index) => ({ x: 20 + index / Math.max(1, periods.length - 1) * 630, y: pointY(period.messages) })),
    numbers: periods.map((period, index) => ({ x: 20 + index / Math.max(1, periods.length - 1) * 630, y: pointY(period.numbers) })),
  };
  const chartPoints = data ? dataPoints[series.numbers ? 'numbers' : 'messages'] : range === '7' ? chartPointsByRange.days : chartPointsByRange.weeks;
  const curve = (key: 'messages' | 'numbers') => data ? smoothCurve(dataPoints[key]) : '';
  const monthText = p.locale === "zh-CN" ? (data ? `${month.split("-")[0]} 年 ${Number(month.split("-")[1])} 月` : `${month} 月`) : p.month(month);
  const currentIndex = Math.min(chartIndex, periods.length - 1);
  const previewIndex = hoveredIndex ?? currentIndex;
  const period = periods[previewIndex];
  const currentPeriod = periods[currentIndex];
  const previewPoint = chartPoints[previewIndex];
  const tooltipPosition = previewPoint.x / 670 * 100;
  const currentValueText = [
    series.messages ? p.t("{count} 条短信", { count: p.n(currentPeriod.messages) }) : '',
    series.numbers ? p.t("{count} 个使用中号码", { count: p.n(currentPeriod.numbers) }) : '',
  ].filter(Boolean).join(p.locale === "en-US" ? ", " : "，") || p.t("未显示趋势");

  useLayoutEffect(() => {
    const dot = dotRef.current;
    if (!enhancedMotion || !dot || !chartTotal) { dotPositioned.current = false; return; }
    const animate = dotPositioned.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dotPositioned.current = true;
    const tween = gsap.to(dot, { attr: { cx: previewPoint.x, cy: previewPoint.y }, duration: animate ? 0.24 : 0, ease: 'power3.out', overwrite: true });
    return () => { tween.kill(); };
  }, [enhancedMotion, previewPoint.x, previewPoint.y, chartTotal > 0]);

  useEffect(() => {
    const title = document.title;
    window.scrollTo(0, 0);
    return () => { document.title = title; };
  }, []);
  useEffect(() => { document.title = `LINEPOOL · ${p.t("个人工作台")}`; }, [p.locale]);
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function openMessage(message: ReferenceMessage) {
    setSelected(message); setOperationError('');
    if (!data) { setReadIds(previous => [...new Set([...previous, message.id])]); return; }
    if (!message.unread || !onMarkRead || readLock.current) return;
    readLock.current = true; setReadingMessage(true);
    try { await onMarkRead([message.id]); }
    catch (error) { setOperationError(apiMessage(error)); }
    finally { readLock.current = false; setReadingMessage(false); }
  }
  function selectMonth(value: string) {
    setMonth(value); setChartIndex(range === '7' ? 6 : 1); setHoveredIndex(null);
  }
  function moveMonth(direction: number) {
    const next = Math.max(0, Math.min(months.length - 1, months.indexOf(month) + direction));
    selectMonth(months[next]);
  }
  function selectRange(value: string) {
    setRange(value); setChartIndex(value === '7' ? 6 : 1); setHoveredIndex(null);
  }
  async function resetView() {
    if (data) {
      setOperationError('');
      try { if (await onRefresh?.()) setNotice('数据已刷新'); }
      catch (error) { setOperationError(apiMessage(error)); }
      return;
    }
    setQuery(''); selectMonth('10'); selectRange('30'); setSeries({ messages: true, numbers: true });
    setNotice('演示视图已重置');
  }
  function pointIndex(clientX: number, plot: HTMLDivElement) {
    const bounds = plot.getBoundingClientRect();
    const position = bounds.width ? (clientX - bounds.left) / bounds.width * 670 : chartPoints[0].x;
    return chartPoints.reduce((closest, point, index) => Math.abs(point.x - position) < Math.abs(chartPoints[closest].x - position) ? index : closest, 0);
  }
  function selectPoint(index: number) {
    setChartIndex(Math.max(0, Math.min(periods.length - 1, index))); setHoveredIndex(null);
  }
  function chartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!chartInteractive) return;
    let next = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = periods.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') next = previewIndex;
    else return;
    event.preventDefault(); selectPoint(next);
  }

  return <main className={`lp-reference${data ? ' has-chart-axes is-overview' : ''}${enhancedMotion ? ' is-enhanced-motion' : ''}${showSearch ? '' : ' is-searchless'}`} lang={p.locale}>
    <section className="lp-ref-main">
      <header className="lp-ref-header">
        <a href={destinations.dashboard} className="lp-ref-brand" title={p.t("LINEPOOL 工作台")} aria-label={p.t("LINEPOOL 工作台")}><span /><span /><span /></a>
        <div className="lp-ref-welcome"><h1>{p.t("欢迎回来，{name}", { name })}</h1><p><strong>LINEPOOL</strong> · {p.t("个人工作台")} · {p.t(data ? "标准账户" : "演示账户")}</p></div>
        {showSearch && <label className="lp-ref-search"><Search size={17} strokeWidth={1.5} /><input aria-label={p.t("搜索号码或验证码")} placeholder={p.t("搜索")} value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" title={p.t("清空搜索")} aria-label={p.t("清空搜索")} onClick={() => setQuery('')}><X size={14} /></button>}</label>}
        {!data && <RoundButton label={p.t("购买号码")} href={destinations.purchase}><ShoppingBag size={19} strokeWidth={1.5} /></RoundButton>}
      </header>

      <div className="lp-ref-summary">
        {data ? <>
          <section className="lp-ref-profile lp-ref-account-overview" ref={profile} tabIndex={-1} aria-label={p.t("账户概览")}>
            <div className={`lp-ref-card-heading${refreshing ? ' is-refreshing' : ''}`}><h2>{p.t("账户概览")}</h2><RoundButton label={p.t("刷新数据")} onClick={() => void resetView()} disabled={refreshing}><RefreshCw size={17} strokeWidth={1.7} /></RoundButton></div>
            <div className="lp-ref-account-identity"><h3>{name}</h3><dl><div><dt>{p.t("账户类型")}</dt><dd>{p.t("标准账户")}</dd></div><div><dt>{p.t("账户状态")}</dt><dd className="lp-ref-account-status"><Check size={12} aria-hidden="true" />{p.t("账户正常")}</dd></div></dl></div>
            <div className="lp-ref-account-stats">
              {[{ href: destinations.numbers, label: p.t("号码"), title: p.t("我的号码"), count: numbers.length, icon: <Smartphone size={16} /> }, { href: destinations.inbox, label: p.t("短信"), title: p.t("短信收件箱"), count: messages.length, icon: <MessageSquare size={16} /> }, { href: destinations.orders, label: p.t("订单"), title: p.t("订单记录"), count: data.orderCount, icon: <ShoppingBag size={16} /> }].map(stat => <a key={stat.href} href={stat.href} aria-label={stat.title} title={stat.title}><span className="lp-ref-account-stat-icon" aria-hidden="true">{stat.icon}</span><strong>{p.n(stat.count)}</strong><span className="lp-ref-account-stat-label">{stat.label}<ArrowUpRight size={13} aria-hidden="true" /></span></a>)}
            </div>
          </section>
          <section className="lp-ref-quick-actions" aria-labelledby="lp-ref-quick-title">
            <h2 id="lp-ref-quick-title">{p.t("快捷操作")}</h2>
            <div className="lp-ref-quick-links"><a href={destinations.purchase} className="lp-ref-quick-buy"><ShoppingBag size={19} aria-hidden="true" /><span>{p.t("购买号码")}</span><ArrowUpRight size={16} aria-hidden="true" /></a><a href={destinations.inbox} className="lp-ref-quick-inbox"><MessageSquare size={19} aria-hidden="true" /><span>{p.t("查看短信")}</span><ArrowUpRight size={16} aria-hidden="true" /></a></div>
            <div className="lp-ref-quick-services"><a href={destinations.services} title={p.t("查看全部接码服务")}>{p.t("常用接码服务")}<ChevronRight size={13} aria-hidden="true" /></a><div className="lp-ref-service-stack">{services.map(service => <a key={service} href={destinations.services} title={service}><ServiceLogo service={service} /></a>)}</div></div>
          </section>
        </> : <section className="lp-ref-profile" ref={profile} tabIndex={-1} aria-label={p.t("我的账户")}>
          <div className={`lp-ref-card-heading${refreshing ? ' is-refreshing' : ''}`}><h2>{p.t("我的账户")}</h2><RoundButton label={data ? p.t("刷新数据") : p.t("重置演示视图")} onClick={() => void resetView()} disabled={refreshing}><RefreshCw size={19} strokeWidth={1.7} /></RoundButton></div>
          <div className="lp-ref-portrait"><ProgressRing size={data ? 80 : 100} progress={data ? activeRate / 100 : 0.25} tone="red"><UserAvatar name={name} size="preview" /></ProgressRing><span className="lp-ref-profile-star"><Star size={10} fill="currentColor" /></span></div>
          <h3>{name}</h3><p>{p.t("演示账户")}</p>
          <div className="lp-ref-profile-stats"><a href={destinations.numbers} title={p.t("我的号码")}><span><Smartphone size={14} aria-hidden="true" />{p.n(numbers.length)}</span><small>{p.t("号码")}</small></a><a href={destinations.inbox} title={p.t("短信收件箱")}><span><MessageSquare size={14} aria-hidden="true" />{p.n(messages.length)}</span><small>{p.t("短信")}</small></a><a href={destinations.orders} title={p.t("订单记录")}><span><ShoppingBag size={14} aria-hidden="true" />{p.n(demoOrders.length)}</span><small>{p.t("订单")}</small></a></div>
        </section>}
        <a className="lp-ref-metric lp-ref-metric-warm" href={destinations.numbers} aria-label={p.t("查看我的号码")}>
          <div><h2>{data ? p.t("号码可用率") : <>{p.t("号码")}<br />{p.t("可用率")}</>}</h2><span className="lp-ref-metric-icon"><Timer size={22} strokeWidth={1.7} /></span></div>
          <div className="lp-ref-metric-value"><strong>{p.n(activeRate)}%</strong><p>{p.t("{count} 个号码使用中", { count: p.n(activeCount) })}</p></div>
        </a>
        <a className="lp-ref-metric lp-ref-metric-cool" href={destinations.inbox} aria-label={p.t("查收验证码")}>
          <div><h2>{data ? p.t("本月收到短信") : <>{p.t("本月")}<br />{p.t("收到短信")}</>}</h2><span className="lp-ref-metric-icon"><ShieldCheck size={22} strokeWidth={1.5} /></span></div>
          <div className="lp-ref-metric-value"><strong>{p.n(liveTrend?.monthMessages ?? 56)}<span>{p.t("条")}</span></strong><p>{p.t("{month}收码记录", { month: monthText })}</p></div>
        </a>
        {!data && <section className="lp-ref-services" aria-label={p.t("常用服务")}><div><h2>{p.t("常用接码服务")}</h2><p>{p.t("{count} 个关联服务", { count: p.n(services.length) })}</p></div><div className="lp-ref-service-stack">{services.map(service => <a key={service} href={destinations.services} title={service}><ServiceLogo service={service} /></a>)}</div><RoundButton label={p.t("查看全部接码服务")} href={destinations.services}><Ellipsis size={20} /></RoundButton></section>}
      </div>

      <section className="lp-ref-analytics" aria-labelledby="lp-ref-chart-title">
        <header>
          <div><h2 id="lp-ref-chart-title">{p.t("收码趋势")}</h2><p>{liveTrend ? p.t("截至 {date} · 最近 {days} 天", { date: liveTrend.endDate, days: p.n(Number(range)) }) : p.t("号码与短信统计")}</p></div>
          <SelectField className="lp-ref-time-select" aria-label={p.t("时间范围")} prefix={p.t("时间范围")} align="end"
            value={range} onValueChange={selectRange} options={[{ value: '30', label: p.t("过去 30 天") }, { value: '7', label: p.t("过去 7 天") }]} />
        </header>
        <div className="lp-ref-chart-body">
          <nav className="lp-ref-months" aria-label={p.t("统计月份")}><RoundButton label={p.t("上一个月")} disabled={month === months[0]} onClick={() => moveMonth(-1)}><ChevronsUp size={14} /></RoundButton>{months.map(value => <button type="button" key={value} className={month === value ? 'is-current' : ''} aria-pressed={month === value} onClick={() => selectMonth(value)}>{p.locale === "en-US" ? p.month(value, false) : `${data ? Number(value.split("-")[1]) : value} 月`}</button>)}<RoundButton label={p.t("下一个月")} disabled={month === months[months.length - 1]} onClick={() => moveMonth(1)}><ChevronsDown size={14} /></RoundButton></nav>
          <div className="lp-ref-chart-frame">
            {data && <div className="lp-ref-y-axis" aria-label={p.t("数量")}><span className="lp-ref-y-axis-title">{p.t("数量")}</span>{quantityTicks.map(value => <span key={value} style={{ top: `${pointY(value) / 240 * 100}%` }}>{p.n(value)}</span>)}</div>}
          <div className={`lp-ref-plot${chartTotal === 0 ? ' is-empty' : ''}`} role="slider" tabIndex={chartInteractive ? 0 : -1} aria-label={`${p.t("{month}收码趋势，共 {count} 条短信", { month: monthText, count: p.n(chartTotal) })}${data ? "" : p.t("，演示数据")}`} aria-orientation="horizontal" aria-valuemin={1} aria-valuemax={periods.length} aria-valuenow={currentIndex + 1} aria-valuetext={`${currentPeriod.label}${p.locale === "en-US" ? ", " : "，"}${currentValueText}${data ? '' : p.t("，演示数据")}`} aria-disabled={!chartInteractive} onKeyDown={chartKeyDown} onPointerMove={event => { if (chartInteractive && event.pointerType === 'mouse') setHoveredIndex(pointIndex(event.clientX, event.currentTarget)); }} onPointerLeave={() => setHoveredIndex(null)} onClick={event => { if (chartInteractive) { event.currentTarget.focus({ preventScroll: true }); selectPoint(pointIndex(event.clientX, event.currentTarget)); } }}>
            <svg className="lp-ref-curves" viewBox="0 0 670 240" preserveAspectRatio="none" aria-hidden="true">
              {data && <>
                <defs><linearGradient id={`${chartFillId}-numbers`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".14" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient><linearGradient id={`${chartFillId}-messages`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--red)" stopOpacity=".09" /><stop offset="100%" stopColor="var(--red)" stopOpacity="0" /></linearGradient></defs>
                {(['numbers', 'messages'] as const).filter(key => series[key]).map(key => <path key={key} className="lp-ref-chart-area" d={`${curve(key)} L650 210 L20 210 Z`} style={{ fill: `url(#${chartFillId}-${key})` }} />)}
              </>}
              {data && quantityTicks.map(value => <line className="lp-ref-chart-grid" key={value} x1="20" x2="650" y1={pointY(value)} y2={pointY(value)} />)}
              {series.numbers && (data ? <path className="lp-ref-curve-blue" d={curve('numbers')} /> : <><path className="lp-ref-curve-muted" d={originalCurves.muted} /><path className="lp-ref-curve-blue" d={originalCurves.blue} /></>)}
              {series.messages && <path className="lp-ref-curve-coral" d={data ? curve('messages') : originalCurves.coral} />}
              {chartTotal > 0 && <circle ref={dotRef} className="lp-ref-chart-dot" cx={enhancedMotion ? 0 : previewPoint.x} cy={enhancedMotion ? 0 : previewPoint.y} r="6" />}
            </svg>
            {chartInteractive && <div className={`lp-ref-chart-tooltip${enhancedMotion ? '' : tooltipPosition < 28 ? ' is-left' : tooltipPosition > 72 ? ' is-right' : ''}`} style={{ left: enhancedMotion ? `clamp(74px, ${tooltipPosition}%, calc(100% - 74px))` : `${tooltipPosition}%` }}><strong>{period.label}</strong><span>{[series.messages ? p.t("{count} 条短信", { count: p.n(period.messages) }) : '', series.numbers ? p.t("{count} 个号码", { count: p.n(period.numbers) }) : ''].filter(Boolean).join(' · ') || p.t("未显示趋势")}</span></div>}{chartTotal === 0 && <p className="lp-ref-chart-empty">{p.t("暂无收码记录")}</p>}
            {!data && <div className="lp-ref-chart-total" aria-hidden="true"><strong>{p.n(chartTotal)}</strong><span>{range === '7' ? p.t("7 天短信") : p.t("本月短信")}</span></div>}
          </div>
            {data && <div className={`lp-ref-x-axis${periods.length === 7 ? ' is-daily' : ''}`} aria-label={p.t("日期")}>{periods.map((value, index) => <span key={value.label} title={value.label} style={{ left: `${dataPoints.messages[index].x / 670 * 100}%`, width: `${100 / periods.length}%` }}>{value.label}</span>)}</div>}
          </div>
        </div>
        <footer className="lp-ref-chart-legend" aria-label={p.t("显示趋势")}><button type="button" aria-pressed={series.messages} disabled={series.messages && !series.numbers} onClick={() => setSeries(value => ({ ...value, messages: !value.messages }))}><i />{p.t("短信接收")}</button><button type="button" aria-pressed={series.numbers} disabled={series.numbers && !series.messages} onClick={() => setSeries(value => ({ ...value, numbers: !value.numbers }))}><i />{p.t("号码使用")}</button>{data && <div className="lp-ref-chart-total"><strong>{p.n(chartTotal)}</strong><span>{range === '7' ? p.t("7 天短信") : p.t("30 天短信")}</span></div>}</footer>
      </section>
    </section>

    <aside className="lp-ref-sidebar">
      <section className="lp-ref-inbox" aria-labelledby="lp-ref-inbox-title">
        <header><h2 id="lp-ref-inbox-title">{p.t("最新验证码")}</h2><RoundButton label={p.t("查看短信")} href={destinations.inbox}><Inbox size={20} strokeWidth={1.5} /></RoundButton></header>
          {operationError && <p className="lp-ref-api-error" role="alert">{p.t(operationError)}</p>}
          <div className="lp-ref-message-list">{filteredInbox.map(message => <div className="lp-ref-message-row" key={message.id}>
            <span className="lp-ref-message-date"><span>{data ? message.date : p.locale === "zh-CN" ? "10 月 09 日" : p.date("2026-10-09T12:00:00", { month: "short", day: "2-digit" })}</span><strong>{message.time.slice(0, 5)}</strong></span>
            <span className="lp-ref-message-info">{data && message.code ? <CopyValue inline value={message.code.replace(/\s/g, '')} label={p.t("复制 {sender} 验证码 {code}", { sender: message.sender, code: message.code })} labels={{ ...p.copyLabels, success: p.t("验证码已复制") }} onCopied={() => setNotice('验证码已复制')} /> : <strong>{message.code || p.t("无验证码")}</strong>}<span><ServiceLogo service={message.sender} />{message.sender}{(data ? !message.unread : readIds.includes(message.id)) && <Check size={12} />}</span></span>
            {messageHref ? <a className="lp-ref-message-open" href={messageHref(message)} aria-label={p.t("查看 {sender} 验证码 {code}", { sender: message.sender, code: message.code })}><ArrowUpRight size={19} strokeWidth={1.6} /></a> : <button type="button" className="lp-ref-message-open" disabled={readingMessage} onClick={() => void openMessage(message)} aria-label={p.t("查看 {sender} 验证码 {code}", { sender: message.sender, code: message.code })}><ArrowUpRight size={19} strokeWidth={1.6} /></button>}
          </div>)}{!filteredInbox.length && <p className="lp-ref-empty">{p.t("没有匹配的短信")}</p>}</div>
        <a className="lp-ref-see-all" href={destinations.inbox}>{p.t("查看全部短信")}<ChevronRight size={15} /></a>
      </section>
      <section className="lp-ref-expiries" aria-labelledby="lp-ref-expiry-title"><header><h2 id="lp-ref-expiry-title">{p.t("号码有效期")}</h2><p>{p.t("当前使用中的号码")}</p></header><div>{activeNumbersPreview.map(number => {
        const maximumDays = Math.max(30, number.remaining);
        const remaining = Math.min(100, Math.max(0, Math.round(number.remaining / maximumDays * 100)));
        return <a className="lp-ref-expiry-row" href={numberHref?.(number.id) ?? destinations.numbers} key={number.id} title={`${p.t("{phone} · 剩余 {days} 天", { phone: number.phone, days: p.n(number.remaining) })} · ${number.service}`}><span>{'phoneLabel' in number ? number.phoneLabel : p.t("{region}号码", { region: p.t(number.country) })}{data && <small className="lp-ref-expiry-service">{number.service}</small>}</span><span className="lp-ref-expiry-track" role="meter" aria-label={p.t("{phone} · 剩余 {days} 天", { phone: number.phone, days: p.n(number.remaining) })} aria-valuemin={0} aria-valuemax={maximumDays} aria-valuenow={number.remaining}><i style={{ width: `${remaining}%` }} /></span><span className="lp-ref-expiry-days">{p.t("{days}天", { days: p.n(number.remaining) })}</span><span className={`lp-ref-expiry-direction ${number.remaining <= 3 ? 'is-soon' : ''}`}>{number.remaining <= 3 ? <ArrowDown size={10} strokeWidth={3} /> : <ArrowUp size={10} strokeWidth={3} />}</span></a>;
      })}{!activeNumbers.length && <p className="lp-ref-empty">{p.t("没有匹配的号码")}</p>}</div>{activeNumbers.length > activeNumbersPreview.length && <a className="lp-ref-see-all lp-ref-expiry-see-all" href={destinations.numbers}>{p.t("查看号码")}<ChevronRight size={15} /></a>}</section>
    </aside>

    <dialog className="lp-ref-dialog" ref={dialog} onCancel={() => setSelected(null)} onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setSelected(null); } }}>
      {selected && <><header><div><h2>{selected.sender}</h2><p>{selectedNumber?.phone}</p></div><RoundButton label={p.t("关闭短信")} onClick={() => setSelected(null)}><X size={19} /></RoundButton></header><div className="lp-ref-dialog-code">{selected.code}</div><p className="lp-ref-dialog-body">{selected.body}</p><footer>{selected.code && <CopyValue labels={p.copyLabels} value={selected.code.replace(/\s/g, '')} label={p.t("复制验证码")} />}<Button size="sm" variant="quiet" onClick={() => setSelected(null)}>{p.t("关闭")}</Button></footer></>}
    </dialog>
    <div className={`lp-ref-notice${notice ? ' is-visible' : ''}`} role="status">{notice && <><Check size={16} />{p.t(notice)}</>}</div>
    <span className="lp-ref-sr-only">{p.t("可用积分 {points}", { points: p.n(balance) })}{data ? '' : p.t("，所有号码与短信均为演示数据。")}</span>
  </main>;
}
