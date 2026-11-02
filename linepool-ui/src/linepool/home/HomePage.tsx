import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { BlurFade } from '../../vendor/magic/src/components/ui/blur-fade';
import { Marquee } from '../../vendor/magic/src/components/ui/marquee';
import { NumberTicker } from '../../vendor/magic/src/components/ui/number-ticker';
import { DisplayToolbar } from '../preferences/DisplayControls';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flaps, reducedMotion, useClock } from './Flaps';
import { useScrollScenes } from './useScrollScenes';
import './home.css';

// Mirrors regionIdSchema / serviceSchema in packages/contracts; live stock and prices stay behind sign-in.
const regions = [
  { code: 'US', name: '美国', prefix: '+1', area: '北美', note: '可指定区号' },
  { code: 'GB', name: '英国', prefix: '+44', area: '欧洲' },
  { code: 'CA', name: '加拿大', prefix: '+1', area: '北美' },
  { code: 'SG', name: '新加坡', prefix: '+65', area: '亚洲' },
  { code: 'DE', name: '德国', prefix: '+49', area: '欧洲' },
  { code: 'NL', name: '荷兰', prefix: '+31', area: '欧洲' },
] as const;
const platforms = ['Telegram', 'WhatsApp', 'Google'] as const;
// Board samples only; the hero labels them as an example.
const arrivals = [
  { from: 'TELEGRAM', to: '+1 415 ··· 0142', code: '482137' },
  { from: 'WHATSAPP', to: '+44 7700 ··· 21', code: '602117' },
  { from: 'GOOGLE', to: '+65 8123 ··· 07', code: '735190' },
] as const;
/** Splits a heading into characters that rise in one after another once the heading is revealed. */
function SplitText({ text, start = 0 }: { text: string; start?: number }) {
  return <>{[...text].map((char, index) => <span key={index} className="lp-split" style={{ '--i': start + index } as CSSProperties}><span>{char}</span></span>)}</>;
}
function SplitHeading({ id, lead, accent }: { id: string; lead: string; accent?: string }) {
  return <h2 id={id} aria-label={lead + (accent ?? '')}><span aria-hidden><SplitText text={lead} />{accent && <em><SplitText text={accent} start={[...lead].length} /></em>}</span></h2>;
}

function ArrivalBoard({ t }: { t: (source: string) => string }) {
  const [index, setIndex] = useState(0);
  const clock = useClock();
  const paused = useRef(false);
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = window.setInterval(() => { if (!paused.current) setIndex(value => (value + 1) % arrivals.length); }, 5200);
    return () => window.clearInterval(timer);
  }, []);
  const arrival = arrivals[index];
  return <figure className="lp-board" onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
    <div className="lp-board-bar">
      <span><i className="lp-dot" />{t('收码中')}</span>
      <span>{t('示例')} · UTC {clock}</span>
    </div>
    <dl className="lp-board-rows">
      <div><dt>{t('来自')}</dt><dd><Flaps text={arrival.from} className="lp-flaps-sm" /></dd></div>
      <div><dt>{t('号码')}</dt><dd className="lp-board-to">{arrival.to}</dd></div>
      <div className="lp-board-code"><dt>{t('验证码')}</dt><dd><Flaps text={arrival.code} /></dd></div>
    </dl>
    <div className="lp-board-tabs" role="tablist" aria-label={t('示例短信')}>
      {arrivals.map((item, position) => <button key={item.from} type="button" role="tab" aria-selected={position === index} onClick={() => setIndex(position)}>{String(position + 1).padStart(2, '0')} {item.from}</button>)}
    </div>
  </figure>;
}

