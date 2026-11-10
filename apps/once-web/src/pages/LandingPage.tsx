import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarClock, Check, ChevronDown, Lock, MessageCircleMore,
  Moon, RefreshCw, ShieldCheck, Smartphone, Sparkles, Sun, UserPlus, Wallet,
} from "lucide-react";
import { useApp } from "../app/AppProvider";
import { useUIStore } from "../stores/ui-store";
import { usePlans } from "../lib/queries";
import "../landing.css";

// Fictional preview content for the hero phone; no real account or provider data.
const inbox = [
  { from: "Google", text: "G-482913 是你的 Google 验证码。", tone: "blue" },
  { from: "Telegram", text: "Login code: 51204. Do not give this code to anyone.", tone: "mint" },
  { from: "+1 646 555 0172", text: "明天的会改到下午三点，可以吗？", tone: "coral" },
  { from: "Uber", text: "Your Uber code is 7731.", tone: "yellow" },
  { from: "Discord", text: "Your verification code: 903 118", tone: "lilac" },
];
const cities = [
  ["纽约", "212"], ["洛杉矶", "213"], ["旧金山", "415"], ["芝加哥", "312"], ["西雅图", "206"],
  ["迈阿密", "305"], ["波士顿", "617"], ["奥斯汀", "512"], ["拉斯维加斯", "702"], ["华盛顿", "202"],
];
const uses = [
  { icon: UserPlus, title: "注册海外 App", text: "需要当地手机号的服务，用它完成注册和绑定。", tone: "blue" },
  { icon: MessageCircleMore, title: "接收验证码", text: "验证码进入网页收件箱，一键复制，不用来回切换。", tone: "coral" },
  { icon: BriefcaseBusiness, title: "跨境工作沟通", text: "和海外客户、同事收发短信，不暴露私人号码。", tone: "mint" },
  { icon: Sparkles, title: "临时项目与测试", text: "短期活动或产品测试，用 7 天，到期自然结束。", tone: "yellow" },
];
const steps = [
  { title: "选地区", text: "挑一个州或城市，比如纽约、加州。", icon: Smartphone },
  { title: "挑号码", text: "从可用号码里选一个喜欢的。", icon: BadgeCheck },
  { title: "开始用", text: "在网页里收短信、看验证码、续费。", icon: MessageCircleMore },
];
const promises = [
  { icon: Wallet, title: "不会自动扣费", text: "一次性付费，到期就停，不会悄悄续费。" },
  { icon: Lock, title: "号码只给你用", text: "租期内这个号码不会分给别人。" },
  { icon: RefreshCw, title: "可以同号续费", text: "用得顺手，在到期前续上同一个号码。" },
  { icon: ShieldCheck, title: "能力提前说清", text: "每个号码能做什么，在详情里写明白。" },
];
const faqs = [
  ["我租到的是什么？", "是约定期限内这个号码的使用权。号码不归用户所有，能用的短信、语音等能力以号码详情里的标注为准。"],
  ["到期以后会怎样？", "到期后服务停止，不会自动续费，也不会额外扣钱。想继续使用，在到期前同号续费即可。"],
  ["可以收哪些短信？", "以号码详情页标注的能力为准。目前为演示版本，演示号码不是真实可拨打的手机号码。"],
  ["支持哪些地区？", "目前开放美国各州的号码，可以按州或城市挑选区号；更多国家会陆续开放。"],
];

