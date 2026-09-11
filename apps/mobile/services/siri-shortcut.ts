/**
 * siri-shortcut.ts
 *
 * Manages the "Hey Siri, Leeloo" shortcut lifecycle:
 *  - donateLeelooShortcut()   — call once on app launch (silently donates to Siri)
 *  - presentAddToSiri()       — call from onboarding / settings to show native dialog
 *  - isLeelooShortcutDonated()— check if user already added it
 *
 * iOS only. No-ops on Android (handled by ForegroundService wake-word instead).
 */

import { Platform } from 'react-native';
import {
  donateLeelooShortcut as _donate,
  presentAddToSiri as _present,
  isLeelooShortcutDonated as _isDonated,
} from '@/modules/leeloo-siri';

const STORAGE_KEY = 'leeloo.siri.donated';

/** Called once on app start — donates the shortcut silently so Siri can suggest it. */
export async function initSiriShortcut(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await _donate();
  } catch {
    // Non-fatal
  }
}

/**
 * Shows the native "Add to Siri" sheet.
 * Best called from an onboarding screen or Settings → Voice & Siri.
 * Returns 'added' | 'cancelled' | 'error'.
 */
export async function showAddToSiriDialog(): Promise<'added' | 'cancelled' | 'error'> {
  if (Platform.OS !== 'ios') return 'error';
  return _present();
}

/** True if the user has already added "Hey Siri, Leeloo" to their device. */
export async function hasSiriShortcut(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return _isDonated();
}
