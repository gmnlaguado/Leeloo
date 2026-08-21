import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';
import { useAuthStore } from '@/store/auth';
import { setClerkTokenGetter, setClerkUserId, setClerkSignOut } from '@/lib/clerkAuth';
import { VoiceConfirmationModal } from '@/components/VoiceConfirmationModal';
import { registerForPushNotificationsAsync } from '@/services/push.service';
import {
  registerWakeWordDetection,
  unregisterWakeWordDetection,
  subscribeWakeWord,
} from '@/services/wake-word.service';
import { useVoiceStore } from '@/store/voice';
import type { PendingReminder } from '@/store/voice';
import { tasksAPI } from '@/lib/api';

const queryClient = new QueryClient();

// ─── Background notification handler (fires when app is killed/background) ───
const NOTIFICATION_TASK = 'LEELOO_NOTIFICATION_HANDLER';

TaskManager.defineTask(
  NOTIFICATION_TASK,
  async ({ data, error }: { data: any; error: TaskManager.TaskManagerError | null }) => {
    if (error) return;
    const kind = data?.notification?.request?.content?.data?.kind;
    console.log('[Leeloo] background notification received', { kind });
  },
);

// ─── Foreground notification config ───
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Register action categories (Posponer / Listo) ───
async function registerNotificationCategories() {
  await Notifications.setNotificationCategoryAsync('reminder', [
    {
      identifier: 'postpone_10',
      buttonTitle: '⏱ Posponer 10 min',
      options: { isDestructive: false, isAuthenticationRequired: false },
    },
    {
      identifier: 'mark_done',
      buttonTitle: '✅ Listo',
      options: { isDestructive: false, isAuthenticationRequired: false },
    },
  ]);
}

// SecureStore can hang indefinitely on MIUI/Xiaomi — always race with a 3s fallback.
const secureGet = (key: string) =>
  Promise.race([
    SecureStore.getItemAsync(key),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);

const tokenCache = {
  async getToken(key: string) {
    try {
      return await secureGet(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {}
  },
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
  },
};

// Publishable keys are public by design — safe to embed in source.
// Custom domain: clerk.leeloo.us
const CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsubGVlbG9vLnVzJA';

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
      void registerNotificationCategories();
    }
  }, [isSignedIn, userId]);

  // Wake word detection
  useEffect(() => {
    if (!isSignedIn) return;
    void registerWakeWordDetection();
    const unsub = subscribeWakeWord(() => {
      const { isListening, isProcessing } = useVoiceStore.getState();
      if (!isListening && !isProcessing) {
        void useVoiceStore.getState().startListening();
      }
    });
    return () => {
      unsub();
      void unregisterWakeWordDetection();
    };
  }, [isSignedIn]);

  // Foreground notification: speak via TTS + abrir micrófono para respuesta por voz
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      const speakText = typeof data?.speak_text === 'string' ? data.speak_text : null;
      const taskId = typeof data?.task_id === 'string' ? data.task_id : null;
      const kind = typeof data?.kind === 'string' ? data.kind : null;

      if (!speakText) return;

      const isReminder = kind === 'task_reminder' || kind === 'calendar_reminder';

      Speech.speak(speakText, {
        language: 'es',
        rate: 0.95,
        onDone: () => {
          // Después de hablar, si es recordatorio, activa el micrófono automáticamente
          if (isReminder && taskId) {
            const reminder: PendingReminder = {
              taskId,
              title: typeof data?.title === 'string' ? data.title : '',
            };
            // 800ms de pausa para que el usuario se prepare
            setTimeout(() => {
              const { isListening, isProcessing } = useVoiceStore.getState();
              if (!isListening && !isProcessing) {
                useVoiceStore.getState().setPendingReminder(reminder);
                void useVoiceStore.getState().startListening();
              }
            }, 800);
          }
        },
      });
    });
    return () => sub.remove();
  }, []);

  // Handle action button taps (Posponer / Listo)
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const action = response.actionIdentifier;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const taskId = typeof data?.task_id === 'string' ? data.task_id : null;

      if (action === 'mark_done' && taskId) {
        try {
          await tasksAPI.updateTask(taskId, { status: 'done' });
          Speech.speak('Listo, marcado como completado.', { language: 'es' });
        } catch {
          Speech.speak('No pude marcarlo, intenta desde la app.', { language: 'es' });
        }
      }

      if (action === 'postpone_10' && taskId) {
        try {
          const newDue = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          await tasksAPI.updateTask(taskId, { due_at: newDue });
          Speech.speak('Ok, te recuerdo en 10 minutos.', { language: 'es' });
        } catch {
          Speech.speak('No pude posponer, intenta desde la app.', { language: 'es' });
        }
      }
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <QueryClientProvider client={queryClient}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="settings/personality" options={{ presentation: 'modal' }} />
              <Stack.Screen name="settings/integrations" options={{ presentation: 'modal' }} />
            </Stack>
            <VoiceConfirmationModal />
            <StatusBar style="auto" />
          </QueryClientProvider>
        </GestureHandlerRootView>
      </ClerkBridge>
    </ClerkProvider>
  );
}
