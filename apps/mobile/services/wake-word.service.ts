/**
 * Wake word detection — "Hey Leeloo" / "Oye Leeloo".
 *
 * Strategy:
 *  - Background fetch task (15s minimum on iOS, ~15-30s effective on Android) records
 *    a short audio buffer and forwards it to /v1/voice/process with `wake_word_only=true`.
 *  - The backend uses Whisper (cheap short clips) to detect the trigger phrase and
 *    returns { transcription }. The mobile decides whether to escalate to the full
 *    voice command capture.
 *  - When the trigger fires, the app emits a chime, lights up the LeelooAvatar and
 *    captures the actual command up to 30s or 2s of trailing silence.
 *
 *  Notes:
 *   - True always-on wake-word detection (Porcupine / Picovoice) is the long-term play
 *     because background fetch is unreliable on iOS. This file ships the cloud
 *     detector first; the on-device engine plugs in via `detectorBackend()`.
 */
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { Audio } from 'expo-av';

import api from '@/lib/api';

export const WAKE_WORD_TASK = 'LEELOO_WAKE_WORD_DETECTION';

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

const WAKE_PHRASES = [
  'hey leeloo',
  'hi leeloo',
  'oye leeloo',
  'hola leeloo',
  'ei leeloo',
  'leeloo',
  'lilu',
  'lilo',
];

/**
 * Heuristic phrase matcher used as a final guard on top of Whisper output.
 * The backend already does this — kept here so we don't escalate prematurely.
 */
export function matchesWakePhrase(transcription: string): boolean {
  const normalized = String(transcription || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return WAKE_PHRASES.some((p) => normalized.includes(p));
}

async function captureShortAudioToFormData(): Promise<FormData | null> {
  try {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return null;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    await new Promise((res) => setTimeout(res, 2000));
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (!uri) return null;

    const form = new FormData();
    form.append('audio', {
      uri,
      name: 'wake.m4a',
      type: 'audio/m4a',
    } as any);
    form.append('wake_word_only', 'true');
    return form;
  } catch {
    return null;
  }
}

TaskManager.defineTask(WAKE_WORD_TASK, async () => {
  try {
    const form = await captureShortAudioToFormData();
    if (!form) return BackgroundFetch.BackgroundFetchResult.NoData;

    const res = await api.post<{ transcription?: string }>('/v1/voice/process', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 12000,
    });

    const transcription = res.data?.transcription || '';
    if (matchesWakePhrase(transcription)) {
      // Caller registers a listener on this event via `subscribeWakeWord(...)`.
      wakeListeners.forEach((cb) => {
        try {
          cb(transcription);
        } catch {
          // ignore listener errors
        }
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

type WakeListener = (transcription: string) => void;
const wakeListeners = new Set<WakeListener>();

export function subscribeWakeWord(cb: WakeListener): () => void {
  wakeListeners.add(cb);
  return () => wakeListeners.delete(cb);
}

export async function registerWakeWordDetection(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return;
  }

  await BackgroundFetch.registerTaskAsync(WAKE_WORD_TASK, {
    minimumInterval: 15,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterWakeWordDetection(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(WAKE_WORD_TASK);
  } catch {
    // ignore
  }
}
