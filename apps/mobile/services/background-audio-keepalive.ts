/**
 * iOS Background Audio Keep-Alive
 *
 * iOS suspende el audio de la app en background si no hay una sesión de audio
 * activa. Este servicio reproduce una pista de silencio en loop con expo-av,
 * lo que mantiene la sesión de audio viva y permite que el wake word detector
 * siga corriendo más tiempo en background.
 *
 * IMPORTANTE: Esto no funciona con la app completamente cerrada (killed) —
 * solo extiende el tiempo en background/switcher. Es la máxima posibilidad
 * sin acuerdo de Apple Partner.
 */

import { Audio } from 'expo-av';
import { Platform } from 'react-native';

let _sound: Audio.Sound | null = null;
let _active = false;

// Un archivo de silencio de 1 segundo en base64 (WAV PCM 16-bit mono 8kHz)
// Generado con: sox -n -r 8000 -c 1 silence.wav trim 0 1
// 44 bytes header + 8000 samples * 2 bytes = 16044 bytes
const SILENT_AUDIO_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAQBAAACABAAZGF0YQAAAAA=';

export async function startBackgroundAudioKeepAlive(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (_active) return;

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,     // KEY: mantiene sesión activa en background
      interruptionModeIOS: 1,            // MixWithOthers
      shouldDuckAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: `data:audio/wav;base64,${SILENT_AUDIO_BASE64}` },
      {
        isLooping: true,
        volume: 0,         // silencio total — el usuario no escucha nada
        shouldPlay: true,
      },
    );

    _sound = sound;
    _active = true;

    await sound.playAsync();
  } catch (err) {
    // No fatal — la app sigue funcionando, solo pierde el keep-alive
    console.warn('[keepalive] Failed to start background audio:', err);
  }
}

export async function stopBackgroundAudioKeepAlive(): Promise<void> {
  if (!_active || !_sound) return;
  try {
    await _sound.stopAsync();
    await _sound.unloadAsync();
  } catch { /* ignore */ }
  _sound = null;
  _active = false;
}

export function isKeepAliveActive(): boolean {
  return _active;
}
