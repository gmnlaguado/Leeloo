/**
 * Wake word detection — bridges to the custom LeelooEars implementation
 * in wake-word.ts (energy gate + Whisper STT, no Picovoice dependency).
 * On Android, starts a ForegroundService to keep detection alive in background.
 */

import { Platform } from 'react-native';
import { wakeWordService } from './wake-word';
import { useSettingsStore } from '@/store/settings';
import {
  startWakeWordForegroundService,
  stopWakeWordForegroundService,
} from '@/modules/leeloo-wake-word';
import {
  startBackgroundAudioKeepAlive,
  stopBackgroundAudioKeepAlive,
} from './background-audio-keepalive';

type WakeListener = () => void;
const wakeListeners = new Set<WakeListener>();

function notifyListeners() {
  wakeListeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
}

let isRunning = false;

export function subscribeWakeWord(cb: WakeListener): () => void {
  wakeListeners.add(cb);
  return () => wakeListeners.delete(cb);
}

export async function registerWakeWordDetection(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const language = useSettingsStore.getState().language ?? 'en';
  wakeWordService.start({ onDetected: notifyListeners, language });
  if (Platform.OS === 'android') {
    startWakeWordForegroundService();
  } else if (Platform.OS === 'ios') {
    // iOS: mantiene la sesión de audio activa en background
    startBackgroundAudioKeepAlive().catch(() => {});
  }
}

export async function unregisterWakeWordDetection(): Promise<void> {
  wakeWordService.stop();
  isRunning = false;
  if (Platform.OS === 'android') {
    stopWakeWordForegroundService();
  } else if (Platform.OS === 'ios') {
    stopBackgroundAudioKeepAlive().catch(() => {});
  }
}

export function pauseWakeWord(): void {
  wakeWordService.pause();
}

export function resumeWakeWord(): void {
  wakeWordService.resume();
}

export function matchesWakePhrase(transcription: string): boolean {
  const normalized = String(transcription || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const phrases = ['hey leeloo', 'hi leeloo', 'oye leeloo', 'hola leeloo', 'leeloo'];
  return phrases.some((p) => normalized.includes(p));
}
