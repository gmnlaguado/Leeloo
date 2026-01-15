import { create } from 'zustand';
import { Audio } from 'expo-av';
import { voiceAPI } from '@/lib/api';
import { useSettingsStore } from '@/store/settings';

const playAudioUrl = async (uri: string) => {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    } as any);
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
          settleOnce(() => reject(new Error((status as any).error || 'Audio not loaded')));
          return;
        }

        if ((status as any).didJustFinish) {
          settleOnce(() => resolve());
        }
      });

      sound.playAsync().catch((e) => settleOnce(() => reject(e)));

      // Safety timeout: avoid hanging forever
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

interface VoiceState {
  isListening: boolean;
  isProcessing: boolean;
  transcription: string;
  response: string;
  lastError: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  sendText: (text: string) => Promise<void>;
  setProcessing: (value: boolean) => void;
  setTranscription: (text: string) => void;
  setResponse: (text: string) => void;
  reset: () => void;
  _recording: Audio.Recording | null;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isListening: false,
  isProcessing: false,
  transcription: '',
  response: '',
  lastError: null,
  _recording: null,

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
      } as any);

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();

      set({ isListening: true, _recording: recording });
    } catch (e: any) {
      set({ lastError: e?.message || 'Failed to start recording.' });
    }
  },

  stopListening: async () => {
    let uri: string | null = null;

    try {
      const recording = (useVoiceStore.getState() as any)._recording as Audio.Recording | null;
      set({ isListening: false, _recording: null, lastError: null });

      if (!recording) return;

      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
      if (!uri) {
        set({ lastError: 'No audio captured.' });
        return;
      }

      set({ isProcessing: true });
      const language = useSettingsStore.getState().language;
      const res = await voiceAPI.processVoice(uri, { language });
      const data = res?.data ?? {};

      const transcription =
        data.transcription ??
        data.text ??
        data.input_text ??
        '';

      const response =
        data.response ??
        data.response_text ??
        data.reply ??
        data.message ??
        '';

      set({ transcription, response });

      const audioUrl =
        data.response_audio_url ??
        data.audio_url ??
        data.audioUrl ??
        data.tts_url ??
        null;
      if (audioUrl && typeof audioUrl === 'string') {
        try {
          await playAudioUrl(audioUrl);
        } catch (err) {
          console.log('[voice] audio playback failed:', String(err));
        }
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const msg = e?.message || 'Voice request failed.';

      if (typeof status === 'number') {
        const detail =
          typeof data === 'string'
            ? data
            : data?.message || data?.error || JSON.stringify(data);
        set({ lastError: `HTTP ${status}: ${detail}` });
      } else if (msg === 'Network Error') {
        set({
          lastError:
            'Network Error (audio upload): puede ser multipart en Expo Go o timeout. Verifica que el backend siga vivo y que el teléfono y PC estén en la misma red. Si sigue pasando, intenta de nuevo: ya cambiamos el upload a fetch para estabilizar.',
        });
      } else {
        set({ lastError: msg });
      }
    } finally {
      set({ isProcessing: false });
    }
  },

  sendText: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      set({ isProcessing: true, lastError: null, transcription: trimmed });
      const language = useSettingsStore.getState().language;
      const res = await voiceAPI.processText(trimmed, { language });
      const data = res?.data ?? {};
      const response =
        data.response ??
        data.response_text ??
        data.reply ??
        data.message ??
        '';
      set({ response });

      const audioUrl =
        data.response_audio_url ??
        data.audio_url ??
        data.audioUrl ??
        data.tts_url ??
        null;
      if (audioUrl && typeof audioUrl === 'string') {
        try {
          await playAudioUrl(audioUrl);
        } catch (err) {
          console.log('[voice] audio playback failed:', String(err));
        }
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      const msg = e?.message || 'Text request failed.';

      if (typeof status === 'number') {
        let detail =
          typeof data === 'string'
            ? data
            : data?.message || data?.error || JSON.stringify(data);

        const isHtml =
          typeof detail === 'string' &&
          (detail.includes('<!DOCTYPE html') || detail.includes('<html') || detail.includes('<head>'));

        if (isHtml) {
          detail =
            'The voice service is temporarily unavailable (upstream error). Please try again in a few seconds.';
        }

        if (typeof detail === 'string' && detail.length > 800) {
          detail = `${detail.slice(0, 800)}…`;
        }

        set({ lastError: `HTTP ${status}: ${detail}` });
      } else if (msg === 'Network Error') {
        set({
          lastError:
            'Network Error: revisa EXPO_PUBLIC_API_URL (no uses localhost en el teléfono), que el backend esté corriendo y que el puerto no esté bloqueado por firewall.',
        });
      } else {
        set({ lastError: msg });
      }
    } finally {
      set({ isProcessing: false });
    }
  },

  setProcessing: (value) => set({ isProcessing: value }),
  setTranscription: (text) => set({ transcription: text }),
  setResponse: (text) => set({ response: text }),
  reset: () => set({ transcription: '', response: '', isProcessing: false, lastError: null }),
}));
