import { Platform, NativeModules } from 'react-native';

// LeelooSiri: donates a Siri Shortcut so the user can say
// "Hey Siri, Leeloo" to open the app in voice mode.
// iOS only — no-op on Android (Android has its own wake word ForegroundService).

type LeelooSiriNative = {
  donateShortcut: (phrase: string, activityType: string, title: string) => Promise<void>;
  presentAddToSiri: (phrase: string, activityType: string, title: string) => Promise<'added' | 'cancelled' | 'error'>;
  isShortcutDonated: (activityType: string) => Promise<boolean>;
};

function getNative(): LeelooSiriNative | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return NativeModules.LeelooSiri as LeelooSiriNative;
  } catch {
    return null;
  }
}

const LEELOO_ACTIVITY_TYPE = 'com.hyperbyte.leeloo.openvoice';
const LEELOO_PHRASE = 'Leeloo';
const LEELOO_TITLE = 'Open Leeloo voice mode';

/** Donates the shortcut silently on first launch. iOS registers it with Siri. */
export async function donateLeelooShortcut(): Promise<void> {
  const native = getNative();
  if (!native) return;
  try {
    await native.donateShortcut(LEELOO_PHRASE, LEELOO_ACTIVITY_TYPE, LEELOO_TITLE);
  } catch {
    // Non-fatal — shortcut just won't be suggested
  }
}

/**
 * Shows the native "Add to Siri" dialog where the user records the phrase.
 * Returns 'added' if they confirmed, 'cancelled' if they dismissed.
 */
export async function presentAddToSiri(): Promise<'added' | 'cancelled' | 'error'> {
  const native = getNative();
  if (!native) return 'error';
  try {
    return await native.presentAddToSiri(LEELOO_PHRASE, LEELOO_ACTIVITY_TYPE, LEELOO_TITLE);
  } catch {
    return 'error';
  }
}

/** Returns true if the shortcut has already been donated this session. */
export async function isLeelooShortcutDonated(): Promise<boolean> {
  const native = getNative();
  if (!native) return false;
  try {
    return await native.isShortcutDonated(LEELOO_ACTIVITY_TYPE);
  } catch {
    return false;
  }
}

export const SIRI_ACTIVITY_TYPE = LEELOO_ACTIVITY_TYPE;
