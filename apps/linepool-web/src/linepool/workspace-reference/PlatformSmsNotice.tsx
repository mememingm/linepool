import { Info } from 'lucide-react';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import './PlatformSmsNotice.css';

export default function PlatformSmsNotice() {
  const p = useDisplayPreferences();
  return <aside className="lp-platform-sms-notice" role="note"><Info size={18} aria-hidden="true" /><div><strong>{p.t('平台接码说明')}</strong><p>{p.t('号码仅能接收已购买平台的验证码，其他平台的验证码无法接收。如需接收其他平台的验证码，请先购买对应平台的服务。')}</p></div></aside>;
}
