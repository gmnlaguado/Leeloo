-- ============================================================
-- LEELOO — MIGRACIÓN COMPLETA AL NUEVO PROYECTO SUPABASE
-- Aplica todas las migraciones 001→010 en orden.
-- Pegar en: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- ============================================================
-- 001: Schema inicial
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  locale TEXT DEFAULT 'es-CO',
  timezone TEXT DEFAULT 'America/Bogota',
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  device_token TEXT,
  push_token TEXT,
  wake_word_enabled BOOLEAN DEFAULT FALSE,
  listening_hours JSONB DEFAULT '{"start": "06:00", "end": "22:00"}',
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(device_token)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  created_by TEXT DEFAULT 'user' CHECK (created_by IN ('user', 'child', 'leeloo')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('routine', 'preference', 'family', 'work', 'spiritual', 'other')),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  confidence REAL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  last_used TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_last_used ON memories(last_used DESC);

CREATE TABLE IF NOT EXISTS child_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  child_name TEXT NOT NULL,
  message TEXT NOT NULL,
  request_type TEXT DEFAULT 'task' CHECK (request_type IN ('task', 'reminder', 'question', 'other')),
  suggested_time TIMESTAMPTZ,
  approved BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_child_requests_parent_id ON child_requests(parent_id);
CREATE INDEX IF NOT EXISTS idx_child_requests_approved ON child_requests(approved);

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  integration_id UUID,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  attendees JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(start_time);

CREATE TABLE IF NOT EXISTS wake_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_wake_events_user_id ON wake_events(user_id);
CREATE INDEX IF NOT EXISTS idx_wake_events_timestamp ON wake_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS conversation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  transcription TEXT,
  intent JSONB,
  response TEXT,
  audio_url TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_user_id ON conversation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_created_at ON conversation_logs(created_at DESC);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 003: Voice profiles (Azure Speaker Recognition)
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  azure_profile_id TEXT NOT NULL,
  is_owner BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_active ON voice_profiles(user_id, is_active);

ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_voice_profiles_updated_at
  BEFORE UPDATE ON voice_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 004: Personality + Christian mode + Leeloo rename
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS leeloo_personality TEXT DEFAULT 'default'
    CHECK (leeloo_personality IN (
      'default', 'christian', 'coach', 'mentor', 'business', 'counselor', 'faith'
    ));

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS leeloo_name TEXT DEFAULT 'Leeloo';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS christian_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'es';

CREATE INDEX IF NOT EXISTS idx_profiles_personality ON profiles(leeloo_personality);

-- ============================================================
-- 005: Briefings + pending mentions
-- ============================================================

CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  briefing_kind TEXT NOT NULL DEFAULT 'morning',
  audio_url TEXT,
  text_content TEXT NOT NULL,
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_user_date ON briefings(user_id, briefing_date DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_undelivered ON briefings(user_id, delivered) WHERE delivered = false;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pending_leeloo_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  mention_kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  consumed BOOLEAN DEFAULT false,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentions_user_unconsumed
  ON pending_leeloo_mentions(user_id, consumed, created_at DESC) WHERE consumed = false;
ALTER TABLE pending_leeloo_mentions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 006: Push tokens
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_label TEXT,
  platform TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON push_tokens(user_id) WHERE is_active = true;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 007: Clerk RLS helpers (en schema PUBLIC — evita error de permisos en auth)
-- Las funciones leen request.jwt.claims que PostgREST inyecta en cada request.
-- Funciona igual que en auth.* pero accesible desde el SQL Editor.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'profiles_clerk_user_id_key'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX profiles_clerk_user_id_key
             ON profiles(clerk_user_id) WHERE clerk_user_id IS NOT NULL';
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id ON profiles(clerk_user_id);

-- Extrae el sub del JWT de Clerk (inyectado por PostgREST como request.jwt.claims)
CREATE OR REPLACE FUNCTION public.clerk_user_id() RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )
$$;

-- Resuelve el profiles.id UUID a partir del sub del JWT de Clerk
CREATE OR REPLACE FUNCTION public.clerk_profile_id() RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.profiles
  WHERE clerk_user_id = public.clerk_user_id()
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.clerk_user_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clerk_profile_id() TO anon, authenticated, service_role;

-- profiles
DROP POLICY IF EXISTS "profiles_self_select" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
CREATE POLICY "profiles_self_select" ON profiles
  FOR SELECT USING (clerk_user_id = public.clerk_user_id());
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE
  USING (clerk_user_id = public.clerk_user_id())
  WITH CHECK (clerk_user_id = public.clerk_user_id());