export default function HomePage() {
  const p = useDisplayPreferences();
  const { t } = p;
  const root = useRef<HTMLDivElement>(null);
  useScrollScenes(root);
  useEffect(() => {
    const title = document.title;
    document.title = `LINEPOOL · ${t('海外号码，专收验证码')}`;
    return () => { document.title = title; };
  }, [t]);
  const steps = [
    { label: 'STEP 01', title: '选地区与平台', text: '6 个地区，Telegram、WhatsApp、Google 三个平台。美国号码可以指定区号。', stamp: '选号' },
    { label: 'STEP 02', title: '选期限并下单', text: '7 天或 30 天，一次 1–10 个号码，用账户积分结算。', stamp: '下单' },
    { label: 'STEP 03', title: '请求验证码并查收', text: '在目标平台用这个号码请求验证码，回到短信中心点击刷新。', stamp: '收码' },
  ];
  const editions = [
    { no: 'NO. 007', days: 7, name: '7 天短期服务', fit: '一次性注册与验证', points: ['期限内使用同一个号码', '期限内可反复接收短信', '验证码按号码归档'] },
    { no: 'NO. 030', days: 30, name: '30 天短期服务', fit: '需要多次登录验证', points: ['期限内使用同一个号码', '期限内可反复接收短信', '到期前 3 天提醒'], featured: true },
  ];
  const clauses = [
    { title: '只接收，不发送', text: '号码仅用于接收短信，不支持发送短信或拨打电话。' },
    { title: '到期即失效', text: '服务期限结束后号码失效，不支持续费，请在期限内完成验证。' },
    { title: '不会自动发码', text: '创建订单不会自动触发验证码，需要你在目标平台主动请求。' },
    { title: '不会重复扣费', text: '下单超时后重试会复用原订单请求，不会重复扣除积分。' },
  ];
  const faqs = [
    { q: '支持哪些平台和地区？', a: '目前支持 Telegram、WhatsApp、Google，地区包括美国、英国、加拿大、新加坡、德国、荷兰。实时库存登录后在购买页查看。' },
    { q: '如何付款？', a: '使用账户积分结算。登录后可在积分充值页充值，下单前会显示单价、合计和下单后余额。' },
    { q: '下单后多久能用？', a: '订单完成后号码会出现在“我的号码”中。如果订单显示处理中，请在订单记录中确认结果，不要重复购买。' },
    { q: '收不到验证码怎么办？', a: '先确认已在目标平台用该号码请求验证码，再在短信中心点击“刷新短信”。刷新不会延长号码有效期。' },
    { q: '号码可以续费吗？', a: '不可以。短期服务到期后号码失效，需要时请重新下单。' },
  ];
  return <div ref={root} className="lp-home" lang={p.locale}>
    <header className="lp-home-header">
      <a href="/" className="lp-home-brand"><span>LINE</span><em>pool</em></a>
      <nav aria-label={t('首页导航')} className="lp-home-nav">
        <a href="#regions">{t('地区')}</a><a href="#how">{t('使用流程')}</a><a href="#plans">{t('期限方案')}</a><a href="#faq">{t('常见问题')}</a>
      </nav>
      <div className="lp-home-actions">
        <DisplayToolbar />
        <a href="/login" className="lp-home-text-link">{t('登录')}</a>
        <a href="/register" className="lp-home-block">{t('注册')}</a>
      </div>
      <span className="lp-home-progress" aria-hidden />
    </header>

    <main>
      <section className="lp-home-hero" aria-labelledby="lp-home-title" data-scene="exit">
        <div className="lp-home-hero-copy">
          <p className="lp-home-kicker"><i className="lp-dot" />{t('短期号码 · 仅接收短信 · 7 / 30 天')}</p>
          <h1 id="lp-home-title">{t('海外号码，')}<br /><mark>{t('专收')}</mark>{t('验证码。')}</h1>
          <p className="lp-home-lede">{t('选一个地区和平台，拿到一个短期号码。Telegram、WhatsApp、Google 发来的验证码，都落进同一个短信中心。')}</p>
          <div className="lp-home-cta">
            <a href="/register" className="lp-home-block lp-home-block-lg">{t('注册并选号')}<ArrowRight size={18} /></a>
            <a href="/login" className="lp-home-text-link">{t('已有账号，登录')}</a>
          </div>
        </div>
        <BlurFade delay={0.1} className="lp-home-hero-board"><ArrivalBoard t={t} /></BlurFade>
        <dl className="lp-home-specs">
          <div><dt>{t('地区')}</dt><dd>06</dd></div>
          <div><dt>{t('平台')}</dt><dd>03</dd></div>
          <div><dt>{t('期限')}</dt><dd>7 / 30<small>{t(' 天')}</small></dd></div>
          <div><dt>{t('单次数量')}</dt><dd>1–10</dd></div>
        </dl>
      </section>

      <div className="lp-home-ticker" aria-hidden>
        <Marquee pauseOnHover className="lp-home-marquee">
          {[...regions.map(region => `${region.code} ${region.prefix}`), ...platforms.map(platform => platform.toUpperCase())].map(item => <span key={item}>{item}<i>✦</i></span>)}
        </Marquee>
      </div>

      <section id="regions" className="lp-home-section" aria-labelledby="regions-title">
        <div className="lp-home-head" data-reveal>
          <p className="lp-home-eyebrow">§ 01 · {t('地区')}</p>
          <SplitHeading id="regions-title" lead={t('六个地区，')} accent={t('随时出发')} />
          <p>{t('实时库存与单价登录后在购买页查看。')}</p>
        </div>
        <div className="lp-departures" role="table" aria-label={t('可选地区')} data-reveal>
          <div className="lp-departures-row lp-departures-head" role="row">
            <span role="columnheader">{t('代码')}</span><span role="columnheader">{t('地区')}</span><span role="columnheader">{t('国际区号')}</span><span role="columnheader">{t('所属区域')}</span><span role="columnheader">{t('期限')}</span><span role="columnheader" />
          </div>
          {regions.map((region, index) => <a key={region.code} href="/register" className="lp-departures-row" role="row" style={{ '--i': index } as CSSProperties}>
            <span role="cell" className="lp-departures-code">{region.code}</span>
            <span role="cell">{t(region.name)}{'note' in region && <small>{t(region.note)}</small>}</span>
            <span role="cell" className="lp-mono">{region.prefix}</span>
            <span role="cell">{t(region.area)}</span>
            <span role="cell" className="lp-mono">7 · 30 D</span>
            <span role="cell" className="lp-departures-go">{t('选号')}<ArrowUpRight size={16} /></span>
          </a>)}
        </div>
      </section>

      <section id="how" className="lp-home-section" aria-labelledby="how-title">
        <div className="lp-home-head" data-reveal>
          <p className="lp-home-eyebrow">§ 02 · {t('使用流程')}</p>
          <SplitHeading id="how-title" lead={t('三张卡片，')} accent={t('一个验证码')} />
        </div>
        <ol className="lp-postcards" data-scene="enter">
          {steps.map(step => <li key={step.label} className="lp-postcard">
            <div className="lp-postcard-stub"><span>{step.label}</span></div>
            <div className="lp-postcard-body">
              <span className="lp-stamp">{t(step.stamp)}</span>
              <h3>{t(step.title)}</h3>
              <p>{t(step.text)}</p>
            </div>
          </li>)}
        </ol>
      </section>

      <section id="plans" className="lp-home-section" aria-labelledby="plans-title">
        <div className="lp-home-head" data-reveal>
          <p className="lp-home-eyebrow">§ 03 · {t('期限方案')}</p>
          <SplitHeading id="plans-title" lead={t('两种期限，')} accent={t('按需选择')} />
          <p>{t('价格以积分计，随地区和平台不同。')}</p>
        </div>
        <div className="lp-editions" data-reveal>
          {editions.map(edition => <article key={edition.no} className="lp-edition" data-featured={edition.featured || undefined}>
            <header><span>{edition.no}</span>{edition.featured && <span>{t('常用')}</span>}</header>
            <h3>{t(edition.name)}</h3>
            <p className="lp-edition-days"><strong><NumberTicker value={edition.days} delay={edition.featured ? .25 : .1} className="lp-edition-ticker" /></strong>{t(' 天')}</p>
            <p className="lp-edition-fit">{t(edition.fit)}</p>
            <ul>{edition.points.map(point => <li key={point}>{t(point)}</li>)}</ul>
            <a href="/register" className="lp-home-block">{t('注册后选购')}<ArrowRight size={16} /></a>
            <span className="lp-edition-seal" aria-hidden>RECEIVE<br />ONLY</span>
          </article>)}
        </div>
      </section>

      <section className="lp-home-section" aria-labelledby="terms-title">
        <div className="lp-home-head" data-reveal>
          <p className="lp-home-eyebrow">§ 04 · {t('使用须知')}</p>
          <SplitHeading id="terms-title" lead={t('下单前，')} accent={t('先读这四条')} />
        </div>
        <ol className="lp-clauses" data-reveal>
          {clauses.map((clause, index) => <li key={clause.title} style={{ '--i': index } as CSSProperties}><span className="lp-mono">4.{index + 1}</span><div><h3>{t(clause.title)}</h3><p>{t(clause.text)}</p></div></li>)}
        </ol>
      </section>

      <section id="faq" className="lp-home-section lp-faq" aria-labelledby="faq-title">
        <div className="lp-home-head lp-faq-head" data-reveal>
          <p className="lp-home-eyebrow">§ 05 · {t('常见问题')}</p>
          <SplitHeading id="faq-title" lead={t('还有疑问？')} />
        </div>
        <div className="lp-faq-list">
          {faqs.map((item, index) => <details key={item.q} open={index === 0}><summary><span className="lp-mono">Q{index + 1}</span>{t(item.q)}<Plus size={18} aria-hidden /></summary><p>{t(item.a)}</p></details>)}
        </div>
      </section>

      <section className="lp-home-final" aria-labelledby="final-title" data-scene="enter">
        <p className="lp-home-eyebrow">{t('准备好了')}</p>
        <h2 id="final-title"><Flaps text="READY" className="lp-flaps-final" replayInView /></h2>
        <p>{t('注册后即可查看各地区的实时库存与价格。')}</p>
        <div className="lp-home-cta"><a href="/register" className="lp-home-block lp-home-block-lg lp-home-block-signal">{t('立即注册')}<ArrowRight size={18} /></a><a href="/login" className="lp-home-text-link">{t('登录')}</a></div>
      </section>
    </main>

    <footer className="lp-home-footer"><span><b>LINE</b><em>pool</em></span><span className="lp-mono">{t('号码与短信服务')} · {t('仅接收短信')}</span></footer>
  </div>;
}
