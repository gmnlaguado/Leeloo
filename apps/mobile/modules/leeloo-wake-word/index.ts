import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type LeelooWakeWordNativeModule = {
  startForegroundService: () => void;
  stopForegroundService: () => void;
  isRunning: () => boolean;
};

let _module: LeelooWakeWordNativeModule | null = null;

function getNative(): LeelooWakeWordNativeModule | null {
  if (Platform.OS !== 'android') return null;
  if (!_module) {
    try {
      _module = requireNativeModule('LeelooWakeWord');
    } catch {
      // Native module not linked yet (e.g. Expo Go)
      _module = null;
    }
  }
  return _module;
}

export function startWakeWordForegroundService(): void {
  getNative()?.startForegroundService();
}

export function stopWakeWordForegroundService(): void {
  getNative()?.stopForegroundService();
}

export function isWakeWordServiceRunning(): boolean {
  return getNative()?.isRunning() ?? false;
}
