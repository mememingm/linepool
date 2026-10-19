import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);
export { gsap, useGSAP };
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PageMotion({ active, children }: { active: boolean; children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const { contextSafe } = useGSAP(() => {
    if (!active || !scope.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(scope.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .25, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
      const cards = scope.current!.querySelectorAll('.platform-card');
      if (cards.length) gsap.fromTo(cards, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .26, stagger: .018, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
    });
    return () => media.revert();
  }, { scope, dependencies: [active], revertOnUpdate: true });
  const hover = contextSafe((target: HTMLElement, raised: boolean) => {
    if (reducedMotion()) return;
    gsap.to(target, { y: raised ? -3 : 0, duration: .18, ease: 'power2.out', overwrite: 'auto', ...(!raised ? { clearProps: 'transform' } : {}) });
  });
  return <div ref={scope} hidden={!active} onPointerOver={event => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.platform-card');
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) hover(card, true);
  }} onPointerOut={event => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.platform-card');
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) hover(card, false);
  }}>{children}</div>;
}
