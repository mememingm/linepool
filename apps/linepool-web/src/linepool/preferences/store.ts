export type Locale = 'zh-CN' | 'en-US';
export const languageKey = 'linepool:language';
export const legacyLanguageKey = 'linepool-welcome-language';
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function normalizeLocale(value: unknown): Locale { return value === 'en' || value === 'en-US' ? 'en-US' : 'zh-CN'; }
export function browserStorage(): PreferenceStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}
export function createLanguageStore(storage: () => PreferenceStorage | undefined = browserStorage) {
  let locale: Locale = 'zh-CN';
  let initialized = false;
  const listeners = new Set<() => void>();
  function publish(next: Locale) {
    if (locale === next) return;
    locale = next; listeners.forEach(listener => listener());
  }
  function getSnapshot() {
    if (!initialized) {
      initialized = true;
      try { const target = storage(); locale = normalizeLocale(target?.getItem(languageKey) ?? target?.getItem(legacyLanguageKey)); } catch { /* In-memory fallback. */ }
    }
    return locale;
  }
  function setLocale(value: Locale) {
    getSnapshot();
    const next = normalizeLocale(value);
    try { const target = storage(); target?.setItem(languageKey, next); target?.removeItem(legacyLanguageKey); } catch { /* Keep this tab usable when storage is denied. */ }
    publish(next);
  }
  function storageChanged(key: string | null, value: string | null) {
    getSnapshot();
    if (key === null || key === languageKey) publish(normalizeLocale(value));
    if (key === legacyLanguageKey) {
      try { if (!storage()?.getItem(languageKey)) publish(normalizeLocale(value)); } catch { /* Local preference remains authoritative. */ }
    }
  }
  return { getSnapshot, setLocale, storageChanged, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
export const languageStore = createLanguageStore();
