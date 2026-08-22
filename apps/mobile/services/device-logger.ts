/**
 * DeviceLogger — captura logs del dispositivo y los envía al backend
 * SIN autenticación, para diagnosticar crashes que ocurren ANTES de que Clerk inicialice.
 *
 * Los logs aparecen en:
 *   1. Render Dashboard → leeloo-api → Logs (en tiempo real)
 *   2. GET https://leeloo-api-55i5.onrender.com/diagnostics/device-logs?last=100
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ??
  'https://leeloo-api-55i5.onrender.com';

const ENDPOINT = `${API_URL}/v1/diagnostics/device-log`;

const deviceMeta = {
  os: Platform.OS,
  version: String(Platform.Version),
  buildNum:
    (Constants.expoConfig?.android?.versionCode as number | undefined) ??
    (Constants.expoConfig?.ios?.buildNumber as string | undefined) ??
    '?',
};

// Batch queue — flushes every 2s or when queue reaches 10 items.
// Prevents flooding the backend on rapid log bursts.
const queue: Array<{ level: string; message: string; data?: unknown; ts: number }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushQueue() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await Promise.all(
      batch.map((entry) =>
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...entry, device: deviceMeta }),
        }).catch(() => {}),
      ),
    );
  } catch {
    // never throw — logger must not crash the app
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, 2000);
}

function enqueue(level: string, message: string, data?: unknown) {
  queue.push({ level, message, data, ts: Date.now() });
  if (queue.length >= 10) void flushQueue();
  else scheduleFlush();
}

// ─── Global error interception ────────────────────────────────────────────────

let initialized = false;

export const deviceLogger = {
  init() {
    if (initialized) return;
    initialized = true;

    // ── 1. Console patching — captura todo console.error/warn y lo que mencione Clerk ──
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origLog = console.log.bind(console);

    console.error = (...args: unknown[]) => {
      origError(...args);
      enqueue('ERROR', args.map(String).join(' '));
    };

    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      const msg = args.map(String).join(' ');
      // Solo envía warns que mencionan Clerk u otros sistemas críticos
      if (/clerk|auth|token|leeloo|expo|metro/i.test(msg)) {
        enqueue('WARN', msg);
      }
    };

    console.log = (...args: unknown[]) => {
      origLog(...args);
      const msg = args.map(String).join(' ');
      if (/clerk|auth|token|\[Leeloo\]|isLoaded/i.test(msg)) {
        enqueue('LOG', msg);
      }
    };

    // ── 2. Errores JS globales no capturados (React Native / Hermes) ──────────
    const ErrorUtils = (global as { ErrorUtils?: {
      getGlobalHandler: () => (error: Error, isFatal: boolean) => void;
      setGlobalHandler: (handler: (error: Error, isFatal: boolean) => void) => void;
    } }).ErrorUtils;

    if (ErrorUtils) {
      const prevHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
        enqueue(isFatal ? 'FATAL' : 'UNCAUGHT', error?.message ?? String(error), {
          name: error?.name,
          stack: error?.stack?.slice(0, 600),
        });
        // Flush inmediatamente en un fatal — no esperar el timer
        void flushQueue();
        prevHandler?.(error, isFatal);
      });
    }

    // ── 3. Log de inicio ──────────────────────────────────────────────────────
    enqueue('LOG', '--- DeviceLogger init ---', {
      os: deviceMeta.os,
      version: deviceMeta.version,
      buildNum: deviceMeta.buildNum,
      apiUrl: API_URL,
    });
  },

  // API manual para puntos clave del ciclo de vida
  log(message: string, data?: unknown) {
    enqueue('LOG', message, data);
  },
  warn(message: string, data?: unknown) {
    enqueue('WARN', message, data);
  },
  error(message: string, data?: unknown) {
    enqueue('ERROR', message, data);
  },
  flush() {
    return flushQueue();
  },
};
