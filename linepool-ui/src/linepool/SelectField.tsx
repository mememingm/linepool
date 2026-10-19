import { useId, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useDisplayPreferences } from './preferences/useDisplayPreferences';
import './SelectField.css';

export type SelectOption = {
  value: string;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
};

type SelectFieldProps = Pick<ComponentPropsWithoutRef<typeof Select.Trigger>, 'id' | 'className' | 'aria-label' | 'aria-labelledby' | 'aria-details'> & {
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  prefix?: ReactNode;
  align?: 'start' | 'end';
};

/** Shared presentation only: caller values, including an empty "all" value, stay unchanged. */
export default function SelectField({ value, options, onValueChange, disabled, prefix, align = 'start', className = '', ...triggerProps }: SelectFieldProps) {
  const p = useDisplayPreferences();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | undefined>();
  // Radix reserves an empty item value. Keep this adapter-local sentinel out of business state.
  const emptyValue = `${useId()}-empty`;
  return <Select.Root value={value === '' ? emptyValue : value} disabled={disabled}
    onOpenChange={open => { if (open) setPortalContainer(trigger.current?.closest('dialog') ?? undefined); }}
    onValueChange={next => onValueChange(next === emptyValue ? '' : next)}>
    <Select.Trigger ref={trigger} {...triggerProps} className={`lp-select-trigger ${className}`} data-theme={p.theme} lang={p.locale}>
      {prefix && <span className="lp-select-prefix" aria-hidden="true">{prefix}</span>}
      <span className="lp-select-value"><Select.Value /></span>
      <Select.Icon className="lp-select-chevron"><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={portalContainer}>
      <Select.Content className="lp-select-menu" data-theme={p.theme} lang={p.locale}
        aria-label={triggerProps['aria-label']} aria-labelledby={triggerProps['aria-labelledby']}
        position="popper" align={align} sideOffset={6} collisionPadding={12} hideWhenDetached>
        <Select.Viewport className="lp-select-viewport lp-select-scroll">
          {options.map(option => <Select.Item key={option.value} value={option.value === '' ? emptyValue : option.value}
            textValue={option.label} disabled={option.disabled} className="lp-select-option" title={option.label}>
            <Select.ItemText className="lp-select-item-text">{option.content ?? option.label}</Select.ItemText>
            <Select.ItemIndicator className="lp-select-check"><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
