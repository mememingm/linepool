import { useId, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useDisplayPreferences } from './preferences/useDisplayPreferences';
import './SelectField.css';

export type SelectOption = {
  value: string;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
};

type SelectFieldProps = Pick<ComponentPropsWithoutRef<typeof SelectTrigger>, 'id' | 'className' | 'aria-label' | 'aria-labelledby' | 'aria-details'> & {
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  prefix?: ReactNode;
  align?: 'start' | 'end';
};

/** Presentation adapter: caller values, including an empty "all" value, stay unchanged. */
export default function SelectField({ value, options, onValueChange, disabled, prefix, align = 'start', className = '', ...triggerProps }: SelectFieldProps) {
  const p = useDisplayPreferences();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>();
  // Radix reserves an empty item value. Keep this sentinel out of business state.
  const emptyValue = `${useId()}-empty`;
  return <Select value={value === '' ? emptyValue : value} disabled={disabled}
    onOpenChange={open => { if (open) setPortalContainer(trigger.current?.closest('dialog') ?? undefined); }}
    onValueChange={next => onValueChange(next === emptyValue ? '' : next)}>
    <SelectTrigger ref={trigger} {...triggerProps} className={`lp-select-trigger ${className}`} data-theme={p.theme} lang={p.locale}>
      {prefix && <span className="lp-select-prefix" aria-hidden="true">{prefix}</span>}
      <span className="lp-select-value"><SelectValue /></span>
    </SelectTrigger>
    <SelectContent container={portalContainer} viewportClassName="lp-select-viewport lp-select-scroll"
      className="lp-select-menu" data-theme={p.theme} lang={p.locale}
      aria-label={triggerProps['aria-label']} aria-labelledby={triggerProps['aria-labelledby']}
      position="popper" align={align} sideOffset={6} collisionPadding={12} hideWhenDetached>
      {options.map(option => <SelectItem key={option.value} value={option.value === '' ? emptyValue : option.value}
        textValue={option.label} disabled={option.disabled} className="lp-select-option" title={option.label}>
        {option.content ?? option.label}
      </SelectItem>)}
    </SelectContent>
  </Select>;
}
