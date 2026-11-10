import { useEffect, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { dateLabel, monthLabel, numberLabel, translate, type Values } from '../i18n/format';
import { browserStorage, languageStore, type Locale } from './store';

export function useDisplayPreferences() {
  const locale = useSyncExternalStore(languageStore.subscribe, languageStore.getSnapshot, () => 'zh-CN' as Locale);
  const { theme: selectedTheme, resolvedTheme, setTheme } = useTheme();
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === null || event.storageArea === browserStorage()) languageStore.storageChanged(event.key, event.newValue);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const t = (source: string, values?: Values) => translate(source, locale, values);
  return {
    locale, language: locale === 'en-US' ? 'en' : 'zh', theme, selectedTheme: selectedTheme ?? 'system',
    setLocale: languageStore.setLocale, setTheme,
    toggleLanguage: () => languageStore.setLocale(locale === 'en-US' ? 'zh-CN' : 'en-US'),
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    t, n: (value: number, options?: Intl.NumberFormatOptions) => numberLabel(value, locale, options),
    date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => dateLabel(value, locale, options),
    month: (value: string, year = true) => monthLabel(value, locale, year),
    copyLabels: { busy: t('复制中…'), done: t('已复制'), success: t('复制成功'), error: t('复制失败，请手动复制') },
  };
}
export type DisplayPreferences = ReturnType<typeof useDisplayPreferences>;
