import { Languages, Moon, Sun } from 'lucide-react';
import { useDisplayPreferences } from './useDisplayPreferences';
import SelectField from '../SelectField';
import './DisplayControls.css';

export function DisplayToolbar() {
  const p = useDisplayPreferences();
  const languageLabel = p.locale === 'zh-CN' ? 'English' : '简体中文';
  const themeLabel = p.t(p.theme === 'dark' ? '浅色模式' : '深色模式');
  return <div className="lp-display-toolbar" role="group" aria-label={p.t('本机显示偏好')}>
    <button type="button" title={languageLabel} aria-label={languageLabel} onClick={p.toggleLanguage}><Languages size={17} /><span>{p.language === 'en' ? 'EN' : '中文'}</span></button>
    <button type="button" title={themeLabel} aria-label={themeLabel} onClick={p.toggleTheme}>{p.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
  </div>;
}

export function DisplaySettings() {
  const p = useDisplayPreferences();
  return <section className="lp-display-settings" aria-labelledby="lp-display-title">
    <h2 id="lp-display-title">{p.t('本机显示偏好')}</h2>
    <label className="lp-shell-view-setting"><span><strong>{p.t('账户语言')}</strong></span><SelectField aria-label={p.t('账户语言')} value={p.locale} onValueChange={value => p.setLocale(value === 'en-US' ? 'en-US' : 'zh-CN')} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} /></label>
    <label className="lp-shell-view-setting"><span><strong>{p.t('主题')}</strong></span><SelectField aria-label={p.t('主题')} value={p.selectedTheme} onValueChange={p.setTheme} options={[{ value: 'light', label: p.t('浅色模式') }, { value: 'dark', label: p.t('深色模式') }, { value: 'system', label: p.t('系统') }]} /></label>
  </section>;
}
