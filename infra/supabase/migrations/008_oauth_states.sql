-- 008_oauth_states.sql
-- OAuth 2.0 Authorization Code flow hardening: state + PKCE.
--
-- Why:
--   `IntegrationsService.buildAuthUrl` previously generated a `state` but
--   did NOT persist it, and `connectIntegration` did NOT validate it.
--   This made the flow vulnerable to:
--     - CSRF (attacker tricks user into binding their Google to attacker's app)
--     - Authorization code injection (attacker replays a code obtained via
--       another channel against the victim's session)
--   Additionally the Expo mobile client is a "public" OAuth client, so it
--   MUST use PKCE (RFC 7636) to avoid the "stolen code" attack class.
--
-- Design:
--   - 10-minute TTL per state row (matches Google/Microsoft auth lifetimes).
--   - `code_verifier` stored server-side; `code_challenge` is what we send
--     to the IdP. We hold the verifier until the user comes back with `code`.
--   - `redirect_uri` is bound at request time and re-checked on callback
--     (defense-in-depth: prevents redirect_uri swap during the round-trip).
--   - UNIQUE on `state` so we cannot accept the same state twice; we DELETE
--     the row right after a successful exchange.
--
-- Backend uses the service role to read/write this table, so RLS is mostly
-- decorative â€” but we enable it anyway so that if any future mobile client
-- talks to this table directly with the anon key, it CANNOT read other
-- users' verifiers.

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

CREATE INDEX IF NOT EXISTS idx_oauth_states_user
  ON oauth_states(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON oauth_states(expires_at);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_states_owner_all" ON oauth_states;
CREATE POLICY "oauth_states_owner_all" ON oauth_states
  FOR ALL
  USING (user_id = public.clerk_profile_id())
  WITH CHECK (user_id = public.clerk_profile_id());

-- Helper: opportunistic cleanup of expired rows.
-- The API also DELETEs rows after successful exchange; this is a safety net.
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states() RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM oauth_states WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END$$;

COMMENT ON TABLE oauth_states IS
  'Short-lived OAuth 2.0 state + PKCE verifier rows. Auto-expire after 10 min.';
COMMENT ON COLUMN oauth_states.code_verifier IS
  'PKCE code_verifier (RFC 7636, 43-128 url-safe chars). NEVER logged.';
COMMENT ON COLUMN oauth_states.redirect_uri IS
  'Exact-match redirect_uri bound at /auth-url time. Re-validated on /connect.';

