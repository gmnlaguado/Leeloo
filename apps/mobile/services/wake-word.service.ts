/**
 * Wake word detection — "Hey Leeloo" via Picovoice Porcupine (on-device, ~50ms latency).
 *
 * Setup (one-time, per developer):
 *  1. Register free at console.picovoice.ai → get your AccessKey
 *  2. Console → Wake Word → "Hey Leeloo" → train → download .ppn for iOS + Android
 *  3. Place files at:
 *       apps/mobile/assets/models/hey-leeloo_ios.ppn
 *       apps/mobile/assets/models/hey-leeloo_android.ppn
 *  4. Add to .env (and EAS secrets):
 *       EXPO_PUBLIC_PICOVOICE_ACCESS_KEY=your_key_here
 *
 * How it works (vs old BackgroundFetch approach):
 *  - Porcupine runs an on-device neural net that processes audio at the OS level.
 *  - Responds in ~50ms — same as Alexa/Siri.
 *  - Works with screen off, app in background (Android foreground service).
 *  - No internet needed for wake word detection — all local.
 *  - iOS: works while app is active/background. Full always-on requires Background Audio entitlement.
 *  - Android: full always-on via foreground service (handled by Porcupine SDK).
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';

// ─── Type stubs (avoids hard dependency at import time — real types come from the package) ───
type PorcupineManagerType = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  delete: () => Promise<void>;
};

let PorcupineManager: {
  fromKeywordPaths: (
    accessKey: string,
    paths: string[],
    onDetect: (idx: number) => void,
    onError: (err: unknown) => void,
  ) => Promise<PorcupineManagerType>;
} | null = null;

try {
  // Dynamic require so the build doesn't hard-crash if the package isn't installed yet.
  // Once @picovoice/porcupine-react-native is in package.json this will resolve normally.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PorcupineManager = require('@picovoice/porcupine-react-native').PorcupineManager;
} catch {
  PorcupineManager = null;
}

const ACCESS_KEY = process.env.EXPO_PUBLIC_PICOVOICE_ACCESS_KEY ?? '';

// ─── Model file resolver ──────────────────────────────────────────────────────────────────────
async function resolveKeywordPath(): Promise<string | null> {
  try {
    const assetModule =
      Platform.OS === 'ios'
        ? require('../assets/models/hey-leeloo_ios.ppn')
        : require('../assets/models/hey-leeloo_android.ppn');

    const assets = await Asset.loadAsync(assetModule);
    const asset = assets[0];

    if (!asset?.localUri) return null;

    // Copy to cache dir with clean filename (Porcupine needs an actual filesystem path)
    const dest = `${FileSystem.cacheDirectory}hey-leeloo.ppn`;
    await FileSystem.copyAsync({ from: asset.localUri, to: dest });
    return dest;
  } catch {
    return null;
  }
}

// ─── Wake listener registry ───────────────────────────────────────────────────────────────────
type WakeListener = () => void;
const wakeListeners = new Set<WakeListener>();

export function subscribeWakeWord(cb: WakeListener): () => void {
  wakeListeners.add(cb);
  return () => wakeListeners.delete(cb);
}

function notifyListeners() {
  wakeListeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

// ─── Porcupine manager instance ───────────────────────────────────────────────────────────────
let porcupineInstance: PorcupineManagerType | null = null;
let isRunning = false;

export async function registerWakeWordDetection(): Promise<void> {
  if (isRunning) return;

  if (!PorcupineManager) {
    console.warn('[WakeWord] @picovoice/porcupine-react-native not installed. Run: npm install @picovoice/porcupine-react-native in apps/mobile');
    return;
  }

  if (!ACCESS_KEY) {
    console.warn('[WakeWord] EXPO_PUBLIC_PICOVOICE_ACCESS_KEY is not set. Wake word disabled.');
    return;
  }

  const keywordPath = await resolveKeywordPath();
  if (!keywordPath) {
    console.warn('[WakeWord] .ppn model file not found. Place hey-leeloo_ios.ppn / hey-leeloo_android.ppn in apps/mobile/assets/models/');
    return;
  }

  try {
    porcupineInstance = await PorcupineManager.fromKeywordPaths(
      ACCESS_KEY,
      [keywordPath],
      (_idx: number) => {
        // Wake word detected — fire all listeners
        notifyListeners();
      },
      (err: unknown) => {
        console.warn('[WakeWord] Porcupine error:', String(err));
      },
    );

    await porcupineInstance.start();
    isRunning = true;
    console.log('[WakeWord] Porcupine started — listening for "Hey Leeloo"');
  } catch (e) {
    console.warn('[WakeWord] Failed to start Porcupine:', String(e));
    porcupineInstance = null;
    isRunning = false;
  }
}

export async function unregisterWakeWordDetection(): Promise<void> {
  if (!porcupineInstance) return;
  try {
    await porcupineInstance.stop();
    await porcupineInstance.delete();
  } catch { /* ignore */ }
  porcupineInstance = null;
  isRunning = false;
}

// ─── Kept for backward compat (unused in Porcupine mode) ─────────────────────────────────────
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
