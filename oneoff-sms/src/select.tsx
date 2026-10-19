import { useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { gsap, useGSAP } from './motion';

type Option = { value: string; label: string; disabled?: boolean; keywords?: string[] };
export function SelectField({ label, value, options, onChange, icon, disabled = false }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; icon?: ReactNode; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value);
  useGSAP(() => {
    if (!open || !content) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(content, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: .16, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
    });
    return () => media.revert();
  }, { dependencies: [open, content], revertOnUpdate: true });
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button ref={trigger} type="button" className="select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? list?.id : undefined} aria-label={label} disabled={disabled} onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); }
    }}>{icon}<span>{selected?.label ?? label}</span><ChevronDown size={15} className="select-chevron" /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content ref={setContent} aria-label={`${label}菜单`} className="select-popover" align="start" sideOffset={6} collisionPadding={12} avoidCollisions>
      <Command label={`搜索${label}`} defaultValue={value} loop>
        <div className="select-search"><Search size={15} /><Command.Input aria-label={`搜索${label}`} placeholder="搜索选项…" /></div>
        <Command.List ref={setList} label={`${label}选项`} className="select-options">
          <Command.Empty className="select-empty">没有匹配的选项</Command.Empty>
          {options.map(option => <Command.Item key={option.value} value={option.value} keywords={[option.label, ...(option.keywords ?? [])]} disabled={option.disabled} className="select-option" onSelect={() => { onChange(option.value); setOpen(false); }}>
            <span>{option.label}</span>{value === option.value && <Check size={15} className="option-check" />}
          </Command.Item>)}
        </Command.List>
      </Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
