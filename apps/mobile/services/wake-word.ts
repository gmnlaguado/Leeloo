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
import { deviceLogger } from '@/services/device-logger';

// Minimum dB level to consider speech present — gate prevents sending silent clips.
// -42 works on Android microphones that report lower levels than iOS.
const ENERGY_GATE_DB = -38;

// Each clip is this long. 2s is enough to catch "Hey Leeloo" + a brief pause.
const CLIP_DURATION_MS = 2_000;

// How often we poll the metering during a clip.
const METER_POLL_MS = 100;

// Keyword variants — covers all phonetic mis-transcriptions of "Leeloo" across
// Spanish/English/Portuguese/French speakers and all STT model variants (Groq, Whisper, leeloo-stt).
// "Leeloo" in natural speech ≈ /liːluː/ — sounds like "lee-loo", "li-lu", "li-lo", "lee-lu"
const WAKE_KEYWORDS = [
  // ── Core phonetic variants ──────────────────────────────────────────────
  'leeloo', 'leelo', 'leelu', 'leeloo',
  'liloo', 'lilu', 'lilo', 'lilu',
  'lyloo', 'lylo', 'lylu',
  'lelu', 'leelu', 'lelou',
  'lielo', 'lelo', 'leloo',
  'leolu', 'leolou',
  // Two-word splits STT sometimes produces
  'lee loo', 'lee lu', 'li loo', 'li lu', 'lee lo',
  // ── Groq/Whisper confirmed mis-transcriptions ──────────────────────────
  'lilou',  // Groq EN: most common
  'leelou', 'leeloue',
  'leo',    // Short clipping
  'liou', 'lioux',
  // ── With trigger words — EN ────────────────────────────────────────────
  'hey leeloo', 'hey leelo', 'hey lilu', 'hey lelu', 'hey lilou', 'hey leo',
  'hi leeloo', 'hi lilou', 'hi lilu', 'hi lelo', 'hi leo',
  'hello leeloo', 'hello lilu', 'hello lilou',
  'ok leeloo', 'okay leeloo', 'ok lilu', 'ok leo',
  // ── With trigger words — ES ────────────────────────────────────────────
  'oye leeloo', 'oye lelu', 'oye lilu', 'oye lilou', 'oye leo', 'oye lilo',
  'hola leeloo', 'hola lelu', 'hola lilou', 'hola lilu', 'hola lilo',
  'ey leeloo', 'ey lelu', 'ey lilu', 'ey lilou',
  // ── With trigger words — PT ────────────────────────────────────────────
  'oi leeloo', 'oi lilu', 'oi lilou', 'oi leo',
  // ── With trigger words — FR ────────────────────────────────────────────
  'hé leeloo', 'hé lilu', 'hé lilou',
  'he leeloo', 'he lilu', 'he lilou',
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
  // Backoff when STT provider returns rate-limit errors
  private rateLimitUntil = 0;
  private rateLimitBackoffMs = 10_000; // starts at 10s, doubles up to 5min

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
      // Re-check paused here: TTS playback may have called pause() while this cycle
      // was already past the entry guard above. Without this check, setAudioModeAsync
      // runs AFTER TTS switched to playback mode → "Audio not loaded" on Android.
      if (this.paused) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      } as AudioMode);

      if (this.paused) return;

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
    const aboveGate = peakDb >= ENERGY_GATE_DB;
    deviceLogger.log('[wake] cycle', { peakDb: peakDb.toFixed(1), gate: ENERGY_GATE_DB, aboveGate });

    if (uri && aboveGate && this.running && !this.paused) {
      // iOS BACKGROUND FIX — Pipeline approach:
      // Start the NEXT recording cycle IMMEDIATELY before sending the clip to STT.
      // This keeps the audio session continuously active with no gap.
      // Without this, the 200-500ms STT round trip creates a lapse where
      // iOS can suspend the process under memory pressure.
      this._scheduleCycle(0);
      const detected = await this._sendClip(uri);
      deviceLogger.log('[wake] clip sent', { detected });
      if (detected && this.running && !this.paused) {
        // Wake word confirmed — cancel the pre-started next cycle and fire callback.
        this._cancelCycle();
        this._stopRecording();
        deviceLogger.log('[wake] ACTIVATED — wake word detected');
        this.onDetected?.();
      }
      // If not detected, next cycle is already running — nothing to do.
      return;
    }

    // No speech energy — next cycle immediately (minimal gap)
    this._scheduleCycle(0);
  }

  private async _sendClip(audioUri: string): Promise<boolean> {
    // Skip sending if we're in a rate-limit backoff window
    if (Date.now() < this.rateLimitUntil) return false;
    try {
      const res = await voiceAPI.wakeDetect(audioUri, this.language);
      // Successful response — reset backoff
      this.rateLimitBackoffMs = 10_000;
      return Boolean((res.data as any)?.detected);
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? '');
      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('429')) {
        // Exponential backoff: 10s → 20s → 40s … capped at 5min
        this.rateLimitUntil = Date.now() + this.rateLimitBackoffMs;
        this.rateLimitBackoffMs = Math.min(this.rateLimitBackoffMs * 2, 300_000);
        deviceLogger.log('[wake] rate limit — backing off', { backoffMs: this.rateLimitBackoffMs });
      }
      return false;
    }
  }
}

export const wakeWordService = new WakeWordService();
