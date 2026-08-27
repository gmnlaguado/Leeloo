import { create } from 'zustand';
import { Audio } from 'expo-av';
import { Linking, Platform } from 'react-native';
import type { AVPlaybackStatus } from 'expo-av';
import type { AudioMode } from 'expo-av';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { voiceAPI, profilesAPI, tasksAPI } from '@/lib/api';
import { deviceLogger } from '@/services/device-logger';
import { useSettingsStore } from '@/store/settings';

const getProfileOpts = async (): Promise<{ personality?: string; user_name?: string }> => {
  try {
    const res = await profilesAPI.getMe();
    const p = (res?.data as Record<string, unknown> | null) ?? {};
    return {
      personality: typeof p.leeloo_personality === 'string' ? p.leeloo_personality : undefined,
      user_name: typeof p.leeloo_name === 'string' ? p.leeloo_name : undefined,
    };
  } catch {
    return {};
  }
};

type VoiceStatus = 'idle' | 'recording' | 'processing' | 'speaking' | 'awaiting_confirmation' | 'wake_activated';

type MemoryItem = {
  id: string;
  content: string;
  category: string;
  created_at: string;
};

type VoiceResponse = {
  ok: boolean;
  status?: 'awaiting_confirmation' | 'completed' | 'error';
  assistant_text?: string;
  tts_audio?: string | null;
  intent?: string;
  slots?: Record<string, string>;
};

type RawVoiceApiResponse = VoiceResponse & {
  transcription?: string;
  text?: string;
  input_text?: string;
  response?: string;
  response_text?: string;
  reply?: string;
  message?: string;
  tts?: { audio_base64?: string };
  response_audio_url?: string;
  audio_url?: string;
  audioUrl?: string;
  tts_url?: string;
  action?: {
    provider?: string;
    phone_number?: string;
    contact_name?: string;
    [key: string]: unknown;
  };
};

export type { VoiceStatus, MemoryItem, VoiceResponse };

const speakTextAndWait = async (text: string, language?: string) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return;

  try {
    Speech.stop();
  } catch {
    // ignore
  }

  await new Promise<void>((resolve) => {
    try {
      Speech.speak(trimmed, {
        language: language || undefined,
        rate: 0.95,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    } catch {
      resolve();
    }

    setTimeout(() => resolve(), 45000);
  });
};

const playAudioUrl = async (uri: string) => {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    } as AudioMode);
  } catch {
    // ignore
  }

  const { sound } = await Audio.Sound.createAsync({ uri });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const settleOnce = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          const s = status as AVPlaybackStatus;
          const errMsg =
            'error' in s && typeof (s as unknown as { error?: unknown }).error === 'string'
              ? String((s as unknown as { error?: string }).error)
              : 'Audio not loaded';
          deviceLogger.log('[voice] sound status error', { errMsg });
          settleOnce(() => reject(new Error(errMsg)));
          return;
        }

        if ('didJustFinish' in status && status.didJustFinish) {
          settleOnce(() => resolve());
        }
      });

      sound.playAsync().catch((e) => {
        deviceLogger.log('[voice] playAsync error', { err: String(e) });
        settleOnce(() => reject(e));
      });

      // Safety timeout
      setTimeout(() => settleOnce(() => resolve()), 45000);
    });
  } finally {
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
  }
};

export interface PendingReminder {
  taskId: string;
  title: string;
}

// Local keyword matching — cero tokens
export function matchReminderResponse(text: string): 'done' | 'postpone' | number | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
  if (/\b(listo|hecho|ok|ya lo hice|completado|ya|done)\b/.test(t)) return 'done';
  const minMatch = t.match(/(\d+)\s*(min|minuto|minutos)/);
  if (minMatch) return parseInt(minMatch[1], 10);
  if (/\b(posponer|despues|luego|mas tarde|postpone|después|después|espera)\b/.test(t)) return 10;
  return null;
}

interface VoiceState {
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  isWakeActivated: boolean;
  status: VoiceStatus;
  transcription: string;
  response: string;
  lastError: string | null;
  awaitingConfirmation: boolean;
  pendingConfirmationText: string;
  pendingOriginalText: string;
  pendingReminder: PendingReminder | null;
  pendingEventId: string | null;
  pendingAttendeeName: string | null;
  startListening: () => Promise<void>;
  startListeningFromWakeWord: () => Promise<void>;
  stopListening: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
  setProcessing: (value: boolean) => void;
  setTranscription: (text: string) => void;
  setResponse: (text: string) => void;
  setPendingReminder: (r: PendingReminder | null) => void;
  reset: () => void;
  _recording: Audio.Recording | null;
  _silenceTimer: ReturnType<typeof setInterval> | null;
}

