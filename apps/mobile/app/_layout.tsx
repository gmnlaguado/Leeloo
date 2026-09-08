import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Raleway_400Regular,
  Raleway_600SemiBold,
  Raleway_700Bold,
} from '@expo-google-fonts/raleway';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';
import { useAuthStore } from '@/store/auth';
import { setClerkTokenGetter, setClerkUserId, setClerkSignOut } from '@/lib/clerkAuth';
import { VoiceConfirmationModal } from '@/components/VoiceConfirmationModal';
import { useSettingsStore } from '@/store/settings';
import type { SupportedLanguage } from '@/store/settings';
import { registerForPushNotificationsAsync } from '@/services/push.service';
import {
  registerWakeWordDetection,
  unregisterWakeWordDetection,
  subscribeWakeWord,
  pauseWakeWord,
  resumeWakeWord,
} from '@/services/wake-word.service';
import { useVoiceStore } from '@/store/voice';
import type { PendingReminder } from '@/store/voice';
import { tasksAPI } from '@/lib/api';
import { deviceLogger } from '@/services/device-logger';

// Activar logging ANTES de cualquier render — captura errores de Clerk desde el primer ms
deviceLogger.init();

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

// ─── Notification strings per language ───
const NOTIF = {
  en: {
    postpone_btn:     '⏱ Snooze 10 min',
    done_btn:         '✅ Done',
    marked_done:      'Done, marked as complete.',
    could_not_mark:   "Couldn't mark it, try from the app.",
    snoozed:          "Ok, I'll remind you in 10 minutes.",
    could_not_snooze: "Couldn't snooze, try from the app.",
    speech_lang:      'en-US',
  },
  es: {
    postpone_btn:     '⏱ Posponer 10 min',
    done_btn:         '✅ Listo',
    marked_done:      'Listo, marcado como completado.',
    could_not_mark:   'No pude marcarlo, intenta desde la app.',
    snoozed:          'Ok, te recuerdo en 10 minutos.',
    could_not_snooze: 'No pude posponer, intenta desde la app.',
    speech_lang:      'es-ES',
  },
  pt: {
    postpone_btn:     '⏱ Adiar 10 min',
    done_btn:         '✅ Feito',
    marked_done:      'Pronto, marcado como concluído.',
    could_not_mark:   'Não consegui marcar, tente no app.',
    snoozed:          'Ok, te lembro em 10 minutos.',
    could_not_snooze: 'Não consegui adiar, tente no app.',
    speech_lang:      'pt-BR',
  },
  fr: {
    postpone_btn:     '⏱ Reporter 10 min',
    done_btn:         '✅ Terminé',
    marked_done:      "C'est fait, marqué comme terminé.",
    could_not_mark:   "Je n'ai pas pu le marquer, essayez dans l'app.",
    snoozed:          'Ok, je te rappelle dans 10 minutes.',
    could_not_snooze: "Je n'ai pas pu reporter, essayez dans l'app.",
    speech_lang:      'fr-FR',
  },
} as const satisfies Record<SupportedLanguage, { postpone_btn: string; done_btn: string; marked_done: string; could_not_mark: string; snoozed: string; could_not_snooze: string; speech_lang: string }>;

const getNotif = () => NOTIF[useSettingsStore.getState().language] ?? NOTIF.en;

// ─── Register action categories (Snooze / Done) ───
async function registerNotificationCategories(lang: SupportedLanguage = 'en') {
  try {
    const s = NOTIF[lang] ?? NOTIF.en;
    await Notifications.setNotificationCategoryAsync('reminder', [
      {
        identifier: 'postpone_10',
        buttonTitle: s.postpone_btn,
        options: { isDestructive: false, isAuthenticationRequired: false },
      },
      {
        identifier: 'mark_done',
        buttonTitle: s.done_btn,
        options: { isDestructive: false, isAuthenticationRequired: false },
      },
    ]);
  } catch (e) {
    console.warn('[Leeloo] setNotificationCategoryAsync error:', String(e));
  }
}

// AsyncStorage avoids Android Keystore hangs on MIUI 14 (SecureStore deadlocks on that device).
const tokenCache = {
  async getToken(key: string) {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {}
  },
  async clearToken(key: string) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {}
  },
};

// Clerk requires EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to be baked into the bundle at build time.
// The hardcoded fallback ensures dev builds work without .env.
const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? 'pk_live_Y2xlcmsubGVlbG9vLnVzJA';

