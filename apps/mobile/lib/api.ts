import axios from 'axios';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const getDefaultApiBaseUrl = () => {
  const hostUri =
    (Constants.expoConfig as any)?.hostUri ||
    (Constants as any)?.expoGoConfig?.debuggerHost ||
    (Constants.manifest as any)?.debuggerHost ||
    null;

  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
  return host ? `http://${host}:3000` : 'http://localhost:3000';
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || getDefaultApiBaseUrl();
const FALLBACK_BEARER_TOKEN =
  process.env.EXPO_PUBLIC_BEARER_TOKEN ||
  ((Constants.expoConfig as any)?.extra?.EXPO_PUBLIC_BEARER_TOKEN as
    | string
    | undefined) ||
  ((Constants.expoConfig as any)?.extra?.bearerToken as string | undefined);

const DEV_DEFAULT_TOKEN = __DEV__ ? 'leeloo-dev' : undefined;

const API_V1_BASE_URL = `${API_BASE_URL}/v1`;

const resolveBearerToken = async (): Promise<{ token?: string; source: string }> => {
  let sessionToken: string | undefined;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    sessionToken = session?.access_token;
  } catch (e) {
    if (__DEV__) {
      console.log('[api] supabase.getSession failed (expected if Supabase disabled):', String(e));
    }
  }

  const token = sessionToken || FALLBACK_BEARER_TOKEN || DEV_DEFAULT_TOKEN;
  const source = sessionToken
    ? 'supabase'
    : FALLBACK_BEARER_TOKEN
      ? 'env'
      : DEV_DEFAULT_TOKEN
        ? 'dev_default'
        : 'none';

  return { token, source };
};

console.log('[api] API_BASE_URL =', API_BASE_URL);
console.log('[api] Has EXPO_PUBLIC_BEARER_TOKEN =', Boolean(FALLBACK_BEARER_TOKEN));

const api = axios.create({
  baseURL: API_V1_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  const { token, source: tokenSource } = await resolveBearerToken();

  config.headers = (config.headers ?? {}) as any;
  if (token) {
    (config.headers as any).Authorization = `Bearer ${token}`;
  }

  // Important: let axios set proper multipart boundary.
  try {
    const isFormData =
      typeof FormData !== 'undefined' &&
      config.data &&
      (config.data as any) instanceof FormData;
    if (isFormData) {
      delete (config.headers as any)['Content-Type'];
    }
  } catch {
    // ignore
  }

  if (__DEV__) {
    const hasAuth = Boolean((config.headers as any)?.Authorization);
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
  processVoice: async (audioUri: string, opts?: { language?: string }) => {
    // Axios + multipart is flaky in RN/Expo Go. Use fetch here for stability.
    const { token, source } = await resolveBearerToken();
    const url = `${API_V1_BASE_URL}/voice/process`;

    const formData = new FormData();
    formData.append('audio', {
      uri: audioUri,
      name: 'audio.m4a',
      type: 'audio/m4a',
    } as any);
    if (opts?.language) {
      formData.append('language', opts.language);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

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
        body: formData as any,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();

      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.response = { status: res.status, data };
        throw err;
      }

      return { data, status: res.status } as any;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  processText: async (text: string, opts?: { language?: string }) => {
    return api.post('/voice/process', {
      text,
      ...(opts?.language ? { language: opts.language, user_context: { language: opts.language } } : {}),
    });
  },
};

// Tasks API
export const tasksAPI = {
  getTasks: async (filters?: { status?: string; limit?: number }) => {
    return api.get('/tasks', { params: filters });
  },

  createTask: async (task: {
    title: string;
    description?: string;
    due_at?: string;
    metadata?: Record<string, any>;
  }) => {
    return api.post('/tasks', task);
  },

  updateTask: async (id: string, updates: any) => {
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
export const integrationsAPI = {
  getIntegrations: async () => {
    return api.get('/integrations');
  },

  connectIntegration: async (provider: string, authCode: string) => {
    return api.post('/integrations/connect', { provider, authCode });
  },

  disconnectIntegration: async (id: string) => {
    return api.delete(`/integrations/${id}`);
  },
};

export default api;