// Silence VAD constants — tuned to feel like Alexa
const SILENCE_THRESHOLD_DB = -45;   // below this = silence
const SILENCE_DURATION_MS  = 1500;  // 1.5s of silence → auto-stop
const MAX_RECORD_MS        = 30000; // hard cap 30s
const METERING_INTERVAL_MS = 150;   // poll rate

export const useVoiceStore = create<VoiceState>((set, get) => ({
  isListening: false,
  isProcessing: false,
  isSpeaking: false,
  isWakeActivated: false,
  status: 'idle',
  transcription: '',
  response: '',
  lastError: null,
  awaitingConfirmation: false,
  pendingConfirmationText: '',
  pendingOriginalText: '',
  pendingReminder: null,
  pendingEventId: null,
  pendingAttendeeName: null,
  _recording: null,
  _silenceTimer: null,

  startListening: async () => {
    try {
      set({ lastError: null });
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        set({ lastError: 'Microphone permission denied.' });
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      } as AudioMode);

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();

      set({ isListening: true, status: 'recording', _recording: recording });
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      set({ lastError: typeof msg === 'string' ? msg : 'Failed to start recording.' });
    }
  },

  startListeningFromWakeWord: async () => {
    try {
      set({ lastError: null });
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        set({ lastError: 'Microphone permission denied.' });
        return;
      }

      // Haptic chime — signals Leeloo is listening (replaces Alexa's tone)
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch { /* device may not support haptics */ }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      } as AudioMode);

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await recording.startAsync();

      set({
        isListening: true,
        isWakeActivated: true,
        status: 'wake_activated',
        _recording: recording,
      });

      // VAD — auto-stop on silence (Alexa-style: stops when user finishes speaking)
      let silenceMs = 0;
      const startedAt = Date.now();

      const timer = setInterval(async () => {
        try {
          const state = useVoiceStore.getState();
          if (!state.isListening) {
            clearInterval(timer);
            set({ _silenceTimer: null });
            return;
          }

          if (Date.now() - startedAt >= MAX_RECORD_MS) {
            clearInterval(timer);
            set({ _silenceTimer: null, isWakeActivated: false });
            await useVoiceStore.getState().stopListening();
            return;
          }

          const recStatus = await recording.getStatusAsync();
          const db =
            recStatus.isRecording && 'metering' in recStatus
              ? ((recStatus as unknown as { metering?: number }).metering ?? 0)
              : 0;

          if (db < SILENCE_THRESHOLD_DB) {
            silenceMs += METERING_INTERVAL_MS;
            if (silenceMs >= SILENCE_DURATION_MS) {
              clearInterval(timer);
              set({ _silenceTimer: null, isWakeActivated: false });
              await useVoiceStore.getState().stopListening();
            }
          } else {
            silenceMs = 0;
          }
        } catch {
          clearInterval(timer);
          set({ _silenceTimer: null, isWakeActivated: false });
        }
      }, METERING_INTERVAL_MS);

      set({ _silenceTimer: timer });
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      set({
        lastError: typeof msg === 'string' ? msg : 'Failed to start wake word recording.',
        isWakeActivated: false,
      });
    }
  },

  stopListening: async () => {
    let uri: string | null = null;

    try {
      const recording = useVoiceStore.getState()._recording;
      set({ isListening: false, status: 'processing', _recording: null, lastError: null });

      if (!recording) return;

      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
      if (!uri) {
        set({ lastError: 'No audio captured.' });
        return;
      }

      set({ isProcessing: true });
      const language = useSettingsStore.getState().language;

      // Si hay un recordatorio pendiente, intentamos matching local primero (cero tokens)
      const reminder = useVoiceStore.getState().pendingReminder;
      if (reminder) {
        const sttRes = await voiceAPI.processVoice(uri, { language, wakeWordOnly: true });
        const sttData = (sttRes?.data ?? {}) as Record<string, unknown>;
        const transcribed = typeof sttData.transcription === 'string' ? sttData.transcription : '';
        const match = matchReminderResponse(transcribed);
        if (match !== null) {
          set({ pendingReminder: null, transcription: transcribed });
          if (match === 'done') {
            await tasksAPI.updateTask(reminder.taskId, { status: 'done' });
            const reply = 'Listo, marcado como completado.';
            set({ response: reply, status: 'idle' });
            await speakTextAndWait(reply, language);
          } else {
            const mins = typeof match === 'number' ? match : 10;
            const newDue = new Date(Date.now() + mins * 60 * 1000).toISOString();
            await tasksAPI.updateTask(reminder.taskId, { due_at: newDue });
            const reply = `Ok, te recuerdo ${reminder.title} en ${mins} minutos.`;
            set({ response: reply, status: 'idle' });
            await speakTextAndWait(reply, language);
          }
          set({ isProcessing: false });
          return;
        }
        // No coincidió — caemos al flujo normal con el audio ya grabado
      }

      const profileOpts = await getProfileOpts();
      const res = await voiceAPI.processVoice(uri, { language, ...profileOpts });
      const data = (res?.data ?? {}) as RawVoiceApiResponse;

      const transcription = data.transcription ?? data.text ?? data.input_text ?? '';
      const assistantText =
        data.assistant_text ?? data.response ?? data.reply ?? data.message ?? '';
      const status = data.status ?? 'ok';

      if (status === 'awaiting_confirmation') {
        set({
          transcription,
          response: assistantText,
          awaitingConfirmation: true,
          pendingConfirmationText: assistantText,
          status: 'awaiting_confirmation',
        });
      } else {
        set({
          transcription,
          response: assistantText,
          awaitingConfirmation: false,
          status: 'idle',
        });
      }

      const audioBase64 = data?.tts?.audio_base64 || null;
      const audioUrl =
        data.response_audio_url ?? data.audio_url ?? data.audioUrl ?? data.tts_url ?? null;
      let played = false;

      if (audioBase64 && typeof audioBase64 === 'string') {
        if (Platform.OS === 'android') {
          // Android MediaPlayer rejects data: URIs — write to a temp file and play from path.
          let tmpPath: string | null = null;
          try {
            tmpPath = `${FileSystem.cacheDirectory}leeloo_tts_${Date.now()}.mp3`;
            await FileSystem.writeAsStringAsync(tmpPath, audioBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await playAudioUrl(tmpPath);
            played = true;
          } catch (err) {
            deviceLogger.log('[voice] android tts file playback failed', { err: String(err) });
          } finally {
            if (tmpPath) {
              FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
            }
          }
        } else {
          try {
            const dataUri = `data:audio/mpeg;base64,${audioBase64}`;
            await playAudioUrl(dataUri);
            played = true;
          } catch (err) {
            deviceLogger.log('[voice] audio(base64) playback failed', { err: String(err) });
          }
        }
      }

      if (audioUrl && typeof audioUrl === 'string') {
        try {
          await playAudioUrl(audioUrl);
          played = true;
        } catch (err) {
          console.log('[voice] audio playback failed:', String(err));
        }
      }

      if (!played) {
        set({ isSpeaking: true, status: 'speaking' });
        await speakTextAndWait(assistantText, language);
        set({ isSpeaking: false, status: 'idle' });
      }

      // Open native phone dialer when Leeloo resolved a call intent
      if (data.action?.provider === 'phone' && typeof data.action?.phone_number === 'string') {
        const tel = `tel:${data.action.phone_number}`;
        Linking.openURL(tel).catch(() => {
          console.log('[voice] could not open phone dialer for', tel);
        });
      }
    } catch (e: unknown) {
      const err = e as {
        response?: { status?: unknown; data?: unknown };
        message?: unknown;
      };
      const status = err?.response?.status;
      const data = err?.response?.data;
      const msg = typeof err?.message === 'string' ? err.message : 'Voice request failed.';

      if (typeof status === 'number') {
        const asObj = (val: unknown): { message?: unknown; error?: unknown } | null => {
          if (!val || typeof val !== 'object') return null;
          return val as { message?: unknown; error?: unknown };
        };

        let detail = typeof data === 'string' ? data : '';
        if (!detail) {
          const o = asObj(data);
          const msg = o?.message;
          const errMsg = o?.error;
          detail =
            (typeof msg === 'string' && msg) ||
            (typeof errMsg === 'string' && errMsg) ||
            JSON.stringify(data);
        }

        const isHtml =
          typeof detail === 'string' &&
          (detail.includes('<!DOCTYPE html') ||
            detail.includes('<html') ||
            detail.includes('<head>'));

        if (isHtml) {
          detail =
            'The voice service is temporarily unavailable (upstream error). Please try again in a few seconds.';
        }

        if (typeof detail === 'string' && detail.length > 800) {
          detail = `${detail.slice(0, 800)}…`;
        }

        set({ lastError: `HTTP ${status}: ${detail}` });
        await speakTextAndWait(
          'The voice service is temporarily unavailable. Please try again.',
          useSettingsStore.getState().language,
        );
      } else if (msg === 'Network Error') {
        set({
          lastError:
            'Network Error (audio upload): puede ser multipart en Expo Go o timeout. Verifica que el backend siga vivo y que el teléfono y PC estén en la misma red. Si sigue pasando, intenta de nuevo: ya cambiamos el upload a fetch para estabilizar.',
        });
        await speakTextAndWait(
          'Network error. Please try again.',
          useSettingsStore.getState().language,
        );
      } else {
        set({ lastError: msg });
        await speakTextAndWait(
          'Something went wrong. Please try again.',
          useSettingsStore.getState().language,
        );
      }
    } finally {
      set({ isProcessing: false });
      if (useVoiceStore.getState().status !== 'awaiting_confirmation') {
        set({ status: 'idle' });
      }
    }
  },

  sendText: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      set({
        isProcessing: true,
        status: 'processing',
        lastError: null,
        transcription: trimmed,
        pendingOriginalText: trimmed,
      });
      const language = useSettingsStore.getState().language;
      const profileOpts = await getProfileOpts();

      let res: Awaited<ReturnType<typeof voiceAPI.processText>>;
      try {
        res = await voiceAPI.processText(trimmed, { language, ...profileOpts });
      } catch (firstErr: unknown) {
        const isNet = (firstErr as { message?: string })?.message === 'Network Error';
        const isTimeout = (firstErr as { code?: string })?.code === 'ECONNABORTED';
        if (isNet || isTimeout) {
          set({ lastError: language === 'es' ? 'Leeloo se está despertando, un momento...' : 'Leeloo is waking up, one moment...' });
          await new Promise((r) => setTimeout(r, 8000));
          res = await voiceAPI.processText(trimmed, { language, ...profileOpts });
        } else {
          throw firstErr;
        }
      }
      const data = (res?.data ?? {}) as RawVoiceApiResponse;

      const assistantText =
        data.assistant_text ?? data.response ?? data.reply ?? data.message ?? '';
      const status = data.status ?? 'ok';

      if (status === 'awaiting_confirmation') {
        set({
          response: assistantText,
          awaitingConfirmation: true,
          pendingConfirmationText: assistantText,
          status: 'awaiting_confirmation',
        });
      } else {
        set({ response: assistantText, awaitingConfirmation: false, status: 'idle' });
      }

      const audioBase64 = data?.tts?.audio_base64 || null;
      const audioUrl =
        data.response_audio_url ?? data.audio_url ?? data.audioUrl ?? data.tts_url ?? null;
      let played = false;

      if (audioBase64 && typeof audioBase64 === 'string') {
        if (Platform.OS === 'android') {
          // Android MediaPlayer rejects data: URIs — write to a temp file and play from path.
          let tmpPath: string | null = null;
          try {
            tmpPath = `${FileSystem.cacheDirectory}leeloo_tts_${Date.now()}.mp3`;
            await FileSystem.writeAsStringAsync(tmpPath, audioBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await playAudioUrl(tmpPath);
            played = true;
          } catch (err) {
            deviceLogger.log('[voice] android tts file playback failed', { err: String(err) });
          } finally {
            if (tmpPath) {
              FileSystem.deleteAsync(tmpPath, { idempotent: true }).catch(() => {});
            }
          }
        } else {
          try {
            const dataUri = `data:audio/mpeg;base64,${audioBase64}`;
            await playAudioUrl(dataUri);
            played = true;
          } catch (err) {
            deviceLogger.log('[voice] audio(base64) playback failed', { err: String(err) });
          }
        }
      }
      if (audioUrl && typeof audioUrl === 'string') {
        try {
          await playAudioUrl(audioUrl);
          played = true;
        } catch (err) {
          console.log('[voice] audio playback failed:', String(err));
        }
      }

      if (!played) {
        set({ isSpeaking: true, status: 'speaking' });
        await speakTextAndWait(assistantText, language);
        set({ isSpeaking: false, status: 'idle' });
      }
    } catch (e: unknown) {
      const err = e as {
        response?: { status?: unknown; data?: unknown };
        message?: unknown;
      };
      const status = err?.response?.status;
      const data = err?.response?.data;
      const msg = typeof err?.message === 'string' ? err.message : 'Text request failed.';

      if (typeof status === 'number') {
        const asObj = (val: unknown): { message?: unknown; error?: unknown } | null => {
          if (!val || typeof val !== 'object') return null;
          return val as { message?: unknown; error?: unknown };
        };

        let detail = typeof data === 'string' ? data : '';
        if (!detail) {
          const o = asObj(data);
          const msg = o?.message;
          const errMsg = o?.error;
          detail =
            (typeof msg === 'string' && msg) ||
            (typeof errMsg === 'string' && errMsg) ||
            JSON.stringify(data);
        }

        const isHtml =
          typeof detail === 'string' &&
          (detail.includes('<!DOCTYPE html') ||
            detail.includes('<html') ||
            detail.includes('<head>'));

        if (isHtml) {
          detail =
            'The voice service is temporarily unavailable (upstream error). Please try again in a few seconds.';
        }

        if (typeof detail === 'string' && detail.length > 800) {
          detail = `${detail.slice(0, 800)}…`;
        }

        set({ lastError: `HTTP ${status}: ${detail}` });
        await speakTextAndWait(
          'The service is temporarily unavailable. Please try again.',
          useSettingsStore.getState().language,
        );
      } else if (msg === 'Network Error') {
        set({
          lastError:
            'Network Error: revisa EXPO_PUBLIC_API_URL (no uses localhost en el teléfono), que el backend esté corriendo y que el puerto no esté bloqueado por firewall.',
        });
        await speakTextAndWait(
          'Network error. Please try again.',
          useSettingsStore.getState().language,
        );
      } else {
        set({ lastError: msg });
        await speakTextAndWait(
          'Something went wrong. Please try again.',
          useSettingsStore.getState().language,
        );
      }
    } finally {
      set({ isProcessing: false });
    }
  },

  confirm: async () => {
    const { pendingOriginalText } = useVoiceStore.getState();
    if (!pendingOriginalText.trim()) return;

    try {
      set({ isProcessing: true, status: 'processing', lastError: null });
      const language = useSettingsStore.getState().language;
      const res = await voiceAPI.processText(pendingOriginalText, {
        language,
        confirmation: 'confirmed',
      });
      const data = (res?.data ?? {}) as RawVoiceApiResponse;
      const assistantText =
        data.assistant_text ?? data.response ?? data.reply ?? data.message ?? '';
      set({ response: assistantText, awaitingConfirmation: false, pendingConfirmationText: '' });
      await speakTextAndWait(assistantText, language);
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      set({ lastError: typeof msg === 'string' ? msg : 'Confirmation failed.' });
    } finally {
      set({ isProcessing: false });
      set({ status: 'idle' });
    }
  },

  cancel: async () => {
    const { pendingOriginalText } = useVoiceStore.getState();
    if (!pendingOriginalText.trim()) {
      set({ awaitingConfirmation: false, pendingConfirmationText: '' });
      return;
    }

    try {
      set({ isProcessing: true, status: 'processing', lastError: null });
      const language = useSettingsStore.getState().language;
      const res = await voiceAPI.processText(pendingOriginalText, {
        language,
        confirmation: 'cancel',
      });
      const data = (res?.data ?? {}) as RawVoiceApiResponse;
      const assistantText =
        data.assistant_text ?? data.response ?? data.reply ?? data.message ?? '';
      set({ response: assistantText, awaitingConfirmation: false, pendingConfirmationText: '' });
      await speakTextAndWait(assistantText, language);
    } catch (e: unknown) {
      const msg = (e as { message?: unknown } | null)?.message;
      set({ lastError: typeof msg === 'string' ? msg : 'Cancel failed.' });
    } finally {
      set({ isProcessing: false });
      set({ status: 'idle' });
    }
  },

  setProcessing: (value: boolean) => set({ isProcessing: value }),
  setTranscription: (text: string) => set({ transcription: text }),
  setResponse: (text: string) => set({ response: text }),
  setPendingReminder: (r) => set({ pendingReminder: r }),
  reset: () => {
    const timer = useVoiceStore.getState()._silenceTimer;
    if (timer) clearInterval(timer);
    set({
      isListening: false,
      isProcessing: false,
      isSpeaking: false,
      isWakeActivated: false,
      status: 'idle',
      transcription: '',
      response: '',
      lastError: null,
      awaitingConfirmation: false,
      pendingConfirmationText: '',
      pendingOriginalText: '',
      pendingReminder: null,
      pendingEventId: null,
      pendingAttendeeName: null,
      _recording: null,
      _silenceTimer: null,
    });
  },
}));
