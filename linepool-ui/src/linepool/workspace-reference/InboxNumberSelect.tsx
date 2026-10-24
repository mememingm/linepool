import { Smartphone } from 'lucide-react';
import type { AssignedNumber, Catalog } from '../api/contracts';
import AppCombobox from '../AppCombobox';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import { Flag } from '../showcase/shared';
import './InboxNumberSelect.css';

type InboxNumberSelectProps = {
  numbers: AssignedNumber[];
  regions: Catalog['regions'];
  value: string;
  onValueChange: (value: string) => void;
};

export default function InboxNumberSelect({ numbers, regions, value, onValueChange }: InboxNumberSelectProps) {
  const p = useDisplayPreferences();
  const regionMap = new Map(regions.map(region => [region.id, region]));
  const selected = numbers.find(number => (number.allocationId ?? number.id) === value || number.id === value);
  const options = [{ value: '', label: p.t('全部号码'), keywords: '', triggerContent: p.t('全部号码'),
    content: <><span className="lp-inbox-number-icon"><Smartphone size={17} /></span><span className="lp-inbox-number-copy"><strong>{p.t('全部号码')}</strong><small>{p.t('{count} 个号码', { count: p.n(numbers.length) })}</small></span></> },
    ...numbers.map(number => ({ value: number.allocationId ?? number.id, label: `${number.phoneNumber} · ${p.t(number.country)} · ${number.service}`,
      keywords: `${number.phoneNumber} ${number.phoneNumber.replace(/\D/g, '')} ${number.region} ${number.country} ${p.t(number.country)} ${regionMap.get(number.region)?.english ?? ''} ${number.service}`.toLowerCase(),
      triggerContent: number.phoneNumber,
      content: <><span className="lp-inbox-number-icon"><Flag code={number.region} /></span><span className="lp-inbox-number-copy"><strong>{number.phoneNumber}</strong><small>{number.region.toUpperCase()} · {number.service}</small></span></>,
    }))];
  return <AppCombobox value={selected?.allocationId ?? value} onValueChange={onValueChange} options={options}
    className="lp-inbox-number-trigger" menuClassName="lp-inbox-number-menu"
    aria-label={`${p.t('短信号码')}：${selected ? `${selected.phoneNumber} · ${p.t(selected.country)} · ${selected.service}` : p.t('全部号码')}`}
    prefix={<Smartphone size={15} aria-hidden="true" />} searchPlaceholder={p.t('搜索尾号、国家或服务')}
    emptyMessage={p.t('暂无符合条件的号码')}
    match={(option, query) => {
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return !terms.length || (option.value !== '' && terms.every(term => (option.keywords ?? '').includes(term.replace(/[()+.-]/g, ''))));
    }} />;
}