function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { getToken, userId, isSignedIn, isLoaded, signOut } = useAuth();
  const setSession = useAuthStore((state) => state.setSession);
  const language = useSettingsStore((s) => s.language);

  useEffect(() => {
    deviceLogger.log('ClerkBridge: auth state changed', { isLoaded, isSignedIn, hasUserId: Boolean(userId) });
  }, [isLoaded, isSignedIn, userId]);

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
      void registerForPushNotificationsAsync().catch(() => {});
      void registerNotificationCategories(language).catch((e) => {
        console.warn('[Leeloo] registerNotificationCategories failed:', String(e));
      });
    }
  }, [isSignedIn, userId, language]);

  // Wake word detection
  useEffect(() => {
    if (!isSignedIn) return;
    void registerWakeWordDetection();
    const unsub = subscribeWakeWord(() => {
      const { isListening, isProcessing } = useVoiceStore.getState();
      if (!isListening && !isProcessing) {
        void useVoiceStore.getState().startListeningFromWakeWord();
      }
    });
    return () => {
      unsub();
      void unregisterWakeWordDetection();
    };
  }, [isSignedIn]);

  // Foreground notification: speak via TTS + open mic for voice response
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      const speakText = typeof data?.speak_text === 'string' ? data.speak_text : null;
      const taskId = typeof data?.task_id === 'string' ? data.task_id : null;
      const kind = typeof data?.kind === 'string' ? data.kind : null;

      if (!speakText) return;

      const isReminder = kind === 'task_reminder' || kind === 'calendar_reminder';
      const n = getNotif();

      pauseWakeWord();
      Speech.speak(speakText, {
        language: n.speech_lang,
        rate: 0.95,
        onDone: () => {
          resumeWakeWord();
          if (isReminder && taskId) {
            const reminder: PendingReminder = {
              taskId,
              title: typeof data?.title === 'string' ? data.title : '',
            };
            setTimeout(() => {
              const { isListening, isProcessing } = useVoiceStore.getState();
              if (!isListening && !isProcessing) {
                useVoiceStore.getState().setPendingReminder(reminder);
                void useVoiceStore.getState().startListening();
              }
            }, 800);
          }
        },
        onStopped: () => resumeWakeWord(),
        onError: () => resumeWakeWord(),
      });
    });
    return () => sub.remove();
  }, []);

  // Handle action button taps (Snooze / Done) + default tap (speak + open mic)
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const action = response.actionIdentifier;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const taskId = typeof data?.task_id === 'string' ? data.task_id : null;
      const speakText = typeof data?.speak_text === 'string' ? data.speak_text : null;
      const n = getNotif();

      // Default tap: user taps the notification body — speak and open mic
      if (action === Notifications.DEFAULT_ACTION_IDENTIFIER && speakText) {
        pauseWakeWord();
        Speech.speak(speakText, {
          language: n.speech_lang,
          rate: 0.95,
          onDone: () => {
            resumeWakeWord();
            setTimeout(() => {
              const { isListening, isProcessing } = useVoiceStore.getState();
              if (!isListening && !isProcessing) {
                void useVoiceStore.getState().startListening();
              }
            }, 600);
          },
          onStopped: () => resumeWakeWord(),
          onError: () => resumeWakeWord(),
        });
        return;
      }

      if (action === 'mark_done' && taskId) {
        try {
          await tasksAPI.updateTask(taskId, { status: 'done' });
          Speech.speak(n.marked_done, { language: n.speech_lang });
        } catch {
          Speech.speak(n.could_not_mark, { language: n.speech_lang });
        }
      }

      if (action === 'postpone_10' && taskId) {
        try {
          const newDue = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          await tasksAPI.updateTask(taskId, { due_at: newDue });
          Speech.speak(n.snoozed, { language: n.speech_lang });
        } catch {
          Speech.speak(n.could_not_snooze, { language: n.speech_lang });
        }
      }
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

// Ping both backend services on every app launch so they wake up from Render
// Starter cold sleep BEFORE the user types anything. Fire-and-forget.
function warmupBackends() {
  const api = process.env.EXPO_PUBLIC_API_URL ?? 'https://leeloo-api-55i5.onrender.com';
  const ai  = process.env.EXPO_PUBLIC_AI_ORCHESTRATOR_URL ?? 'https://leeloo-ai.onrender.com';
  const stt = process.env.EXPO_PUBLIC_STT_URL ?? 'https://leeloo-stt.onrender.com';
  // AbortSignal.timeout() is not available in all Hermes versions — plain fetch is safe here.
  // leeloo-stt handles wake word STT — warm it up so the first wake attempt isn't delayed 30s.
  [api, ai, stt].forEach((base) => {
    fetch(`${base}/health`).catch(() => {});
  });
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Raleway_400Regular, Raleway_600SemiBold, Raleway_700Bold });

  useEffect(() => {
    warmupBackends();
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  deviceLogger.log('RootLayout mounting', { publishableKey: CLERK_PUBLISHABLE_KEY?.slice(0, 20) + '...' });
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <QueryClientProvider client={queryClient}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="sso-callback" />
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
