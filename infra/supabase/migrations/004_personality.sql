-- Migration 004: personality + Christian mode + Leeloo rename per user
-- Adds the columns the mobile Settings screen and the system prompt builder need.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS leeloo_personality TEXT DEFAULT 'default'
    CHECK (leeloo_personality IN (
      'default', 'christian', 'coach', 'mentor', 'business', 'counselor', 'faith'
    ));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS leeloo_name TEXT DEFAULT 'Leeloo';

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS christian_mode BOOLEAN DEFAULT FALSE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'es';

CREATE INDEX IF NOT EXISTS idx_profiles_personality ON profiles(leeloo_personality);

COMMENT ON COLUMN profiles.leeloo_personality IS 'Active personality preset for Leeloo (see @leeloo/ai-prompts).';
COMMENT ON COLUMN profiles.leeloo_name IS 'User-facing assistant name. Defaults to Leeloo, can be renamed.';
COMMENT ON COLUMN profiles.christian_mode IS 'Opt-in Christian content (verses, prayers).';
