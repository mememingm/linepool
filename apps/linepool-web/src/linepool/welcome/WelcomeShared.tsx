import { useEffect, useState } from 'react';
import { Languages, Moon, Sun } from 'lucide-react';
import { useDisplayPreferences } from '../preferences/useDisplayPreferences';
import './welcome.css';

// Keep the existing welcome component contract while sharing the live preference.
export const useWelcomePreferences = useDisplayPreferences;
export type WelcomePreferences = ReturnType<typeof useWelcomePreferences>;

export function PreferenceControls({ preferences: p }: { preferences: WelcomePreferences }) {
  return <div className="lp-welcome-preferences">
    <button type="button" onClick={p.toggleLanguage} title={p.language === 'zh' ? 'Switch to English' : '切换到中文'} aria-label={p.language === 'zh' ? 'Switch to English' : '切换到中文'}><Languages size={16} /><span>{p.language === 'zh' ? 'EN' : '中文'}</span></button>
    <button type="button" onClick={p.toggleTheme} title={p.theme === 'dark' ? p.t('浅色模式') : p.t('深色模式')} aria-label={p.theme === 'dark' ? p.t('浅色模式') : p.t('深色模式')}>{p.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
  </div>;
}

export function OriginalScene() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return <div className="lp-welcome-scene" aria-hidden="true">{reduced
    ? <img src="/login-scene/still.png" alt="" />
    : <iframe src="/login-scene/scene.html" title="" tabIndex={-1} sandbox="allow-scripts" referrerPolicy="no-referrer" />}</div>;
}
