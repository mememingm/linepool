import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import markup from './reference/authkit-home.html?raw';
import overrides from './reference/authkit-home-overrides.css?raw';
import sharedStyles from './welcome.css?raw';
import { mountHomeMotion } from './reference/authkit-home-motion';
import { PreferenceControls, useWelcomePreferences } from './WelcomeShared';

function mountCards(root: ShadowRoot) {
  const cards = [...root.querySelectorAll<HTMLElement>('.hero__cards > div')];
  const navigation = document.createElement('div');
  navigation.className = 'reference-card-navigation';
  const selectors = cards.map((card, index) => {
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    const title = card.querySelector('.hero__card-header p')?.textContent ?? '';
    card.setAttribute('aria-label', title);
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = title; button.dataset.heroSelect = String(index);
    navigation.append(button);
    return button;
  });
  root.querySelector('.hero__cards')?.append(navigation);
  let active = 1;
  function select(index: number) {
    active = index;
    cards.forEach((card, position) => {
      const slot = (position - active + cards.length) % cards.length;
      card.dataset.cardSlot = slot === 0 ? 'front' : slot === 1 ? 'right' : 'left';
      card.style.zIndex = slot === 0 ? '3' : '1';
      card.setAttribute('aria-current', String(slot === 0));
      selectors[position]?.setAttribute('aria-pressed', String(slot === 0));
      card.querySelectorAll<HTMLElement>('a, button').forEach(control => {
        if (slot === 0) control.removeAttribute('tabindex'); else control.tabIndex = -1;
      });
    });
  }
  select(active);
  const events = new AbortController();
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const selector = event.target.closest<HTMLElement>('[data-hero-select]');
    const card = event.target.closest<HTMLElement>('.hero__cards > div[data-card-slot]');
    const index = selector ? Number(selector.dataset.heroSelect) : card ? cards.indexOf(card) : -1;
    if (index < 0 || (!selector && index === active)) return;
    event.preventDefault(); event.stopImmediatePropagation(); select(index);
  }, { capture: true, signal: events.signal });
  root.addEventListener('keydown', event => {
    const keyboard = event as KeyboardEvent;
    if (!cards.includes(event.target as HTMLElement)) return;
    if (keyboard.key === 'Enter' || keyboard.key === ' ') { event.preventDefault(); select(cards.indexOf(event.target as HTMLElement)); }
    else if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowRight') {
      event.preventDefault();
      const next = (active + (keyboard.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length;
      select(next); cards[next]?.focus();
    }
  }, { signal: events.signal });
  return () => events.abort();
}

export default function WelcomePage() {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const [controls, setControls] = useState<HTMLElement | null>(null);
  const sources = useRef<Array<{ node: Text; source: string }>>([]);
  const attributes = useRef<Array<{ element: Element; name: string; source: string }>>([]);
  const preferences = useWelcomePreferences();
  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<link rel="stylesheet" href="/authkit-reference/0l0q6~h79kzc..css"><link rel="stylesheet" href="/authkit-reference/0kn7kgyjdnxlm.css"><style>${sharedStyles}\n${overrides}</style>${markup}`;
    const stopCards = mountCards(shadow);
    const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
    sources.current = []; attributes.current = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.parentElement?.closest('style') && node.textContent?.trim()) sources.current.push({ node, source: node.textContent });
    }
    shadow.querySelectorAll('*').forEach(element => {
      for (const name of ['aria-label', 'title', 'data-mobile-title']) {
        const source = element.getAttribute(name);
        if (source) attributes.current.push({ element, name, source });
      }
    });
    const container = document.createElement('div');
    container.className = 'reference-preferences';
    shadow.querySelector('.hero__powered-by')?.append(container);
    setControls(container); setRoot(shadow);
    const events = new AbortController();
    shadow.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-period]');
      if (!button) return;
      shadow.querySelectorAll('[data-period]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      const selected = shadow.querySelector('[data-selected-period]');
      if (selected) selected.textContent = host.current?.lang.startsWith('en') ? `${button.dataset.period} month${button.dataset.period === '1' ? '' : 's'}` : `${button.dataset.period} 个月`;
    }, { signal: events.signal });
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.classList.toggle('reference-in-view', entry.isIntersecting);
      entry.target.querySelector<HTMLElement>('.features-slider__items')?.style.setProperty('--play-state', entry.isIntersecting ? 'running' : 'paused');
    }), { rootMargin: '100px' });
    shadow.querySelectorAll('.hero, .features-slider, .dashboard, .customui, .security, .complete, .cta').forEach(el => observer.observe(el));
    const stopMotion = mountHomeMotion(shadow);
    const title = document.title;
    document.title = 'LINEPOOL · 号码与短信服务';
    return () => { stopCards(); stopMotion(); events.abort(); observer.disconnect(); document.title = title; };
  }, []);
  useEffect(() => {
    if (!root) return;
    for (const { node, source } of sources.current) node.textContent = preferences.t(source);
    for (const { element, name, source } of attributes.current) element.setAttribute(name, preferences.t(source));
    root.querySelectorAll('.hero__card').forEach(card => card.classList.toggle('light', preferences.theme === 'light'));
    const period = root.querySelector<HTMLElement>('[data-period][aria-pressed="true"]')?.dataset.period ?? '1';
    const selected = root.querySelector('[data-selected-period]');
    if (selected) selected.textContent = preferences.t('{months} 个月', { months: period });
    document.title = `LINEPOOL · ${preferences.t('号码与短信服务')}`;
  }, [root, preferences.language, preferences.theme]);
  return <div className="lp-welcome-page"><div ref={host} className="authkit-home" data-theme={preferences.theme} lang={preferences.locale} />{controls && createPortal(<PreferenceControls preferences={preferences} />, controls)}</div>;
}
