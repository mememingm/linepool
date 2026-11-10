import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import type { ReferencePeriod } from '../workspace-reference/reference-data';
import './TrendChart.css';

const HEIGHT = 210;
const PAD = { top: 14, right: 10, bottom: 26, left: 34 };

/** Rounds the axis maximum up to 1, 2 or 5 × 10ⁿ so ticks stay readable. */
function niceMaximum(value: number) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find(base => base * power * 4 >= value)! * power;
  return step * 4;
}

/**
 * Signed-in trend chart: daily message bars plus the numbers-in-use line.
 * Drawn in real pixels (measured width), so circles stay round and strokes stay even.
 */
export default function TrendChart({ periods, show, emptyHref }: {
  periods: ReferencePeriod[]; show: { messages: boolean; numbers: boolean }; emptyHref: string;
}) {
  const p = useDisplayPreferences();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(node);
    setWidth(Math.round(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  const total = periods.reduce((sum, period) => sum + period.messages, 0);
  const anyNumbers = periods.some(period => period.numbers > 0);
  if (!total && !anyNumbers) return <div className="lp-trend-empty">
    <span className="lp-trend-empty-icon"><MessageSquare size={20} strokeWidth={1.7} aria-hidden="true" /></span>
    <strong>{p.t('还没有收码记录')}</strong>
    <p>{p.t('购买号码后，在目标平台用它请求验证码，每天收到的短信会在这里汇总。')}</p>
    <a href={emptyHref}>{p.t('购买号码')}<ArrowUpRight size={15} aria-hidden="true" /></a>
  </div>;

  const innerWidth = Math.max(0, width - PAD.left - PAD.right);
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const count = periods.length;
  const band = count ? innerWidth / count : 0;
  const barWidth = Math.max(3, Math.min(26, band * .62));
  const maximum = niceMaximum(Math.max(1, ...periods.flatMap(period => [show.messages ? period.messages : 0, show.numbers ? period.numbers : 0])));
  const ticks = [0, 1, 2, 3, 4].map(index => maximum / 4 * index);
  const x = (index: number) => PAD.left + band * (index + .5);
  const y = (value: number) => PAD.top + innerHeight - value / maximum * innerHeight;
  const line = periods.map((period, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(period.numbers).toFixed(1)}`).join(' ');
  const labelEvery = count > 10 ? Math.ceil(count / 6) : 1;
  const current = active === null ? null : periods[active];

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const index = Math.floor((event.clientX - left - PAD.left) / band);
    setActive(Math.max(0, Math.min(count - 1, index)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = active ?? count - 1;
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: count - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); setActive(Math.max(0, Math.min(count - 1, next)));
  };
  const tooltipLeft = active === null ? 0 : Math.max(76, Math.min(width - 76, x(active)));
  const summary = p.t('{days} 天共 {count} 条短信', { days: p.n(count), count: p.n(total) });

  return <div ref={box} className="lp-trend" data-active={active !== null || undefined}
    role="group" aria-label={summary} tabIndex={0} onKeyDown={keys}
    onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}>
    {width > 0 && <svg width={width} height={HEIGHT} aria-hidden="true">
      {ticks.map(value => <g key={value} className="lp-trend-tick">
        <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
        <text x={PAD.left - 8} y={y(value)} dy="0.32em" textAnchor="end">{p.n(value)}</text>
      </g>)}
      {active !== null && <line className="lp-trend-guide" x1={x(active)} x2={x(active)} y1={PAD.top - 4} y2={PAD.top + innerHeight} />}
      {show.messages && periods.map((period, index) => period.messages > 0 && <rect key={period.label} className="lp-trend-bar"
        data-active={index === active || undefined}
        x={x(index) - barWidth / 2} y={y(period.messages)} width={barWidth} height={Math.max(2, PAD.top + innerHeight - y(period.messages))}
        rx={Math.min(4, barWidth / 2)} />)}
      {show.numbers && <>
        <path className="lp-trend-area" d={`${line} L${x(count - 1).toFixed(1)} ${PAD.top + innerHeight} L${x(0).toFixed(1)} ${PAD.top + innerHeight} Z`} />
        <path className="lp-trend-line" d={line} />
        {active !== null && <circle className="lp-trend-dot" cx={x(active)} cy={y(periods[active]!.numbers)} r="4.5" />}
      </>}
      {periods.map((period, index) => (index % labelEvery === 0 || index === count - 1) && (count - 1 - index >= labelEvery / 2 || index === count - 1) &&
        <text key={period.label} className="lp-trend-label" x={x(index)} y={HEIGHT - 6} textAnchor="middle">{period.label}</text>)}
    </svg>}
    {current && <div className="lp-trend-tooltip" style={{ transform: `translateX(${tooltipLeft}px) translateX(-50%)` }} role="status">
      <strong>{current.label}</strong>
      {show.messages && <span><i className="is-messages" />{p.t('{count} 条短信', { count: p.n(current.messages) })}</span>}
      {show.numbers && <span><i className="is-numbers" />{p.t('{count} 个使用中号码', { count: p.n(current.numbers) })}</span>}
    </div>}
  </div>;
}
