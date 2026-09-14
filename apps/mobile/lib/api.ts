import axios from 'axios';
import type {
  AxiosInstance,
  AxiosRequestHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import { getAuthToken } from './authToken';
import { getClerkUserId } from './clerkAuth';
import { getDeviceLocation } from './deviceLocation';

type RequestBody = Record<string, unknown>;
type QueryParams = Record<string, string | number | boolean>;

type ExpoConfigLike = {
  hostUri?: string;
  extra?: Record<string, unknown>;
};

type ConstantsLike = {
  expoConfig?: ExpoConfigLike;
  expoGoConfig?: { debuggerHost?: string };
  manifest?: { debuggerHost?: string };
};

type ReactNativeFile = {
  uri: string;
  name: string;
  type: string;
};

declare const __DEV__: boolean;

const getDefaultApiBaseUrl = () => {
  const c = Constants as unknown as ConstantsLike;
  const hostUri =
    c.expoConfig?.hostUri || c.expoGoConfig?.debuggerHost || c.manifest?.debuggerHost || null;

  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
  return host ? `http://${host}:3000` : 'http://localhost:3000';
};

const getDefaultAiOrchestratorBaseUrl = () => {
  const c = Constants as unknown as ConstantsLike;
  const hostUri =
    c.expoConfig?.hostUri || c.expoGoConfig?.debuggerHost || c.manifest?.debuggerHost || null;

  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
  return host ? `http://${host}:3002` : 'http://localhost:3002';
};

// Hardcoded production fallbacks — same pattern as CLERK_PUBLISHABLE_KEY.
// EXPO_PUBLIC_* vars must be baked into the bundle by Metro at build time.
// If the CI env injection fails, these ensure the production APK still reaches
// the real servers instead of falling back to http://localhost.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://leeloo-api-55i5.onrender.com';
const AI_ORCHESTRATOR_BASE_URL =
  process.env.EXPO_PUBLIC_AI_ORCHESTRATOR_URL ?? 'https://leeloo-ai.onrender.com';
// Dev-only convenience: lets local dev clients call the API without a real
// Clerk session by supplying a static bearer token via env/app config.
// Hard-gated behind __DEV__ so Metro dead-code-eliminates this from release
// bundles — EXPO_PUBLIC_* values are inlined into the JS bundle at build time
// and would otherwise ship as an extractable, static secret in any build
// profile (QA/staging/preview) that happened to set it.
const FALLBACK_BEARER_TOKEN = __DEV__
  ? process.env.EXPO_PUBLIC_BEARER_TOKEN ||
    ((): string | undefined => {
      const c = Constants as unknown as ConstantsLike;
      const extra = c.expoConfig?.extra;
      const t1 = extra?.EXPO_PUBLIC_BEARER_TOKEN;
      const t2 = extra?.bearerToken;
      return typeof t1 === 'string' ? t1 : typeof t2 === 'string' ? t2 : undefined;
    })()
  : undefined;

const SHOULD_LOG_AUTH_TOKEN =
  process.env.EXPO_PUBLIC_LOG_AUTH_TOKEN === 'true' ||
  ((): boolean => {
    const c = Constants as unknown as ConstantsLike;
    const extra = c.expoConfig?.extra;
    return extra?.EXPO_PUBLIC_LOG_AUTH_TOKEN === 'true';
  })();

const API_V1_BASE_URL = `${API_BASE_URL}/v1`;
const AI_V1_BASE_URL = `${AI_ORCHESTRATOR_BASE_URL}/v1`;

const resolveUserId = async (): Promise<string> => {
  const uid = getClerkUserId();
  if (!uid || !uid.trim()) {
    // Fail closed: never fall back to a shared placeholder identity. Callers
    // must handle this rejection (e.g. surface "please sign in") rather than
    // silently issuing requests as a generic 'dev-user'.
    throw new Error('No authenticated user id available; user must be signed in.');
  }
  return uid.trim();
};

const resolveBearerToken = async (): Promise<{ token?: string; source: string }> => {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  let clerkToken: string | undefined;
  try {
    clerkToken = await getAuthToken();
  } catch (e) {
    if (isDev) {
      console.log('[api] getAuthToken failed:', String(e));
    }
  }

  const token = clerkToken || FALLBACK_BEARER_TOKEN;
  const source = clerkToken ? 'clerk' : FALLBACK_BEARER_TOKEN ? 'env' : 'none';

  if (isDev && token && source === 'clerk') {
    const preview = `${token.slice(0, 12)}…${token.slice(-12)}`;
    console.log('[api] clerk jwt preview =', preview);
    if (SHOULD_LOG_AUTH_TOKEN) {
      console.log('[api] clerk jwt (full) =', token);
    }
  }

  return { token, source };
};

console.log('[api] API_BASE_URL =', API_BASE_URL);
console.log('[api] AI_ORCHESTRATOR_BASE_URL =', AI_ORCHESTRATOR_BASE_URL);
console.log('[api] Has EXPO_PUBLIC_BEARER_TOKEN =', Boolean(FALLBACK_BEARER_TOKEN));

const api: AxiosInstance = axios.create({
  baseURL: API_V1_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { token, source: tokenSource } = await resolveBearerToken();

  config.headers = (config.headers ?? {}) as AxiosRequestHeaders;
  if (token) {
    (config.headers as Record<string, unknown>).Authorization = `Bearer ${token}`;
  }

  // Important: let axios set proper multipart boundary.
  try {
    const isFormData =
      typeof FormData !== 'undefined' &&
      Boolean(config.data) &&
      (config.data as unknown) instanceof FormData;
    if (isFormData) {
      delete (config.headers as Record<string, unknown>)['Content-Type'];
    }
  } catch {
    // ignore
  }

  if (__DEV__) {
    const hasAuth = Boolean((config.headers as Record<string, unknown>)?.Authorization);
    console.log('[api:req]', {
      method: config.method,
      url: config.baseURL ? `${config.baseURL}${config.url || ''}` : config.url,
      hasAuth,
      tokenSource,
      tokenLen: token ? token.length : 0,
    });
  }

  return config;
});

api.interceptors.response.use(
  (res) => {
    if (__DEV__) {
      console.log('[api:res]', {
        url: res?.config?.url,
        status: res?.status,
      });
    }
    return res;
  },
  (err) => {
    if (__DEV__) {
      console.log('[api:err]', {
        url: err?.config?.url,
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message,
      });
    }
    throw err;
  },
);

// Voice API
export const voiceAPI = {
  processVoice: async (
    audioUri: string,
    opts?: { language?: string; personality?: string; user_name?: string; wakeWordOnly?: boolean; conversationHistory?: string },
  ): Promise<{ data: unknown; status: number }> => {
    // Axios + multipart is flaky in RN/Expo Go. Use fetch here for stability.
    const { token, source } = await resolveBearerToken();
    const url = `${AI_V1_BASE_URL}/voice/process`;
    const userId = await resolveUserId();

    const formData = new FormData();
    formData.append('user_id', userId);
    const audioFile: ReactNativeFile = {
      uri: audioUri,
      name: 'audio.m4a',
      type: 'audio/m4a',
    };
    formData.append('audio', audioFile as unknown as Blob);
    if (opts?.language) {
      formData.append('language', opts.language);
    }
    if (opts?.personality) {
      formData.append('personality', opts.personality);
    }
    if (opts?.user_name) {
      formData.append('user_name', opts.user_name);
    }
    if (opts?.wakeWordOnly) {
      formData.append('wake_word_only', 'true');
    }
    if (opts?.conversationHistory) {
      formData.append('conversation_history', opts.conversationHistory);
    }
    // Send device timezone + GPS so Leeloo knows the local time and exact location.
    const loc = await getDeviceLocation().catch(() => null);
    if (loc) {
      formData.append('timezone', loc.timezone);
      formData.append('latitude', String(loc.latitude));
      formData.append('longitude', String(loc.longitude));
      if (loc.city) formData.append('city', loc.city);
      if (loc.country) formData.append('country', loc.country);
    } else {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) formData.append('timezone', tz);
      } catch (_) { /* ignore */ }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      if (__DEV__) {
        console.log('[api:voice:fetch]', { url, hasAuth: Boolean(token), tokenSource: source });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: '*/*',
        },
        body: formData as unknown as BodyInit,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`) as Error & {
          response?: { status: number; data: unknown };
        };
        err.response = { status: res.status, data };
        throw err;
      }

      return { data, status: res.status };
    } catch (err: unknown) {
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        const e = new Error(
          'Voice request timed out. Try a shorter recording, or wait a moment and try again.',
        ) as Error & { code?: string };
        e.code = 'VOICE_TIMEOUT';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  wakeDetect: async (
    audioUri: string,
    language?: string,
  ): Promise<{ data: unknown; status: number }> => {
    const { token } = await resolveBearerToken();
    const userId = await resolveUserId();
    const url = `${AI_V1_BASE_URL}/voice/wake-detect`;

    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('audio', { uri: audioUri, name: 'wake.m4a', type: 'audio/m4a' } as unknown as Blob);
    if (language) formData.append('language', language);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: '*/*' },
        body: formData as unknown as BodyInit,
        signal: controller.signal,
      });
      const data = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : { detected: false };
      return { data, status: res.status };
    } catch {
      return { data: { detected: false }, status: 0 };
    } finally {
      clearTimeout(timeoutId);
    }
  },

  processText: async (
    text: string,
    opts?: {
      language?: string;
      confirmation?: 'confirmed' | 'cancel';
      personality?: string;
      user_name?: string;
      conversationHistory?: string;
    },
  ): Promise<{ data: unknown; status: number }> => {
    // Uses fetch (same as processVoice) — Axios XHR adapter has known issues on
    // Android React Native with certain HTTPS configurations on Render.com.
    const userId = await resolveUserId();
    const { token } = await resolveBearerToken();
    const url = `${AI_V1_BASE_URL}/voice/test`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          text,
          ...(opts?.language ? { language: opts.language } : {}),
          ...(opts?.confirmation ? { confirmation: opts.confirmation } : {}),
          ...(opts?.personality ? { personality: opts.personality } : {}),
          ...(opts?.user_name ? { user_name: opts.user_name } : {}),
          ...(opts?.conversationHistory ? { conversation_history: opts.conversationHistory } : {}),
          ...(await (async () => {
            try {
              const loc = await getDeviceLocation();
              if (loc) return {
                timezone: loc.timezone,
                latitude: loc.latitude,
                longitude: loc.longitude,
                ...(loc.city ? { city: loc.city } : {}),
                ...(loc.country ? { country: loc.country } : {}),
              };
            } catch (_) {}
            try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return tz ? { timezone: tz } : {}; } catch (_) { return {}; }
          })()),
        }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`) as Error & {
          response?: { status: number; data: unknown };
        };
        err.response = { status: res.status, data };
        throw err;
      }

      return { data, status: res.status };
    } catch (err: unknown) {
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        const e = new Error('Text request timed out. Please try again.') as Error & { code?: string };
        e.code = 'ECONNABORTED';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// Tasks API
export const tasksAPI = {
  getTasks: async (filters?: { status?: string; limit?: number }) => {
    return api.get('/tasks', { params: (filters ?? {}) as QueryParams });
  },

  createTask: async (task: {
    title: string;
    description?: string;
    due_at?: string;
    metadata?: Record<string, unknown>;
  }) => {
    return api.post('/tasks', task satisfies RequestBody);
  },

  updateTask: async (id: string, updates: RequestBody) => {
    return api.patch(`/tasks/${id}`, updates);
  },

  deleteTask: async (id: string) => {
    return api.delete(`/tasks/${id}`);
  },
};

// Calendar API
export const calendarAPI = {
  syncCalendar: async (provider: 'google' | 'outlook') => {
    return api.post(`/calendar/sync/${provider}`);
  },

  // Backend accepts ?day=YYYY-MM-DD and returns { day, timezone, events: [...] }
  getEvents: async (_startDate: string, _endDate: string) => {
    // Legacy signature kept for compatibility; fetch today's events
    return api.get('/calendar/events');
  },

  getEventsForDay: async (day: string) => {
    return api.get('/calendar/events', { params: { day } as QueryParams });
  },
};

// Integrations API
//
// Backend contract lives at services/api/src/integrations/integrations.controller.ts.
// All bodies are snake_case to match the NestJS DTOs.
//
// OAuth flow (Authorization Code + PKCE):
//   1. getAuthUrl({ provider, redirect_uri })  → { url, state }
//   2. Open `url` in an in-app browser, capture the redirect with `code` and `state`.
//   3. connectIntegration({ provider, auth_code, state, redirect_uri })
//   The server holds the PKCE `code_verifier` server-side, so the mobile client
//   never sees it — that is the whole point of PKCE for public clients.
export type IntegrationProvider = 'google' | 'microsoft';

export const integrationsAPI = {
  getIntegrations: async () => {
    return api.get('/integrations');
  },

  getAuthUrl: async (provider: IntegrationProvider, redirectUri: string) => {
    return api.post('/integrations/auth-url', {
      provider,
      redirect_uri: redirectUri,
    } satisfies RequestBody);
  },

  connectIntegration: async (params: {
    provider: IntegrationProvider;
    authCode: string;
    state: string;
    redirectUri?: string;
  }) => {
    return api.post('/integrations/connect', {
      provider: params.provider,
      auth_code: params.authCode,
      state: params.state,
      ...(params.redirectUri ? { redirect_uri: params.redirectUri } : {}),
    } satisfies RequestBody);
  },

  refreshIntegration: async (provider: IntegrationProvider) => {
    return api.post('/integrations/refresh', { provider } satisfies RequestBody);
  },

  healthCheck: async (provider: IntegrationProvider) => {
    return api.post('/integrations/health', { provider } satisfies RequestBody);
  },

  disconnectIntegration: async (provider: IntegrationProvider) => {
    return api.delete(`/integrations/${provider}`);
  },

  syncGoogleCalendar: async () => {
    return api.post('/integrations/google/sync');
  },

  syncGoogleGmail: async () => {
    return api.post('/integrations/google/gmail/sync');
  },

  syncMicrosoftCalendar: async () => {
    return api.post('/integrations/microsoft/calendar/sync');
  },
};

// Profiles API
export const profilesAPI = {
  getMe: async () => {
    return api.get('/profiles/me');
  },
  updateMe: async (updates: {
    leeloo_personality?: string;
    leeloo_name?: string;
    christian_mode?: boolean;
    preferred_language?: string;
    expo_push_token?: string | null;
  }) => {
    return api.patch('/profiles/me', updates satisfies RequestBody);
  },
};

export const memoriesAPI = {
  list: async (params?: { category?: string; limit?: number }) =>
    api.get('/memories', { params }),
  save: async (content: string, category: string) =>
    api.post('/memories/save', { content, category }),
};

export const verseAPI = {
  daily: async () => api.get('/verse/daily'),
};

export const contactsAPI = {
  sync: async (contacts: Array<{ name: string; phone?: string; email?: string; source?: string }>) =>
    api.post('/contacts/sync', { contacts }),
};

export const familyAPI = {
  list: async () => api.get('/family/members'),
};

export const weatherAPI = {
  get: async (city?: string) =>
    api.get('/weather', { params: city ? ({ city } as QueryParams) : {} }),
};

export const shoppingListAPI = {
  getItems: async (store?: string) =>
    api.get('/shopping-list', { params: store ? ({ store } as QueryParams) : {} }),
  addItems: async (items: string[], store?: string) =>
    api.post('/shopping-list/add', { items, ...(store ? { store } : {}) } satisfies RequestBody),
  checkItem: async (id: string) =>
    api.post(`/shopping-list/${id}/check`),
  clearStore: async (store: string) =>
    api.delete(`/shopping-list/clear/${store}`),
};

export default api;
