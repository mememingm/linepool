import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, Smartphone, X } from 'lucide-react';
import type { AssignedNumber, Catalog } from '../api/contracts';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flag } from '../showcase/shared';
import '../SelectField.css';
import './InboxNumberSelect.css';

type InboxNumberSelectProps = {
  numbers: AssignedNumber[];
  regions: Catalog['regions'];
  value: string;
  onValueChange: (value: string) => void;
};

export default function InboxNumberSelect({ numbers, regions, value, onValueChange }: InboxNumberSelectProps) {
  const p = useDisplayPreferences();
  const id = useId();
  const listId = `${id}-numbers`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closingWithTab = useRef(false);
  const regionMap = new Map(regions.map(region => [region.id, region]));
  const numberOptions = numbers.map(number => {
    const region = regionMap.get(number.region);
    const digits = number.phoneNumber.replace(/\D/g, '');
    const phone = number.phoneNumber;
    const meta = `${number.region.toUpperCase()} · ${number.service}`;
    return {
      value: number.id, phone, meta, region: number.region,
      label: `${number.phoneNumber} · ${p.t(number.country)} · ${number.service}`,
      searchText: `${number.phoneNumber} ${digits} ${phone} ${number.region} ${number.country} ${p.t(number.country)} ${region?.english ?? ''} ${number.service}`.toLowerCase(),
    };
  });
  const selected = numberOptions.find(option => option.value === value);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const options = [
    { value: '', phone: p.t('全部号码'), meta: p.t('{count} 个号码', { count: p.n(numbers.length) }), region: '', label: p.t('全部号码'), searchText: '' },
    ...numberOptions,
  ].filter(option => !terms.length || (option.value !== '' && terms.every(term => option.searchText.includes(term.replace(/[()+.-]/g, '')))));
  const preferredValue = highlightedValue ?? (terms.length ? options[0]?.value : value);
  const activeIndex = Math.max(0, options.findIndex(option => option.value === preferredValue));
  const active = options[activeIndex];
  const activeId = active ? `${listId}-${active.value || 'all'}` : undefined;

  useEffect(() => {
    if (open && activeId) {
      list.current?.querySelector<HTMLElement>(`[id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeId]);

  function changeOpen(next: boolean) {
    if (next) { setQuery(''); setHighlightedValue(value); closingWithTab.current = false; }
    setOpen(next);
  }
  function choose(next: string) { if (next !== value) onValueChange(next); setOpen(false); }
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.length) {
        const next = Math.max(0, Math.min(options.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        setHighlightedValue(options[next].value);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active) choose(active.value);
    } else if (event.key === 'Tab') {
      // Let the native Tab move from the trigger to the adjacent toolbar control,
      // rather than continuing from the portal at the end of the document.
      closingWithTab.current = true;
      setOpen(false);
      trigger.current?.focus();
    }
  }

  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger asChild>
      <button ref={trigger} type="button" className="lp-select-trigger lp-inbox-number-trigger" data-theme={p.theme} lang={p.locale}
        aria-label={`${p.t('短信号码')}：${selected?.label ?? p.t('全部号码')}`}
        title={selected?.label}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); changeOpen(true); }
        }}>
        <Smartphone size={15} aria-hidden="true" />
        <span>{selected?.phone ?? p.t('全部号码')}</span>
        <span className="lp-select-chevron"><ChevronDown size={16} aria-hidden="true" /></span>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="lp-select-menu lp-inbox-number-menu" data-theme={p.theme} lang={p.locale} aria-label={p.t('短信号码')}
        sideOffset={6} align="start" collisionPadding={12}
        onOpenAutoFocus={event => {
          event.preventDefault();
          search.current?.focus();
          // The portal mounts after the root's open effect. Scroll again here,
          // once its list is attached, so the current selection stays visible.
          if (activeId) list.current?.querySelector<HTMLElement>(`[id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
        }}
        onCloseAutoFocus={event => { if (closingWithTab.current) { event.preventDefault(); closingWithTab.current = false; } }}
        onEscapeKeyDown={event => { if (event.isComposing) event.preventDefault(); }}>
        <div className="lp-inbox-number-search">
          <Search size={15} aria-hidden="true" />
          <input ref={search} role="combobox" aria-label={p.t('搜索号码、地区或服务')}
            aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId}
            placeholder={p.t('搜索尾号、国家或服务')} value={query} autoComplete="off"
            onKeyDown={onSearchKeyDown} onChange={event => { setQuery(event.target.value); setHighlightedValue(null); }} />
          {query && <button type="button" tabIndex={-1} aria-label={p.t('清空搜索')} onClick={() => { setQuery(''); setHighlightedValue(value); search.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
        </div>
        <div ref={list} id={listId} role="listbox" aria-label={p.t('短信号码')} className="lp-select-scroll lp-inbox-number-list">
          {options.map(option => <div id={`${listId}-${option.value || 'all'}`} key={option.value || 'all'}
            role="option" aria-selected={option.value === value} aria-label={option.label} title={option.label}
            className="lp-select-option lp-inbox-number-option" data-highlighted={option.value === active?.value || undefined}
            onPointerMove={event => { if (event.pointerType === 'mouse') setHighlightedValue(option.value); }}
            onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }}
            onClick={() => choose(option.value)}>
            <span className="lp-inbox-number-icon">{option.region ? <Flag code={option.region} /> : <Smartphone size={17} aria-hidden="true" />}</span>
            <span className="lp-inbox-number-copy"><strong>{option.phone}</strong><small>{option.meta}</small></span>
            {option.value === value && <Check size={16} className="lp-select-check lp-inbox-number-check" aria-hidden="true" />}
          </div>)}
        </div>
        {!options.length && <div className="lp-inbox-number-empty" role="status"><strong>{p.t('暂无符合条件的号码')}</strong><span>{p.t('请尝试其他尾号、国家或服务')}</span></div>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
