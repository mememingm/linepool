import { useRef, type ComponentProps, type ReactNode } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group';
import { useDisplayPreferences } from './preferences/useDisplayPreferences';
import './FormControls.css';

type AppSearchInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'size'> & {
  value: string;
  onValueChange: (value: string) => void;
  loading?: boolean;
  children?: ReactNode;
  inputClassName?: string;
};

/** Controlled presentation only. Search timing, requests and filters belong to the caller. */
export default function AppSearchInput({ value, onValueChange, loading = false, className = '', inputClassName, children, disabled, ...props }: AppSearchInputProps) {
  const p = useDisplayPreferences();
  const input = useRef<HTMLInputElement>(null);
  return <InputGroup className={`lp-search-input ${className}`} data-theme={p.theme} data-disabled={disabled || undefined} aria-busy={loading}>
    <InputGroupInput {...props} ref={input} type={props.type ?? 'search'} disabled={disabled}
      className={inputClassName} value={value} onChange={event => onValueChange(event.target.value)} />
    <InputGroupAddon><Search size={16} aria-hidden="true" /></InputGroupAddon>
    {(value || loading || children) && <InputGroupAddon align="inline-end">
      {loading && <LoaderCircle className="lp-control-spinner" size={16} role="status" aria-label={p.t('正在加载')} />}
      {value && <InputGroupButton size="icon-xs" disabled={disabled} aria-label={p.t('清空搜索')} title={p.t('清空搜索')}
        onClick={() => { onValueChange(''); input.current?.focus(); }}><X size={14} aria-hidden="true" /></InputGroupButton>}
      {children}
    </InputGroupAddon>}
  </InputGroup>;
}
