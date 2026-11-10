import { useEffect, type RefObject } from 'react';
import { reducedMotion } from './Flaps';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Scroll-linked scenes for the homepage, written as CSS variables so styles own every effect.
 * - root: --page-p (0–1 page progress) and --vel (smoothed scroll velocity, -1–1)
 * - [data-scene="exit"]: --p goes 0→1 while the element scrolls off the top
 * - [data-scene="enter"]: --p goes 0→1 from entering the viewport until its top reaches 35%
 * - [data-reveal]: gains .is-in once it is in view
 * With reduced motion nothing is animated and every element starts in its final state.
 */
export function useScrollScenes(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reveals = [...element.querySelectorAll<HTMLElement>('[data-reveal]')];
    if (reducedMotion()) { reveals.forEach(item => item.classList.add('is-in')); return; }
    element.dataset.motion = '';
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }), { rootMargin: '0px 0px -12% 0px' });
    reveals.forEach(item => observer.observe(item));

    const scenes = [...element.querySelectorAll<HTMLElement>('[data-scene]')];
    let frame = 0, lastY = window.scrollY, velocity = 0;
    const update = () => {
      frame = 0;
      const height = window.innerHeight;
      const y = window.scrollY;
      velocity += (Math.max(-1, Math.min(1, (y - lastY) / 60)) - velocity) * .18;
      lastY = y;
      element.style.setProperty('--page-p', String(clamp(y / Math.max(1, document.documentElement.scrollHeight - height))));
      element.style.setProperty('--vel', velocity.toFixed(3));
      for (const scene of scenes) {
        const box = scene.getBoundingClientRect();
        const progress = scene.dataset.scene === 'exit'
          ? clamp(-box.top / Math.max(1, box.height))
          : clamp((height - box.top) / (height * .65));
        scene.style.setProperty('--p', progress.toFixed(4));
      }
      // Keep easing the velocity back to rest after scrolling stops.
      if (Math.abs(velocity) > .002) frame = requestAnimationFrame(update);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      delete element.dataset.motion;
    };
  }, [root]);
}
