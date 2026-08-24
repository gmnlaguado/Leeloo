import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import * as Localization from 'expo-localization';

export type SupportedLanguage = 'es' | 'en' | 'pt' | 'fr';

const SUPPORTED: SupportedLanguage[] = ['en', 'es', 'pt', 'fr'];
const STORAGE_KEY = 'settings.language';

// Map device locale (BCP-47 language tag) → SupportedLanguage.
// Falls back to 'en' for any unrecognized locale (US market default).
function detectDeviceLanguage(): SupportedLanguage {
  try {
    const locales = Localization.getLocales();
    for (const locale of locales) {
      const code = (locale.languageCode ?? '').toLowerCase();
      if (SUPPORTED.includes(code as SupportedLanguage)) {
        return code as SupportedLanguage;
      }
    }
  } catch {
    // expo-localization unavailable (web, old SDK) — fall through
  }
  return 'en';
}

interface SettingsState {
  language: SupportedLanguage;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  language: 'en', // US market default
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const lang = (stored || '').toLowerCase();
      if (SUPPORTED.includes(lang as SupportedLanguage)) {
        // User has previously chosen a language — respect it
        set({ language: lang as SupportedLanguage, hydrated: true });
        return;
      }
    } catch {
      // AsyncStorage unavailable — fall through to device detection
    }

    // First launch: auto-detect from device locale and persist it
    const detected = detectDeviceLanguage();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, detected);
    } catch {
      // ignore write failure
    }
    set({ language: detected, hydrated: true });
  },

  setLanguage: async (language) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore
    }
    set({ language });
  },
}));
