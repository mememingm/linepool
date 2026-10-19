import { describe, expect, it } from 'vitest';
import { createLanguageStore, languageKey, legacyLanguageKey, normalizeLocale, type PreferenceStorage } from '../../src/linepool/preferences/store';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  return { storage, values };
}

describe('language preference store', () => {
  it('normalizes supported values and falls back to Simplified Chinese', () => {
    expect(normalizeLocale('en')).toBe('en-US');
    expect(normalizeLocale('en-US')).toBe('en-US');
    expect(normalizeLocale('fr')).toBe('zh-CN');
    expect(normalizeLocale(null)).toBe('zh-CN');
  });

  it('reads the legacy welcome key without writing private data', () => {
    const { storage, values } = memoryStorage({ [legacyLanguageKey]: 'en' });
    const store = createLanguageStore(() => storage);
    expect(store.getSnapshot()).toBe('en-US');
    expect(values.get(languageKey)).toBeUndefined();
    expect([...values.keys()]).toEqual([legacyLanguageKey]);
  });

  it('persists only the local locale and notifies subscribers', () => {
    const { storage, values } = memoryStorage();
    const store = createLanguageStore(() => storage);
    const updates: string[] = [];
    const unsubscribe = store.subscribe(() => updates.push(store.getSnapshot()));
    store.setLocale('en-US');
    expect(values.get(languageKey)).toBe('en-US');
    expect(values.has(legacyLanguageKey)).toBe(false);
    expect(updates).toEqual(['en-US']);
    unsubscribe();
    store.setLocale('zh-CN');
    expect(updates).toEqual(['en-US']);
  });

  it('prefers the canonical key and removes the legacy key on a local change', () => {
    const { storage, values } = memoryStorage({ [languageKey]: 'zh-CN', [legacyLanguageKey]: 'en' });
    const store = createLanguageStore(() => storage);
    expect(store.getSnapshot()).toBe('zh-CN');
    store.storageChanged(legacyLanguageKey, 'en');
    expect(store.getSnapshot()).toBe('zh-CN');
    store.setLocale('en-US');
    expect(values.has(legacyLanguageKey)).toBe(false);
    expect(values.get(languageKey)).toBe('en-US');
  });

  it('stays usable when storage is absent or throws', () => {
    const failing: PreferenceStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    for (const storage of [undefined, failing]) {
      const store = createLanguageStore(() => storage);
      expect(store.getSnapshot()).toBe('zh-CN');
      store.setLocale('en-US');
      expect(store.getSnapshot()).toBe('en-US');
    }
  });

  it('ignores unrelated storage keys and handles canonical removal/clear events', () => {
    const { storage } = memoryStorage({ [languageKey]: 'en-US' });
    const store = createLanguageStore(() => storage);
    store.storageChanged('unrelated', 'zh-CN');
    expect(store.getSnapshot()).toBe('en-US');
    store.storageChanged(languageKey, null);
    expect(store.getSnapshot()).toBe('zh-CN');
    store.setLocale('en-US');
    store.storageChanged(null, null);
    expect(store.getSnapshot()).toBe('zh-CN');
  });

  it('accepts cross-tab storage changes without exposing arbitrary values', () => {
    const { storage } = memoryStorage({ [languageKey]: 'zh-CN' });
    const store = createLanguageStore(() => storage);
    const updates: string[] = [];
    store.subscribe(() => updates.push(store.getSnapshot()));
    store.storageChanged(languageKey, 'en-US');
    store.storageChanged(languageKey, 'private-token');
    expect(store.getSnapshot()).toBe('zh-CN');
    expect(updates).toEqual(['en-US', 'zh-CN']);
  });
});
