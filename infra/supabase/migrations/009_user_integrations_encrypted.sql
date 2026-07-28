-- 009_user_integrations_encrypted.sql
-- Encrypt OAuth tokens at rest with AES-256-GCM.
--
-- Why:
--   Until this migration, `user_integrations.access_token` and
--   `user_integrations.refresh_token` were stored as plaintext TEXT.
--   A DB breach (read-only leak, compromised service_role key, stolen
--   logical backup) would expose every connected Google Calendar / Gmail /
--   Microsoft account in plaintext. This violates OWASP A02 and is a
--   non-negotiable blocker for premium production.
--
-- Strategy:
--   1. Add encrypted columns alongside the plaintext ones (no destructive
--      changes â€” pre-launch so no backfill needed, but the additive shape
--      means we could roll back).
--   2. New writes use *_enc + *_iv + *_tag exclusively (see CryptoService).
--   3. `key_version` lets us rotate ENCRYPTION_KEY without re-encrypting
--      everything in one shot â€” the app reads the version and selects the
--      right key.
--   4. The plaintext columns stay nullable but the API code stops writing
--      them. They will be DROPped in a future migration once we confirm
--      production has zero plaintext rows for >= 1 week.
--
-- Idempotent: every ALTER/INDEX uses IF NOT EXISTS.

-- Make sure the base table exists. Until now it was created at runtime by
-- IntegrationsService.ensureSchema() â€” we are removing that anti-pattern,
-- so this migration is the canonical source of truth from here on.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

-- Encrypted columns (AES-256-GCM, base64 TEXT).
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

COMMENT ON COLUMN user_integrations.access_token IS
  'DEPRECATED. Plaintext. Will be DROPped after the encrypted columns ship.';
COMMENT ON COLUMN user_integrations.refresh_token IS
  'DEPRECATED. Plaintext. Will be DROPped after the encrypted columns ship.';
COMMENT ON COLUMN user_integrations.access_token_enc IS
  'AES-256-GCM ciphertext (base64) of access_token. AAD = "user_id:provider".';
COMMENT ON COLUMN user_integrations.refresh_token_enc IS
  'AES-256-GCM ciphertext (base64) of refresh_token. AAD = "user_id:provider".';
COMMENT ON COLUMN user_integrations.key_version IS
  'ENCRYPTION_KEY version used. Allows zero-downtime key rotation.';

-- Drop the legacy "integrations" table from 001 if it exists. Nothing in the
-- codebase reads it; keeping two parallel integration tables is a footgun.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'integrations') THEN
    EXECUTE 'DROP TABLE integrations CASCADE';
  END IF;
END$$;

