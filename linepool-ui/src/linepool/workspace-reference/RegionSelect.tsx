import { useId } from 'react';
import type { Catalog } from '../api/contracts';
import AppCombobox from '../AppCombobox';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flag } from '../showcase/shared';
import './RegionSelect.css';

type RegionSelectProps = {
  regions: Catalog['regions'];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

export default function RegionSelect({ regions, value, onValueChange, disabled }: RegionSelectProps) {
  const p = useDisplayPreferences();
  const id = useId();
  const labelId = `${id}-label`;
  return <div className="lp-shell-view-field">
    <label id={labelId} htmlFor={id}>{p.t('地区')}</label>
    <AppCombobox id={id} aria-labelledby={labelId} className="lp-purchase-region-select"
      value={value} onValueChange={onValueChange} disabled={disabled}
      options={regions.map(region => ({ value: region.id, label: `${p.t(region.name)} ${region.prefix}`, keywords: `${region.name} ${region.english} ${region.id} ${region.prefix}`,
        content: <span className="lp-region-select-label"><Flag code={region.id} className="lp-region-select-flag" /><span className="lp-region-select-name">{p.t(region.name)}</span><span className="lp-region-select-prefix">{region.prefix}</span></span>,
      }))} />
  </div>;
}
