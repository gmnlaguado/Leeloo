/**
 * Wake word detection — bridges to the custom LeelooEars implementation
 * in wake-word.ts (energy gate + Whisper STT, no Picovoice dependency).
 */

import { wakeWordService } from './wake-word';
import { useSettingsStore } from '@/store/settings';

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
}

export async function unregisterWakeWordDetection(): Promise<void> {
  wakeWordService.stop();
  isRunning = false;
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
