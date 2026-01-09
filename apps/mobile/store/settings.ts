import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr';

interface SettingsState {
  language: SupportedLanguage;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
}

const STORAGE_KEY = 'settings.language';

export const useSettingsStore = create<SettingsState>((set, get) => ({
  language: 'es',
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const lang = (stored || '').toLowerCase();
      if (lang === 'es' || lang === 'en' || lang === 'pt' || lang === 'fr') {
        set({ language: lang as SupportedLanguage, hydrated: true });
        return;
      }
    } catch {
      // ignore
    }

    set({ hydrated: true });
  },

  setLanguage: async (language) => {
    await AsyncStorage.setItem(STORAGE_KEY, language);
    set({ language });
  },
}));
