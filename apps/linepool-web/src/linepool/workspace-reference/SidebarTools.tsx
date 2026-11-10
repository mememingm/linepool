import { Languages, Moon, Sun } from 'lucide-react';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';

export default function SidebarTools() {
  const p = useDisplayPreferences();
  const languageLabel = p.locale === 'zh-CN' ? 'English' : '简体中文';
  const themeLabel = p.t(p.theme === 'dark' ? '深色' : '浅色');
  return <div className="lp-shell-sidebar-tools" role="group" aria-label={p.t('本机显示偏好')}>
    <div className="lp-shell-sidebar-preferences">
      <button type="button" className="lp-shell-tool-select" onClick={p.toggleLanguage} aria-label={languageLabel} title={languageLabel}><Languages size={17} strokeWidth={1.5} aria-hidden="true" /><span>{p.locale === 'en-US' ? 'English' : '中文'}</span></button>
      <button type="button" className="lp-shell-tool-select" onClick={p.toggleTheme} aria-label={p.t(p.theme === 'dark' ? '浅色模式' : '深色模式')} title={p.t(p.theme === 'dark' ? '浅色模式' : '深色模式')}>{p.theme === 'dark' ? <Moon size={17} strokeWidth={1.5} aria-hidden="true" /> : <Sun size={17} strokeWidth={1.5} aria-hidden="true" />}<span>{themeLabel}</span></button>
    </div>
  </div>;
}
