-- 007_clerk_rls_fix.sql
-- Fix RLS to work with Clerk JWTs instead of Supabase Auth.
--
-- Context:
--   Leeloo uses Clerk for auth. The Supabase JWT `auth.uid()` helper always
--   returns NULL because the JWT is issued by Clerk, not by Supabase Auth.
--   Every RLS policy that compared `auth.uid()` was effectively letting any
--   authenticated request through OR blocking all of them, depending on how
--   the supabase-js client was configured. This is a data-leak class bug.
--
-- Strategy:
--   1. Ensure `profiles.clerk_user_id TEXT UNIQUE` exists (some envs created
--      it ad-hoc; we make it idempotent and indexed).
--   2. Expose `public.clerk_user_id()` â€” extracts `sub` from the Clerk JWT
--      claims that Supabase forwards to Postgres via PostgREST.
--   3. Expose `public.clerk_profile_id()` â€” resolves the internal `profiles.id`
--      UUID from the current Clerk subject. SECURITY DEFINER + STABLE so it
--      is cached per-statement and bypasses RLS on `profiles` for the lookup.
--   4. Rewrite every RLS policy on every user-scoped table to use these
--      helpers.
--
-- Service-role connections (the API/worker) bypass RLS entirely, so the
-- backend code is unaffected. RLS only kicks in for direct supabase-js calls
-- from mobile (e.g. Realtime subscriptions).
--
-- Idempotency: every statement is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. profiles.clerk_user_id
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'profiles_clerk_user_id_key'
  ) THEN
    -- Unique partial index ignores legacy rows without clerk_user_id.
    EXECUTE 'CREATE UNIQUE INDEX profiles_clerk_user_id_key
             ON profiles(clerk_user_id) WHERE clerk_user_id IS NOT NULL';
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id
  ON profiles(clerk_user_id);

COMMENT ON COLUMN profiles.clerk_user_id IS
  'Clerk JWT subject (sub claim). Authoritative external identity.';

-- ---------------------------------------------------------------------------
-- 2. public.clerk_user_id() â€” read sub from JWT claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clerk_user_id() RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )
$$;

COMMENT ON FUNCTION auth.clerk_user_id IS
  'Returns the Clerk subject (sub claim) from the current request JWT, or NULL.';

-- ---------------------------------------------------------------------------
-- 3. public.clerk_profile_id() â€” resolve internal UUID
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clerk_profile_id() RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.profiles
  WHERE clerk_user_id = public.clerk_user_id()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.clerk_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clerk_profile_id() TO anon, authenticated, service_role;

COMMENT ON FUNCTION auth.clerk_profile_id IS
  'Returns profiles.id for the current Clerk subject. SECURITY DEFINER so RLS '
  'on profiles does not block the lookup. STABLE for per-statement caching.';

-- ---------------------------------------------------------------------------
-- 4. Helper to (re)apply the standard "own rows" policy
-- ---------------------------------------------------------------------------
-- We drop legacy auth.uid() policies and re-create Clerk-aware ones.
-- Pattern: user_id column references profiles.id, so we compare against
-- public.clerk_profile_id().

-- profiles (special case: row is keyed by clerk_user_id directly)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_self_select" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;

CREATE POLICY "profiles_self_select" ON profiles
  FOR SELECT
  USING (clerk_user_id = public.clerk_user_id());

CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE
  USING (clerk_user_id = public.clerk_user_id())
  WITH CHECK (clerk_user_id = public.clerk_user_id());

-- tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can create own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;
DROP POLICY IF EXISTS "tasks_owner_all" ON tasks;
CREATE POLICY "tasks_owner_all" ON tasks
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- memories
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own memories" ON memories;
DROP POLICY IF EXISTS "Users can create own memories" ON memories;
DROP POLICY IF EXISTS "memories_owner_all" ON memories;
CREATE POLICY "memories_owner_all" ON memories
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- child_requests (parent_id)
ALTER TABLE child_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "child_requests_owner_all" ON child_requests;
CREATE POLICY "child_requests_owner_all" ON child_requests
  FOR ALL
  USING (parent_id = public.clerk_profile_id())
  WITH CHECK (parent_id = public.clerk_profile_id());

-- calendar_events
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_events_owner_all" ON calendar_events;
CREATE POLICY "calendar_events_owner_all" ON calendar_events
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- devices
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devices_owner_all" ON devices;
CREATE POLICY "devices_owner_all" ON devices
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- wake_events
ALTER TABLE wake_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wake_events_owner_all" ON wake_events;
CREATE POLICY "wake_events_owner_all" ON wake_events
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- conversation_logs
ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversation_logs_owner_all" ON conversation_logs;
CREATE POLICY "conversation_logs_owner_all" ON conversation_logs
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- voice_profiles (migration 003)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'voice_profiles') THEN
    EXECUTE 'ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users manage own voice profiles" ON voice_profiles';
    EXECUTE 'DROP POLICY IF EXISTS "voice_profiles_owner_all" ON voice_profiles';
    EXECUTE 'CREATE POLICY "voice_profiles_owner_all" ON voice_profiles
             FOR ALL
             USING (user_id = public.clerk_profile_id())
             WITH CHECK (user_id = public.clerk_profile_id())';
  END IF;
END$$;

-- briefings (migration 005)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'briefings') THEN
    EXECUTE 'ALTER TABLE briefings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users see own briefings" ON briefings';
    EXECUTE 'DROP POLICY IF EXISTS "briefings_owner_all" ON briefings';
    EXECUTE 'CREATE POLICY "briefings_owner_all" ON briefings
             FOR ALL
             USING (user_id = public.clerk_profile_id())
             WITH CHECK (user_id = public.clerk_profile_id())';
  END IF;
END$$;

-- pending_leeloo_mentions (migration 005)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_leeloo_mentions') THEN
    EXECUTE 'ALTER TABLE pending_leeloo_mentions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users see own mentions" ON pending_leeloo_mentions';
    EXECUTE 'DROP POLICY IF EXISTS "mentions_owner_all" ON pending_leeloo_mentions';
    EXECUTE 'CREATE POLICY "mentions_owner_all" ON pending_leeloo_mentions
             FOR ALL
             USING (user_id = public.clerk_profile_id())
             WITH CHECK (user_id = public.clerk_profile_id())';
  END IF;
END$$;

-- push_tokens (migration 006)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_tokens') THEN
    EXECUTE 'ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Users manage own push tokens" ON push_tokens';
    EXECUTE 'DROP POLICY IF EXISTS "push_tokens_owner_all" ON push_tokens';
    EXECUTE 'CREATE POLICY "push_tokens_owner_all" ON push_tokens
             FOR ALL
             USING (user_id = public.clerk_profile_id())
             WITH CHECK (user_id = public.clerk_profile_id())';
  END IF;
END$$;

-- integrations (legacy from 001 â€” keep policy aligned if the table exists at all)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrations') THEN
    EXECUTE 'ALTER TABLE integrations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "integrations_owner_all" ON integrations';
    EXECUTE 'CREATE POLICY "integrations_owner_all" ON integrations
             FOR ALL
             USING (user_id = public.clerk_profile_id())
             WITH CHECK (user_id = public.clerk_profile_id())';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 5. Verification helper
-- ---------------------------------------------------------------------------
-- Run after migration to confirm: every user-data table has RLS enabled
-- and at least one policy.
--
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
--          (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--   ORDER BY c.relname;

