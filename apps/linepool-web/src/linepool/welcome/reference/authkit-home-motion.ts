import { gsap } from 'gsap';

type SectionMotion = {
  reveal?: gsap.core.Timeline;
  loop?: gsap.core.Timeline;
  entered: boolean;
  visible: boolean;
};

export function mountHomeMotion(root: ShadowRoot): () => void {
  const main = root.querySelector<HTMLElement>('main');
  if (!main) return () => {};
  const lifetime = new AbortController();
  let disposed = false;
  let media: gsap.MatchMedia | undefined;

  const updateDocumentVisibility = () => main.classList.toggle('reference-document-hidden', document.hidden);
  document.addEventListener('visibilitychange', updateDocumentVisibility, { signal: lifetime.signal });
  updateDocumentVisibility();

  // Wait for the reference styles before GSAP reads their existing transforms.
  const stylesReady = [...root.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => {
    if (link.sheet) return Promise.resolve();
    return new Promise<void>(resolve => {
      link.addEventListener('load', () => resolve(), { once: true, signal: lifetime.signal });
      link.addEventListener('error', () => resolve(), { once: true, signal: lifetime.signal });
    });
  });

  void Promise.all(stylesReady).then(() => {
    if (disposed) return;
    media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', context => {
      const events = new AbortController();
      const sections = new Map<Element, SectionMotion>();
      const activeClasses: Array<[Element, string]> = [];
      const elements = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
      const activate = (selector: string, className: string) => {
        elements(selector).forEach(element => {
          element.classList.add(className);
          activeClasses.push([element, className]);
        });
      };
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const motion = sections.get(entry.target);
          if (!motion) return;
          motion.visible = entry.isIntersecting;
          if (motion.visible && !motion.entered) {
            motion.entered = true;
            motion.reveal?.play(0);
          }
          motion.loop?.paused(!motion.visible || document.hidden);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
      const observe = (element: Element | null, reveal?: gsap.core.Timeline, loop?: gsap.core.Timeline) => {
        if (!element) return;
        const motion: SectionMotion = { entered: false, visible: false };
        if (reveal) motion.reveal = reveal;
        if (loop) motion.loop = loop;
        sections.set(element, motion);
        observer.observe(element);
      };
      const reveal = (selector: string, childSelector?: string) => {
        elements(selector).forEach(element => {
          const targets = childSelector ? [...element.querySelectorAll(childSelector)] : [element];
          const timeline = gsap.timeline({ paused: true });
          timeline.from(targets, {
            y: 18, autoAlpha: 0, duration: 0.65, stagger: 0.08, ease: 'power3.out',
            clearProps: 'transform,opacity,visibility',
          });
          observe(element, timeline);
        });
      };
      main.classList.add('reference-motion');

      const hero = gsap.timeline({ paused: true, defaults: { duration: 0.7, ease: 'power3.out' } });
      hero.from(elements('.hero__header'), { y: -8, autoAlpha: 0, clearProps: 'transform,opacity,visibility' }, 0)
        .from(elements('.hero__introducing'), { y: 10, autoAlpha: 0, clearProps: 'transform,opacity,visibility' }, 0.1)
        .from(elements('.linepool-wordmark'), { y: 18, autoAlpha: 0, clearProps: 'transform,opacity,visibility' }, 0.2)
        .from(elements('.hero__headline'), { y: 12, autoAlpha: 0, clearProps: 'transform,opacity,visibility' }, 0.32)
        .from(elements('.hero__cards > div'), {
          y: 26, scale: 0.96, autoAlpha: 0, stagger: { each: 0.12, from: 'center' },
          clearProps: 'transform,opacity,visibility',
        }, 0.45)
        .from(elements('.hero__light-switch'), { y: 8, autoAlpha: 0, clearProps: 'transform,opacity,visibility' }, 0.75);
      observe(root.querySelector('.hero'), hero);
      reveal('.features-slider', '.features-slider__item');
      reveal('.dashboard > .section-header, .security > .section-header, .complete > .section-header', ':scope > *');
      reveal('.customui__header-content', ':scope > *');
      reveal('.customui__card-container, .customui_colors, .customui_logos, .customui_radii, .reference-annotation');
      reveal('.security-cards', '.security-card');
      reveal('.complete-badge, .complete-button, .cta-header, .cta-actions');
      reveal('.cta-boxes', '.cta-box');

      activate('.dashboard-lines-item', 'dashboard-lines-item-active');
      activate('.dashboard-work', 'dashboard-work-active');
      activate('.dashboard-user', 'dashboard-user-active');
      activate('.dashboard-events', 'dashboard-events-active');
      activate('.dashboard-database', 'dashboard-database-active');
      const application = root.querySelector('.dashboard-application');
      const auth = root.querySelector('.dashboard-auth');
      const board = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.2 });
      board.call(() => {
        application?.classList.add('dashboard-application-active', 'dashboard-application-animate');
        auth?.classList.remove('dashboard-auth-active', 'dashboard-auth-animate');
      }, [], 0)
        .call(() => auth?.classList.add('dashboard-auth-active', 'dashboard-auth-animate'), [], 1.6)
        .call(() => application?.classList.remove('dashboard-application-active', 'dashboard-application-animate'), [], 3.4)
        .call(() => auth?.classList.remove('dashboard-auth-active', 'dashboard-auth-animate'), [], 4.6);
      const bars = elements('.dashboard-database-bars > div');
      gsap.set(bars, { height: 24, scaleY: 0.15, transformOrigin: 'center bottom', transition: 'none' });
      board.to(bars, { scaleY: index => [0.4, 0.8, 0.55, 1, 0.65, 0.9, 0.35, 0.7, 0.5][index] ?? 0.5, duration: 0.8, stagger: 0.05, ease: 'sine.inOut' }, 0.3)
        .to(bars, { scaleY: index => [0.8, 0.3, 1, 0.45, 0.9, 0.55, 0.75, 0.35, 0.65][index] ?? 0.5, duration: 1, stagger: 0.04, ease: 'sine.inOut' }, 1.8)
        .to(bars, { scaleY: 0.15, duration: 0.8, ease: 'sine.inOut' }, 3.5);
      const boardReveal = gsap.timeline({ paused: true }).from(elements('.dashboard-animation-wrapper'), {
        autoAlpha: 0, duration: 0.9, ease: 'power2.out', clearProps: 'opacity,visibility',
      });
      observe(root.querySelector('.dashboard-animation-wrapper'), boardReveal, board);

      activate('.security-leaked-border', 'security-leaked-border-active');
      const ownership = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.8 });
      ownership.to(elements('.security-leaked-text'), { opacity: 1, duration: 0.4 }, 0)
        .fromTo(elements('.security-leaked-radar-item'), { x: 0 }, { x: index => index === 0 ? 358 : -358, duration: 2.2, ease: 'power1.inOut' }, 0)
        .to(elements('.security-leaked-text'), { opacity: 0.15, duration: 0.3 }, 1)
        .fromTo(elements('.security-leaked-check img'), { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.08, ease: 'power2.out' }, 1.1)
        .to(elements('.security-leaked-check img'), { autoAlpha: 0, duration: 0.3 }, 3);
      observe(root.querySelector('.security-leaked'), undefined, ownership);

      const period = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.8 });
      period.fromTo(elements('.security-rbac__card'), { xPercent: 0, x: -124 }, { x: 90, duration: 1, ease: 'power2.inOut' }, 0)
        .to(elements('.security-rbac__card-light'), { autoAlpha: 0.8, duration: 0.35 }, 0.7)
        .to(elements('.security-rbac__display, .security-rbac__button-shape'), { opacity: 1, duration: 0.35, stagger: 0.08 }, 0.85)
        .to(elements('.security-rbac__card-light'), { autoAlpha: 0, duration: 0.4 }, 2)
        .to(elements('.security-rbac__card'), { x: -124, duration: 0.8, ease: 'power2.inOut' }, 2.1)
        .to(elements('.security-rbac__display, .security-rbac__button-shape'), { opacity: 0.4, duration: 0.4 }, 2.4);
      observe(root.querySelector('.security-rbac'), undefined, period);

      activate('.security-password-border', 'security-password-border-active');
      const passwordBars = elements('.security-password-bars-item > div');
      gsap.set(passwordBars, { width: '100%', opacity: 1, scaleX: 0, transformOrigin: 'left center', transition: 'none' });
      const code = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.6 });
      code.fromTo(elements('.security-password-text img'), { y: 22 }, { y: -62, duration: 1.8, ease: 'steps(3)' }, 0)
        .to(passwordBars, { scaleX: 1, duration: 0.35, stagger: 0.3, ease: 'power2.out' }, 0.3)
        .to(passwordBars, { scaleX: 0, duration: 0.4, stagger: 0.06 }, 2.5);
      observe(root.querySelector('.security-password'), undefined, code);

      activate('.security-multi-box-inputs-item', 'security-multi-box-inputs-item-active');
      const records = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.5 });
      records.fromTo(elements('.security-multi-box-inputs-item > div'), { autoAlpha: 0, scale: 0.4 }, {
        autoAlpha: 1, scale: 1, duration: 0.3, stagger: 0.18, ease: 'power2.out',
      }, 0)
        .to(elements('.security-multi-box-inputs-item > div'), { autoAlpha: 0, duration: 0.3, stagger: 0.08 }, 2.6);
      observe(root.querySelector('.security-multi'), undefined, records);

      const badges = elements('.complete-badge');
      const flow = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.2 });
      badges.forEach((badge, index) => {
        flow.call(() => badges.forEach(item => item.classList.toggle('reference-step-active', item === badge)), [], index * 0.85);
      });
      flow.call(() => badges.forEach(item => item.classList.remove('reference-step-active')), [], badges.length * 0.85);
      const progress = elements('.complete-user-progress');
      gsap.set(progress, { height: 20, scaleY: 0.2, transformOrigin: 'center bottom', transition: 'none' });
      flow.to(progress, { scaleY: 1, duration: 0.6, stagger: 0.2, repeat: 1, yoyo: true, ease: 'sine.inOut' }, 0.7);
      observe(root.querySelector('.complete-inner'), undefined, flow);

      root.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLElement>('[data-period]');
        if (!button) return;
        context.add(() => {
          gsap.fromTo(button, { scale: 0.94 }, { scale: 1, duration: 0.28, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform' });
          if (button.dataset.period) {
            gsap.fromTo(elements('[data-selected-period]'), { y: 4, autoAlpha: 0.4 }, {
              y: 0, autoAlpha: 1, duration: 0.25, overwrite: 'auto', clearProps: 'transform,opacity,visibility',
            });
          }
        });
      }, { signal: events.signal });

      const pauseHiddenLoops = () => sections.forEach(motion => motion.loop?.paused(document.hidden || !motion.visible));
      document.addEventListener('visibilitychange', pauseHiddenLoops, { signal: events.signal });
      return () => {
        observer.disconnect();
        events.abort();
        main.classList.remove('reference-motion');
        activeClasses.forEach(([element, className]) => element.classList.remove(className));
        application?.classList.remove('dashboard-application-active', 'dashboard-application-animate');
        auth?.classList.remove('dashboard-auth-active', 'dashboard-auth-animate');
        badges.forEach(badge => badge.classList.remove('reference-step-active'));
      };
    });
    media.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
      const events = new AbortController();
      root.querySelectorAll<HTMLElement>('.hero__card').forEach(card => {
        const rotateX = gsap.quickTo(card, 'rotationX', { duration: 0.45, ease: 'power2.out' });
        const rotateY = gsap.quickTo(card, 'rotationY', { duration: 0.45, ease: 'power2.out' });
        card.addEventListener('pointermove', event => {
          const bounds = card.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          rotateX(gsap.utils.clamp(-2, 2, (0.5 - (event.clientY - bounds.top) / bounds.height) * 4));
          rotateY(gsap.utils.clamp(-3, 3, ((event.clientX - bounds.left) / bounds.width - 0.5) * 6));
        }, { signal: events.signal });
        card.addEventListener('pointerleave', () => { rotateX(0); rotateY(0); }, { signal: events.signal });
        card.addEventListener('focusout', () => { rotateX(0); rotateY(0); }, { signal: events.signal });
      });
      return () => events.abort();
    });
  });

  return () => {
    disposed = true;
    lifetime.abort();
    media?.revert();
    main.classList.remove('reference-document-hidden');
  };
}
