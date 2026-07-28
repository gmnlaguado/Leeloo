import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clerkSignOut } from '@/lib/clerkAuth';

/**
 * Auth store — Clerk is the source of truth for sessions.
 * `setSession` is invoked from app/_layout.tsx (ClerkBridge) with a minimal
 * { userId } shape. Components only need to know if there's a logged-in user.
 */
export type ClerkSessionLike = { userId: string } | null;

interface AuthState {
  session: ClerkSessionLike;
  hasCompletedOnboarding: boolean;
  setSession: (session: ClerkSessionLike) => void;
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
    try {
      // Revokes the Clerk session and clears the cached JWT from SecureStore.
      // Without this, the token survives in SecureStore and silently
      // re-authenticates the user on next launch.
      await clerkSignOut();
    } finally {
      set({ session: null });
    }
  },
}));