-- tasks
DROP POLICY IF EXISTS "tasks_owner_all" ON tasks;
CREATE POLICY "tasks_owner_all" ON tasks
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- memories
DROP POLICY IF EXISTS "memories_owner_all" ON memories;
CREATE POLICY "memories_owner_all" ON memories
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- child_requests
DROP POLICY IF EXISTS "child_requests_owner_all" ON child_requests;
CREATE POLICY "child_requests_owner_all" ON child_requests
  FOR ALL
  USING (parent_id = public.clerk_profile_id())
  WITH CHECK (parent_id = public.clerk_profile_id());

-- calendar_events
DROP POLICY IF EXISTS "calendar_events_owner_all" ON calendar_events;
CREATE POLICY "calendar_events_owner_all" ON calendar_events
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- devices
DROP POLICY IF EXISTS "devices_owner_all" ON devices;
CREATE POLICY "devices_owner_all" ON devices
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- wake_events
DROP POLICY IF EXISTS "wake_events_owner_all" ON wake_events;
CREATE POLICY "wake_events_owner_all" ON wake_events
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- conversation_logs
DROP POLICY IF EXISTS "conversation_logs_owner_all" ON conversation_logs;
CREATE POLICY "conversation_logs_owner_all" ON conversation_logs
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- voice_profiles
DROP POLICY IF EXISTS "Users manage own voice profiles" ON voice_profiles;
DROP POLICY IF EXISTS "voice_profiles_owner_all" ON voice_profiles;
CREATE POLICY "voice_profiles_owner_all" ON voice_profiles
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- briefings
DROP POLICY IF EXISTS "Users see own briefings" ON briefings;
DROP POLICY IF EXISTS "briefings_owner_all" ON briefings;
CREATE POLICY "briefings_owner_all" ON briefings
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- pending_leeloo_mentions
DROP POLICY IF EXISTS "Users see own mentions" ON pending_leeloo_mentions;
DROP POLICY IF EXISTS "mentions_owner_all" ON pending_leeloo_mentions;
CREATE POLICY "mentions_owner_all" ON pending_leeloo_mentions
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- push_tokens
DROP POLICY IF EXISTS "Users manage own push tokens" ON push_tokens;
DROP POLICY IF EXISTS "push_tokens_owner_all" ON push_tokens;
CREATE POLICY "push_tokens_owner_all" ON push_tokens
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- ============================================================
-- 008: OAuth states (CSRF + PKCE)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS oauth_states (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  state         TEXT        NOT NULL UNIQUE,
  code_verifier TEXT        NOT NULL,
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL CHECK (provider IN ('google', 'microsoft')),
  redirect_uri  TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_states_owner_all" ON oauth_states;
CREATE POLICY "oauth_states_owner_all" ON oauth_states
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states() RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE deleted INTEGER;
BEGIN
  DELETE FROM oauth_states WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END$$;

-- ============================================================
-- 009: user_integrations con tokens AES-256-GCM encriptados
-- ============================================================

CREATE TABLE IF NOT EXISTS user_integrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  access_token  TEXT NULL,
  refresh_token TEXT NULL,
  scope         TEXT NULL,
  token_type    TEXT NULL,
  expires_at    TIMESTAMPTZ NULL,
  last_sync_at  TIMESTAMPTZ NULL,
  metadata      JSONB NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

ALTER TABLE user_integrations
  ADD COLUMN IF NOT EXISTS access_token_enc   TEXT NULL,
  ADD COLUMN IF NOT EXISTS access_token_iv    TEXT NULL,
  ADD COLUMN IF NOT EXISTS access_token_tag   TEXT NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_enc  TEXT NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_iv   TEXT NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_tag  TEXT NULL,
  ADD COLUMN IF NOT EXISTS key_version        INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_user_integrations_user_provider
  ON user_integrations(user_id, provider);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_integrations_owner_all" ON user_integrations;
CREATE POLICY "user_integrations_owner_all" ON user_integrations
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- ============================================================
-- 010: Buckets de storage + RLS audio por usuario
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('audio', 'audio', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Audio files are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload audio" ON storage.objects;
DROP POLICY IF EXISTS "audio_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "audio_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "audio_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "audio_owner_delete" ON storage.objects;

CREATE POLICY "audio_owner_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'audio'
    AND public.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.clerk_profile_id()::text
  );

CREATE POLICY "audio_owner_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'audio'
    AND public.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.clerk_profile_id()::text
  );

CREATE POLICY "audio_owner_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'audio'
    AND public.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.clerk_profile_id()::text
  )
  WITH CHECK (
    bucket_id = 'audio'
    AND public.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.clerk_profile_id()::text
  );

CREATE POLICY "audio_owner_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'audio'
    AND public.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = public.clerk_profile_id()::text
  );

-- ============================================================
-- VERIFICACIÓN — ejecuta esto en una query separada después:
-- ============================================================
-- SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo,
--        (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
-- ORDER BY c.relname;
