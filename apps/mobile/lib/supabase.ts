/**
 * Supabase client for the mobile app.
 *
 * IMPORTANT: Auth is handled by Clerk. This client is used ONLY for
 * Realtime subscriptions and direct DB queries that don't need RLS-by-uid.
 * Do NOT use supabase.auth.* anywhere in the mobile codebase.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : ({
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({
            data: { subscription: { unsubscribe: () => undefined } },
          }),
        },
      } as unknown as SupabaseClient);