/** The app uses hash routing, so in-page jumps scroll directly instead of changing the hash. */
function Jump({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return <a className={className} href={`#/`} onClick={event => {
    event.preventDefault();
    document.getElementById(to)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }}>{children}</a>;
}
function Header() {
  const { account } = useApp();
  const theme = useUIStore(state => state.theme), toggle = useUIStore(state => state.toggleTheme);
  return <header className="ol-header"><div className="ol-container ol-header-inner">
    <Link className="ol-logo" to="/" aria-label="ONCE 首页"><span className="ol-logo-mark">O</span>ONCE<span className="ol-demo-tag">演示版</span></Link>
    <nav className="ol-nav" aria-label="主导航"><Link to="/numbers/new">选择号码</Link><Jump to="pricing">价格</Jump><Jump to="faq">常见问题</Jump><Link to="/help">帮助中心</Link></nav>
    <div className="ol-header-actions">
      <button type="button" className="ol-icon-btn" onClick={toggle} aria-label="切换主题">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
      {account ? <Link className="ol-btn ol-btn-dark" to="/app/overview">进入工作台</Link>
        : <><Link className="ol-link-btn" to="/login">登录</Link><Link className="ol-btn ol-btn-dark ol-hide-sm" to="/register">免费注册</Link></>}
    </div>
  </div></header>;
}

function Phone() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setCount(value => value + 1), 2600);
    return () => clearInterval(timer);
  }, []);
  // Keep the newest three bubbles; keys stay stable so each one animates in once.
  const visible = Array.from({ length: Math.min(count, 3) }, (_, i) => count - 1 - i).map(n => ({ n, ...inbox[n % inbox.length]! }));
  return <div className="ol-phone-wrap" aria-hidden="true">
    <div className="ol-blob ol-blob-a" /><div className="ol-blob ol-blob-b" />
    <div className="ol-phone">
      <div className="ol-phone-notch" />
      <div className="ol-phone-top"><span>美国 · 纽约州</span><strong>+1 212 555 0119</strong><em><span className="ol-live-dot" />收信中 · 剩 28 天</em></div>
      <div className="ol-phone-feed">
        <AnimatePresence initial={false}>
          {visible.map(message => <motion.div key={message.n} layout className="ol-bubble" data-tone={message.tone}
            initial={{ opacity: 0, y: -18, scale: .92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .9 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}>
            <span className="ol-bubble-from">{message.from}<small>刚刚</small></span>
            <p>{message.text}</p>
          </motion.div>)}
        </AnimatePresence>
      </div>
    </div>
    <motion.div className="ol-sticker ol-sticker-a" animate={{ y: [0, -10, 0], rotate: [-6, -3, -6] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
      <CalendarClock size={16} />30 天独享</motion.div>
    <motion.div className="ol-sticker ol-sticker-b" animate={{ y: [0, 12, 0], rotate: [5, 8, 5] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
      <Check size={16} />不自动续费</motion.div>
    <motion.div className="ol-sticker ol-sticker-c" animate={{ y: [0, -8, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
      验证码 <b>482 913</b></motion.div>
  </div>;
}

const reveal = { initial: { opacity: 0, y: 28 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: .55, ease: [0.22, 1, 0.36, 1] as const } };

export function LandingPage() {
  const [open, setOpen] = useState(0);
  const terms = usePlans();
  const cheapest = terms.length ? Math.min(...terms.map(term => term.pointsPrice)) : null;
  // With more than one plan, the lowest price per day gets the "更划算" badge.
  const bestValueDays = terms.length > 1 ? [...terms].sort((a, b) => a.pointsPrice / a.days - b.pointsPrice / b.days)[0]!.days : 0;
  const setWizard = useUIStore(state => state.setWizard);
  return <MotionConfig reducedMotion="user"><div className="once-landing">
    <Header />
    <main>
      <section className="ol-hero"><div className="ol-container ol-hero-grid">
        <motion.div className="ol-hero-copy" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6 }}>
          <span className="ol-pill"><Sparkles size={15} />美国号码 · 按州挑选区号</span>
          <h1>一个<span className="ol-hl ol-hl-yellow">只属于你</span>的<br />海外手机号</h1>
          <p className="ol-lead">租 7 天或 30 天，用它注册海外 App、接收验证码、和朋友收发短信。到期不扣钱，想继续就同号续费。</p>
          <div className="ol-cta-row">
            <Link className="ol-btn ol-btn-primary ol-btn-lg" to="/numbers/new">挑一个号码<ArrowRight size={18} /></Link>
            <Jump className="ol-btn ol-btn-ghost ol-btn-lg" to="how">看看怎么用</Jump>
          </div>
          <ul className="ol-hero-facts"><li><Check size={15} />{cheapest === null ? "套餐价格以实时列表为准" : `${cheapest.toLocaleString("zh-CN")} 积分起`}</li><li><Check size={15} />不自动续费</li><li><Check size={15} />网页里直接收短信</li></ul>
        </motion.div>
        <Phone />
      </div></section>

      <div className="ol-marquee" aria-label="可选城市与区号"><div className="ol-marquee-track">
        {[...cities, ...cities].map(([city, code], i) => <span key={i} aria-hidden={i >= cities.length || undefined}><b>{code}</b>{city}</span>)}
      </div></div>

      <section className="ol-section"><div className="ol-container">
        <motion.div className="ol-section-head" {...reveal}><span className="ol-kicker">能用来做什么</span><h2>一个号码，<span className="ol-hl ol-hl-coral">好多用处</span></h2></motion.div>
        <div className="ol-uses">{uses.map(({ icon: Icon, title, text, tone }, i) =>
          <motion.article className="ol-use" data-tone={tone} key={title} {...reveal} transition={{ ...reveal.transition, delay: i * .08 }} whileHover={{ y: -6, rotate: i % 2 ? .6 : -.6 }}>
            <span className="ol-use-icon"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p>
          </motion.article>)}</div>
      </div></section>

      <section className="ol-section ol-how" id="how"><div className="ol-container">
        <motion.div className="ol-section-head" {...reveal}><span className="ol-kicker">怎么开始</span><h2>三步，<span className="ol-hl ol-hl-mint">一分钟</span>拿到号码</h2></motion.div>
        <ol className="ol-steps">{steps.map(({ title, text, icon: Icon }, i) =>
          <motion.li className="ol-step" key={title} {...reveal} transition={{ ...reveal.transition, delay: i * .12 }}>
            <span className="ol-step-no">{i + 1}</span><Icon size={22} className="ol-step-icon" /><h3>{title}</h3><p>{text}</p>
          </motion.li>)}</ol>
      </div></section>

      <section className="ol-section" id="pricing"><div className="ol-container">
        <motion.div className="ol-section-head" {...reveal}><span className="ol-kicker">价格</span><h2>价格透明，<span className="ol-hl ol-hl-yellow">一次付清</span></h2><p>没有月费，没有隐藏费用，也不会自动续费。</p></motion.div>
        <div className="ol-prices">{terms.map((term, i) => {
          const best = term.days === bestValueDays;
          return <motion.div className="ol-price" data-best={best || undefined} key={term.days} {...reveal} transition={{ ...reveal.transition, delay: i * .1 }}>
            {best && <span className="ol-price-badge">更划算</span>}
            <span className="ol-price-label">{term.label}</span>
            <div className="ol-price-amount">{term.pointsPrice.toLocaleString("zh-CN")}<span>积分 / {term.days} 天</span></div>
            <p>{term.note}</p>
            <ul>{[`${term.days} 天号码独享`, "网页收件箱，验证码一键复制", "到期前可同号续费", "到期自动停止，不扣费"].map(item => <li key={item}><Check size={16} />{item}</li>)}</ul>
            <Link className={`ol-btn ol-btn-lg ${best ? "ol-btn-primary" : "ol-btn-dark"}`} to="/numbers/new"
              onClick={() => setWizard(previous => ({ ...previous, term: term.days, number: "", agreed: false }))}>选 {term.days} 天</Link>
          </motion.div>;
        })}</div>
      </div></section>

      <section className="ol-section ol-promise"><div className="ol-container ol-promise-grid">
        {promises.map(({ icon: Icon, title, text }, i) => <motion.div className="ol-promise-item" key={title} {...reveal} transition={{ ...reveal.transition, delay: i * .07 }}>
          <Icon size={22} /><div><h3>{title}</h3><p>{text}</p></div></motion.div>)}
      </div></section>

      <section className="ol-section" id="faq"><div className="ol-container ol-faq-grid">
        <motion.div className="ol-section-head ol-left" {...reveal}><span className="ol-kicker">常见问题</span><h2>还有<span className="ol-hl ol-hl-lilac">疑问</span>？</h2><p>更多说明见 <Link to="/help">帮助中心</Link>。</p></motion.div>
        <div className="ol-faq">{faqs.map(([q, a], i) => <div className="ol-faq-item" key={q} data-open={open === i || undefined}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>{q}<ChevronDown size={20} /></button>
          <AnimatePresence initial={false}>{open === i && <motion.div className="ol-faq-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .25 }}><p>{a}</p></motion.div>}</AnimatePresence>
        </div>)}</div>
      </div></section>

      <section className="ol-section ol-final"><motion.div className="ol-container ol-final-card" {...reveal}>
        <div className="ol-final-dots" aria-hidden="true" />
        <h2>现在就挑一个<br />属于你的号码</h2>
        <p>选好地区和租期，一分钟就能开始收短信。</p>
        <Link className="ol-btn ol-btn-light ol-btn-lg" to="/numbers/new">开始挑号码<ArrowRight size={18} /></Link>
      </motion.div></section>
    </main>
    <footer className="ol-footer"><div className="ol-container ol-footer-inner">
      <span className="ol-logo"><span className="ol-logo-mark">O</span>ONCE</span>
      <nav aria-label="页脚导航"><Link to="/numbers/new">选择号码</Link><Link to="/help">帮助中心</Link><Link to="/login">登录</Link></nav>
      <small>演示版本 · 彩信与语音暂未开放</small>
    </div></footer>
  </div></MotionConfig>;
}
