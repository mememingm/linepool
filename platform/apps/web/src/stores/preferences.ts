import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ThemePreference = 'light' | 'dark';
export type LanguagePreference = 'zh' | 'en';

const STORAGE_KEY = 'linepool.preferences';

function readPreferences(): {
  theme: ThemePreference;
  language: LanguagePreference;
} {
  const fallback = { theme: 'light' as const, language: 'zh' as const };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<typeof fallback> | null;
    return {
      theme: stored?.theme === 'dark' ? 'dark' : 'light',
      language: stored?.language === 'en' ? 'en' : 'zh',
    };
  } catch {
    return fallback;
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  const initial = readPreferences();
  const theme = ref<ThemePreference>(initial.theme);
  const language = ref<LanguagePreference>(initial.language);
  const isEnglish = computed(() => language.value === 'en');

  function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: theme.value,
      language: language.value,
    }));
    document.documentElement.dataset.theme = theme.value;
    document.documentElement.lang = language.value === 'en' ? 'en' : 'zh-CN';
  }

  function setTheme(value: ThemePreference): void {
    theme.value = value;
    persist();
  }

  function setLanguage(value: LanguagePreference): void {
    language.value = value;
    persist();
  }

  persist();
  return { theme, language, isEnglish, setTheme, setLanguage };
});
