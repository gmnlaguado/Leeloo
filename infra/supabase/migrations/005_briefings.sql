-- 005_briefings.sql
-- Stores Leeloo's nightly tomorrow-briefings and morning briefings.

CREATE TABLE IF NOT EXISTS briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  briefing_kind TEXT NOT NULL DEFAULT 'morning', -- morning | tomorrow_preview
  audio_url TEXT,
  text_content TEXT NOT NULL,
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_user_date
  ON briefings(user_id, briefing_date DESC);

CREATE INDEX IF NOT EXISTS idx_briefings_undelivered
  ON briefings(user_id, delivered)
  WHERE delivered = false;

ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own briefings" ON briefings;
CREATE POLICY "Users see own briefings" ON briefings
  FOR ALL USING (auth.uid() = user_id);

-- pending_leeloo_mentions: things Leeloo should bring up the next time the user
-- talks to her. Populated by the calendar-guardian worker.
CREATE TABLE IF NOT EXISTS pending_leeloo_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  mention_kind TEXT NOT NULL, -- overdue_task | calendar_conflict | upcoming_event | pending_approval
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  consumed BOOLEAN DEFAULT false,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentions_user_unconsumed
  ON pending_leeloo_mentions(user_id, consumed, created_at DESC)
  WHERE consumed = false;

ALTER TABLE pending_leeloo_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own mentions" ON pending_leeloo_mentions;
CREATE POLICY "Users see own mentions" ON pending_leeloo_mentions
  FOR ALL USING (auth.uid() = user_id);
