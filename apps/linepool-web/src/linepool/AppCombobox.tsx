import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { SelectOption } from './SelectField';
import { useDisplayPreferences } from './preferences/useDisplayPreferences';
import './SelectField.css';
import './FormControls.css';

export type ComboboxOption = SelectOption & { keywords?: string; triggerContent?: ReactNode };
type AppComboboxProps = Pick<ComponentProps<'button'>, 'id' | 'className' | 'aria-label' | 'aria-labelledby'> & {
  value: string;
  options: readonly ComboboxOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  prefix?: ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  menuClassName?: string;
  match?: (option: ComboboxOption, query: string) => boolean;
};

/** Radix shadcn/ui Combobox pattern. Filtering never reorders caller options. */
export default function AppCombobox({ value, options, onValueChange, disabled, prefix, placeholder, searchPlaceholder, emptyMessage, menuClassName = '', match, className = '', ...props }: AppComboboxProps) {
  const p = useDisplayPreferences();
  const id = useId();
  const emptyValue = `${id}-empty`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const [container, setContainer] = useState<HTMLElement>();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closingWithTab = useRef(false);
  const selected = options.find(option => option.value === value);
  const visible = options.filter(option => match ? match(option, query) : `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  function changeOpen(next: boolean) {
    if (next) {
      setQuery(''); setActive(value || emptyValue); closingWithTab.current = false;
      setContainer(trigger.current?.closest('dialog') ?? undefined);
    }
    setOpen(next);
  }
  function changeQuery(next: string) { setQuery(next); setActive(''); }
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button {...props} ref={trigger} type="button" variant="outline" role="combobox" aria-expanded={open}
        disabled={disabled} className={`lp-select-trigger lp-combobox-trigger ${className}`} data-theme={p.theme} lang={p.locale}
        title={selected?.label} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); changeOpen(true); }
        }}>
        {prefix && <span className="lp-select-prefix" aria-hidden="true">{prefix}</span>}
        <span className="lp-select-value">{selected?.triggerContent ?? selected?.content ?? selected?.label ?? placeholder}</span>
        <ChevronDown size={16} className="lp-select-chevron" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent container={container} className={`lp-select-menu lp-combobox-menu ${menuClassName}`} data-theme={p.theme} lang={p.locale}
      align="start" sideOffset={6} collisionPadding={12} hideWhenDetached
      onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}
      onCloseAutoFocus={event => { if (closingWithTab.current) { event.preventDefault(); closingWithTab.current = false; } }}
      onEscapeKeyDown={event => { if (event.isComposing) event.preventDefault(); }}>
      <Command shouldFilter={false} value={active} onValueChange={setActive} className="lp-combobox-command" label={props['aria-label'] ?? placeholder}
        onKeyDownCapture={event => {
          // cmdk handles arrows and Enter; preserve IME composition and native Tab order.
          if (event.nativeEvent.isComposing && ['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation();
          if (event.key === 'Tab') { closingWithTab.current = true; setOpen(false); trigger.current?.focus(); }
        }}>
        <div className="lp-combobox-search">
          <CommandInput ref={input} value={query} onValueChange={changeQuery} autoComplete="off"
            aria-label={searchPlaceholder ?? p.t('搜索')} placeholder={searchPlaceholder ?? p.t('搜索')} />
          {query && <button type="button" className="lp-combobox-clear" aria-label={p.t('清空搜索')}
            onClick={() => { changeQuery(''); input.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
        </div>
        <CommandList className="lp-select-scroll lp-combobox-list" aria-label={props['aria-label'] ?? placeholder}>
          <CommandEmpty className="lp-combobox-empty" role="status">{emptyMessage ?? p.t('暂无符合条件的选项')}</CommandEmpty>
          {visible.map(option => <CommandItem key={option.value} value={option.value || emptyValue} disabled={option.disabled}
            className="lp-select-option lp-combobox-option" data-checked={option.value === value || undefined}
            aria-label={option.label} title={option.label}
            onSelect={() => { if (option.value !== value) onValueChange(option.value); setOpen(false); }}>
            <span className="lp-combobox-option-content">{option.content ?? option.label}</span>
            {option.value === value && <Check size={16} className="lp-select-check" aria-hidden="true" />}
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
