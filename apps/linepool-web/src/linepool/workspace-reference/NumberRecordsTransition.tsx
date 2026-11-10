import { useLayoutEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';

export default function NumberRecordsTransition({ busy, children }: { busy: boolean; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousRows = useRef(new Set<HTMLTableRowElement>());

  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const content = contentRef.current!;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let tween: gsap.core.Tween | undefined;
    let hasTable = false;
    const resize = () => {
      const target = content.getBoundingClientRect().height;
      const height = viewport.getBoundingClientRect().height;
      const animate = hasTable && !reducedMotion.matches && Math.abs(height - target) > 1;
      hasTable = Boolean(content.querySelector('table'));
      tween?.kill();
      // Measure the natural content while the viewport holds its previous height.
      if (animate) tween = gsap.to(viewport, { height: target, duration: 0.24, ease: 'power2.inOut' });
      else viewport.style.height = `${target}px`;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    reducedMotion.addEventListener('change', resize);
    resize();
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', resize);
      tween?.kill();
      viewport.style.removeProperty('height');
    };
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current!;
    const rows = [...content.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    const added = rows.filter(row => !previousRows.current.has(row));
    const hadRows = previousRows.current.size > 0;
    previousRows.current = new Set(rows);
    if (!hadRows || !added.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(added, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' });
    }, content);
    return () => context.revert();
  }, [children]);

  return <div id="lp-shell-number-records" ref={viewportRef} className="lp-shell-number-records-viewport" aria-busy={busy}>
    <div ref={contentRef}>{children}</div>
  </div>;
}
