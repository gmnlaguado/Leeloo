import { create } from 'zustand';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  session: Session | null;
  hasCompletedOnboarding: boolean;
  setSession: (session: Session | null) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  hasCompletedOnboarding: false,

  setSession: (session) => set({ session }),

  setHasCompletedOnboarding: async (value) => {
    await AsyncStorage.setItem('hasCompletedOnboarding', String(value));
    set({ hasCompletedOnboarding: value });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null });
  },
}));
