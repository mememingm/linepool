import { useEffect, useRef, useState } from 'react';

const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Split-flap characters: each tile shuffles briefly, then lands left to right. */
export function Flaps({ text, className = '', replayInView = false }: { text: string; className?: string; replayInView?: boolean }) {
  const [shown, setShown] = useState(text);
  const [cycle, setCycle] = useState(0);
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!replayInView || !element.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setCycle(value => value + 1); }, { threshold: .6 });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [replayInView]);
  useEffect(() => {
    if (reducedMotion()) { setShown(text); return; }
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      setShown([...text].map((char, index) => char === ' ' || tick > 5 + index * 2 ? char : glyphs[Math.floor(Math.random() * glyphs.length)]).join(''));
      if (tick > 5 + text.length * 2) window.clearInterval(timer);
    }, 55);
    return () => window.clearInterval(timer);
  }, [text, cycle]);
  return <span ref={element} className={`lp-flaps ${className}`} aria-label={text} role="img">
    {[...shown].map((char, index) => <span key={index} className="lp-flap" data-blank={char === ' ' || undefined} data-settled={char === text[index] || undefined} aria-hidden>{char}</span>)}
  </span>;
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return now.toISOString().slice(11, 19);
}
