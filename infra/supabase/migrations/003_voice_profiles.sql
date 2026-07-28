-- Migration 003: voice biometrics profiles
-- Speaker Recognition profile registry (Azure Cognitive Services).
-- One row per registered speaker per user (e.g. owner + each child voice).

CREATE TABLE IF NOT EXISTS voice_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,           -- 'owner', 'child_antonella', 'child_enzo', ...
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

DROP POLICY IF EXISTS "Users manage own voice profiles" ON voice_profiles;
CREATE POLICY "Users manage own voice profiles"
  ON voice_profiles FOR ALL
  USING (auth.uid() IN (SELECT user_id FROM profiles WHERE id = voice_profiles.user_id))
  WITH CHECK (auth.uid() IN (SELECT user_id FROM profiles WHERE id = voice_profiles.user_id));

CREATE TRIGGER update_voice_profiles_updated_at
  BEFORE UPDATE ON voice_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE voice_profiles IS 'Speaker recognition profiles (Azure) for owner and child voice IDs';
