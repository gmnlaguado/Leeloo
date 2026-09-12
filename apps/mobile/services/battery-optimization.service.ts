/**
 * battery-optimization.service.ts
 *
 * Requests Android battery optimization exemption once, automatically.
 * Without this, Android kills the Leeloo process when the screen turns off,
 * breaking wake word detection and background reminders.
 *
 * Opens the direct system dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
 * which shows: "Allow Leeloo to always run in background?" — one tap by the user.
 * This is NOT the same as manually navigating to Settings > Battery.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';

const KEY = 'leeloo.battery_opt_requested_v1';
const PACKAGE = 'com.leeloo.app';

/**
 * Opens the system battery optimization exemption dialog once.
 * No-op on iOS or if already asked.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const asked = await AsyncStorage.getItem(KEY).catch(() => null);
    if (asked === '1') return;
    await AsyncStorage.setItem(KEY, '1').catch(() => {});
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${PACKAGE}` },
    );
  } catch {
    // Some OEMs (Xiaomi/MIUI, Huawei EMUI) block this intent silently — non-fatal.
  }
}

export async function hasBatteryOptimizationBeenRequested(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY).catch(() => null);
  return v === '1';
}
