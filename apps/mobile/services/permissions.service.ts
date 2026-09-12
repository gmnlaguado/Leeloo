/**
 * permissions.service.ts
 *
 * Centralized permission management for Leeloo.
 * Requests all required permissions and reports which ones are missing.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Contacts from 'expo-contacts';
import * as Calendar from 'expo-calendar';
import { Audio } from 'expo-av';

export type PermissionKey =
  | 'microphone'
  | 'calls'
  | 'contacts'
  | 'calendar'
  | 'notifications';

export interface PermissionStatus {
  key: PermissionKey;
  granted: boolean;
}

/** Request a single permission — returns true if granted */
async function requestMicrophone(): Promise<boolean> {
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

async function requestCalls(): Promise<boolean> {
  if (Platform.OS !== 'android') return true; // iOS uses tel:// — no runtime permission needed
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
      {
        title: 'Llamadas automáticas',
        message:
          'Leeloo necesita este permiso para marcar llamadas por ti sin que tengas que tocar la pantalla.',
        buttonPositive: 'Permitir',
        buttonNegative: 'Ahora no',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function requestContacts(): Promise<boolean> {
  try {
    const { granted } = await Contacts.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

async function requestCalendar(): Promise<boolean> {
  try {
    const { granted } = await Calendar.requestCalendarPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

async function requestNotifications(): Promise<boolean> {
  try {
    const { granted } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return granted;
  } catch {
    return false;
  }
}

/** Check current status of all permissions without requesting */
export async function checkAllPermissions(): Promise<PermissionStatus[]> {
  const results: PermissionStatus[] = [];

  // Microphone
  try {
    const { granted } = await Audio.getPermissionsAsync();
    results.push({ key: 'microphone', granted });
  } catch {
    results.push({ key: 'microphone', granted: false });
  }

  // Calls
  if (Platform.OS === 'android') {
    try {
      const r = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
      results.push({ key: 'calls', granted: r });
    } catch {
      results.push({ key: 'calls', granted: false });
    }
  } else {
    results.push({ key: 'calls', granted: true });
  }

  // Contacts
  try {
    const { granted } = await Contacts.getPermissionsAsync();
    results.push({ key: 'contacts', granted });
  } catch {
    results.push({ key: 'contacts', granted: false });
  }

  // Calendar
  try {
    const { granted } = await Calendar.getCalendarPermissionsAsync();
    results.push({ key: 'calendar', granted });
  } catch {
    results.push({ key: 'calendar', granted: false });
  }

  // Notifications
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    results.push({ key: 'notifications', granted });
  } catch {
    results.push({ key: 'notifications', granted: false });
  }

  return results;
}

/** Request one specific permission by key */
export async function requestPermission(key: PermissionKey): Promise<boolean> {
  switch (key) {
    case 'microphone':    return requestMicrophone();
    case 'calls':         return requestCalls();
    case 'contacts':      return requestContacts();
    case 'calendar':      return requestCalendar();
    case 'notifications': return requestNotifications();
    default:              return false;
  }
}

/** Request all permissions in sequence — returns updated statuses */
export async function requestAllPermissions(): Promise<PermissionStatus[]> {
  const keys: PermissionKey[] = ['microphone', 'notifications', 'contacts', 'calendar', 'calls'];
  const results: PermissionStatus[] = [];
  for (const key of keys) {
    const granted = await requestPermission(key);
    results.push({ key, granted });
  }
  return results;
}
