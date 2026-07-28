import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { profilesAPI } from '../lib/api';

let lastRegisteredToken: string | null = null;

/**
 * Request permission and obtain an Expo push token, then register it with the API.
 * Safe to call multiple times — only PATCHes when the token actually changes.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log('[push] not a real device, skipping');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF9F1C',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[push] permission denied');
      return null;
    }

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId;

    const tokenResp = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenResp.data;
    if (!token) return null;

    if (token === lastRegisteredToken) return token;

    try {
      await profilesAPI.updateMe({ expo_push_token: token });
      lastRegisteredToken = token;
      console.log('[push] expo token registered');
    } catch (err) {
      console.log('[push] failed to register token with API:', String(err));
    }

    return token;
  } catch (err) {
    console.log('[push] registerForPushNotificationsAsync error:', String(err));
    return null;
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    await profilesAPI.updateMe({ expo_push_token: null });
    lastRegisteredToken = null;
  } catch (err) {
    console.log('[push] unregister error:', String(err));
  }
}
