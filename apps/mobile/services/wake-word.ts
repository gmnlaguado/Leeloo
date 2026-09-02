/**
 * LeelooEars — Wake Word Detection Service
 *
 * Two-stage pipeline (no Picovoice, no paid SDK):
 *   Stage 1 — Energy gate: expo-av metering, 2-second clips, CPU-free silence skip
 *   Stage 2 — Whisper STT: sends clip to our own leeloo-stt server (already paid)
 *              Checks transcription for "leeloo" keyword variants
 *
 * Battery cost: ~0 during silence. Small when speech is present.
 * Latency to activation: ~2.2s (2s clip + 0.2s STT round trip on leeloo-stt)
 */

import { Audio } from 'expo-av';
import type { AudioMode } from 'expo-av';
import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { voiceAPI } from '@/lib/api';

// Minimum dB level to consider speech present — gate prevents sending silent clips.
// -42 works on Android microphones that report lower levels than iOS.
const ENERGY_GATE_DB = -42;

// Each clip is this long. 2s is enough to catch "Hey Leeloo" + a brief pause.
const CLIP_DURATION_MS = 2_000;

// How often we poll the metering during a clip.
const METER_POLL_MS = 100;

// Keyword variants — covers all phonetic mis-transcriptions of "Leeloo" across
// Spanish/English/Portuguese/French speakers and Whisper model variants.
const WAKE_KEYWORDS = [
  // Core variants
  'leeloo', 'leelo', 'liloo', 'lilo', 'lelu', 'leelu', 'lilu', 'lyloo',
  'leo', 'lielo', 'lelo', 'lylo',
  // Groq STT consistently transcribes "Leeloo" as "Lilou" — verified from prod logs
  'lilou',
  // With greetings — EN
  'hey leeloo', 'hey leelo', 'hey lilu', 'hey lelu', 'hey lilou',
  'hi leeloo', 'hi lilou', 'hi lilu',
  'hello leeloo',
  // With greetings — ES
  'oye leeloo', 'oye lelu', 'oye lilu', 'oye lilou',
  'hola leeloo', 'hola lelu', 'hola lilou',
  // With greetings — FR
  'he leeloo', 'he lilu', 'he lilou',
  'ey leeloo', 'ey lelu', 'ey lilu',
];

class WakeWordService {
  private running = false;
  private paused = false;
  private onDetected: (() => void) | null = null;
  private language = 'en';

  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private clipTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private recording: Audio.Recording | null = null;
  private appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

  start(opts: { onDetected: () => void; language?: string }) {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.onDetected = opts.onDetected;
    this.language = opts.language ?? 'en';

    // iOS: UIBackgroundModes: audio + staysActiveInBackground keeps recording alive.
    // Android: staysActiveInBackground + FOREGROUND_SERVICE permission keeps process alive.
    // We show a persistent Android notification so the OS doesn't kill the process.
    // No pause on background — Leeloo stays ready to hear her name at all times.
    this.appStateSub = AppState.addEventListener('change', (_state: AppStateStatus) => {
      // Intentionally empty — wake word runs in background on both platforms.
      // Use pause()/resume() API explicitly when the voice UI is active.
    });

    void this._showBackgroundNotification();
    this._scheduleCycle(200);
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this._cancelCycle();
    this._stopRecording();
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._scheduleCycle(500);
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.onDetected = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this._cancelCycle();
    this._stopRecording();
    void this._dismissBackgroundNotification();
  }

  private async _showBackgroundNotification() {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.setNotificationChannelAsync('wake-word', {
        name: 'Leeloo Wake Word',
        importance: Notifications.AndroidImportance.LOW,
        enableVibrate: false,
        showBadge: false,
      });
      const content: any = {
        title: 'Leeloo está lista',
        body: 'Di "Leeloo" para activarme',
        data: { type: 'wake_word_listening' },
        sticky: true,
        ongoing: true,
      };
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: null,
      });
    } catch { /* non-fatal — app still works without notification */ }
  }

  private async _dismissBackgroundNotification() {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch { /* non-fatal */ }
  }

  private _scheduleCycle(delay: number) {
    this._cancelCycle();
    this.cycleTimer = setTimeout(() => this._runCycle(), delay);
  }

  private _cancelCycle() {
    if (this.cycleTimer !== null) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (this.clipTimer !== null) {
      clearTimeout(this.clipTimer);
      this.clipTimer = null;
    }
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }

  private _stopRecording() {
    const rec = this.recording;
    this.recording = null;
    if (rec) {
      rec.stopAndUnloadAsync().catch(() => {});
    }
  }

  private async _runCycle() {
    if (!this.running || this.paused) return;

    let uri: string | null = null;
    let peakDb = -100;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      } as AudioMode);

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await rec.startAsync();
      this.recording = rec;

      // Poll metering for CLIP_DURATION_MS
      await new Promise<void>((resolve) => {
        this.meterTimer = setInterval(async () => {
          try {
            const s = await rec.getStatusAsync();
            if (s.isRecording && 'metering' in s) {
              const db: number = (s as any).metering ?? -100;
              if (db > peakDb) peakDb = db;
            }
          } catch { /* ignore */ }
        }, METER_POLL_MS);

        this.clipTimer = setTimeout(() => {
          this.clipTimer = null;
          clearInterval(this.meterTimer!);
          this.meterTimer = null;
          resolve();
        }, CLIP_DURATION_MS);
      });

      if (!this.running || this.paused) {
        await rec.stopAndUnloadAsync().catch(() => {});
        this.recording = null;
        return;
      }

      await rec.stopAndUnloadAsync();
      this.recording = null;
      uri = rec.getURI() ?? null;
    } catch {
      this.recording = null;
      this._scheduleCycle(500);
      return;
    }

    // Stage 2: only send clip when speech energy is present
    if (uri && peakDb >= ENERGY_GATE_DB && this.running && !this.paused) {
      const detected = await this._sendClip(uri);
      if (detected && this.running && !this.paused) {
        // Caller must call pause() from onDetected, then resume() when done
        this.onDetected?.();
        return;
      }
    }

    // Next cycle immediately (small gap avoids overlap)
    this._scheduleCycle(50);
  }

  private async _sendClip(audioUri: string): Promise<boolean> {
    try {
      const res = await voiceAPI.wakeDetect(audioUri, this.language);
      return Boolean((res.data as any)?.detected);
    } catch {
      return false;
    }
  }
}

export const wakeWordService = new WakeWordService();
