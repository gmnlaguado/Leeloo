import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/store/auth';
import { setClerkTokenGetter, setClerkUserId, setClerkSignOut } from '@/lib/clerkAuth';
import { VoiceConfirmationModal } from '@/components/VoiceConfirmationModal';
import { registerForPushNotificationsAsync } from '@/services/push.service';

const queryClient = new QueryClient();

const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return await SecureStore.setItemAsync(key, value);
    } catch {
      return undefined;
    }
  },
};

const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || '';

function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { getToken, userId, isSignedIn, signOut } = useAuth();
  const setSession = useAuthStore((state) => state.setSession);

  useEffect(() => {
    setClerkTokenGetter(() => getToken({ template: undefined as any }).catch(() => null));
    setClerkUserId(userId ?? null);
    setClerkSignOut(() => signOut());
    setSession(isSignedIn && userId ? ({ userId } as any) : null);
    return () => {
      setClerkTokenGetter(null);
      setClerkUserId(null);
      setClerkSignOut(null);
    };
  }, [getToken, userId, isSignedIn, signOut, setSession]);

  useEffect(() => {
    if (isSignedIn && userId) {
      void registerForPushNotificationsAsync();
    }
  }, [isSignedIn, userId]);

  return <>{children}</>;
}

export default function RootLayout() {
  if (!CLERK_PUBLISHABLE_KEY) {
    console.warn(
      '[RootLayout] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing — Clerk auth will not work.',
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <QueryClientProvider client={queryClient}>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="settings/personality" options={{ presentation: 'modal' }} />
            </Stack>
            <VoiceConfirmationModal />
            <StatusBar style="auto" />
          </QueryClientProvider>
        </GestureHandlerRootView>
      </ClerkBridge>
    </ClerkProvider>
  );
}
