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

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || getDefaultApiBaseUrl();
const AI_ORCHESTRATOR_BASE_URL =
  process.env.EXPO_PUBLIC_AI_ORCHESTRATOR_URL || getDefaultAiOrchestratorBaseUrl();
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
    opts?: { language?: string; personality?: string; user_name?: string; wakeWordOnly?: boolean },
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

  processText: async (
    text: string,
    opts?: { language?: string; confirmation?: 'confirmed' | 'cancel'; personality?: string; user_name?: string },
  ): Promise<AxiosResponse<unknown>> => {
    // The ai-orchestrator identifies the caller from the verified Clerk JWT
    // (AuthGuard), not from `user_id` in the body — that field is accepted but
    // ignored server-side. A Bearer token is required or the request 401s.
    const userId = await resolveUserId();
    const { token } = await resolveBearerToken();
    return axios.post(
      `${AI_V1_BASE_URL}/voice/test`,
      {
        user_id: userId,
        text,
        ...(opts?.language ? { language: opts.language } : {}),
        ...(opts?.confirmation ? { confirmation: opts.confirmation } : {}),
        ...(opts?.personality ? { personality: opts.personality } : {}),
        ...(opts?.user_name ? { user_name: opts.user_name } : {}),
      } satisfies RequestBody,
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
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

  getEvents: async (startDate: string, endDate: string) => {
    return api.get('/calendar/events', { params: { startDate, endDate } });
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

export default api;
