-- 010_secure_audio_bucket.sql
-- Lock down the `audio` Supabase Storage bucket.
--
-- Context (security audit finding):
--   The `audio` bucket was created with `public: true` (see the manual setup
--   instructions in infra/supabase/README.md and the commented-out INSERT in
--   001_initial_schema.sql, lines ~218-220) and paired with the storage
--   policy:
--
--     CREATE POLICY "Audio files are publicly accessible"
--     ON storage.objects FOR SELECT
--     USING ( bucket_id = 'audio' );
--
--   Bucket-level `public = true` plus a `bucket_id = 'audio'` SELECT policy
--   means ANY object in the bucket is fetchable by ANYONE who has (or
--   guesses/leaks) its URL â€” regardless of table-level RLS on
--   conversation_logs / briefings. Table RLS on the `audio_url` COLUMN is
--   irrelevant once the underlying object is public; this is a distinct
--   authorization boundary (storage.objects / storage.buckets), not the
--   public.* tables.
--
-- Fix:
--   1. Flip the bucket to private (`public = false`). Objects can no longer
--      be fetched via the public CDN URL; every read must go through
--      Supabase's authenticated storage API (RLS-checked) or a
--      time-limited signed URL minted with `createSignedUrl()`.
--   2. Replace the blanket "anyone can read the bucket" policy with one
--      scoped to the owning user, using the same Clerk-JWT-based helper
--      (`public.clerk_profile_id()`) introduced in 007_clerk_rls_fix.sql.
--   3. Require the object path to be namespaced by the owner's profile id,
--      i.e. `${profileId}/...` (the first path segment, extracted with
--      `storage.foldername()`). This is the path convention new uploads to
--      this bucket must follow going forward.
--
-- NOTE on current usage: as of this migration, no code path in
-- services/api or services/worker actually uploads to or reads from the
-- Supabase `audio` bucket (TTS responses are stored in Cloudflare R2 via
-- R2Service, and conversation_logs.audio_url / briefings.audio_url are not
-- currently populated by any INSERT/UPDATE in the codebase). This migration
-- closes the bucket-level exposure regardless, so that if/when a feature
-- starts writing real audio into this bucket, it inherits a private,
-- per-user-scoped bucket from day one instead of the public one.
--
-- DATA MIGRATION NOTE (manual review required, not automated here):
--   If any existing rows in conversation_logs.audio_url or briefings.audio_url
--   contain a full public Supabase Storage URL (e.g.
--   "https://<project>.supabase.co/storage/v1/object/public/audio/...")
--   rather than a bare object path, those URLs will now 404 once the bucket
--   is private (which is the point â€” the old URLs were permanently public
--   and should be treated as already compromised). Do NOT attempt to
--   auto-rewrite them in this migration:
--     - We cannot safely infer the correct new per-profile object path for
--       historical rows without knowing how/if they were actually uploaded.
--     - Any row with a public URL predates this fix and its audio should be
--       considered exposed; re-upload/re-generate rather than "migrate" it.
--   Recommended manual step: run
--     SELECT id, user_id, audio_url FROM conversation_logs WHERE audio_url LIKE 'http%';
--     SELECT id, user_id, audio_url FROM briefings WHERE audio_url LIKE 'http%';
--   against the live DB and triage any hits by hand.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Make the bucket private.
-- ---------------------------------------------------------------------------
-- Guarded: only runs if the bucket exists (it's normally created out-of-band
-- per infra/supabase/README.md, not by a migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'audio') THEN
    UPDATE storage.buckets SET public = false WHERE id = 'audio';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Replace the public-read policy with an owner-scoped one.
-- ---------------------------------------------------------------------------
-- Drop the old public policies (names as documented in infra/supabase/README.md).
DROP POLICY IF EXISTS "Audio files are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload audio" ON storage.objects;

-- Path convention: objects must be stored as `${profileId}/<filename>`, where
-- `profileId` is the UUID from `profiles.id` (i.e. `public.clerk_profile_id()`).
-- `storage.foldername(name)` returns the path split into an array of folder
-- segments, so `(storage.foldername(name))[1]` is that leading profileId
-- segment.

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

-- Service-role connections (the API/worker) bypass RLS entirely, same as
-- every other table in this project (see 007_clerk_rls_fix.sql). Backend
-- code can still read/write any object; only direct supabase-js calls from
-- mobile are constrained by these policies. Backend code that needs to hand
-- an audio file to a client should mint a short-lived signed URL via
-- `supabase.storage.from('audio').createSignedUrl(path, 3600)` rather than
-- relying on a permanent public URL.

-- ---------------------------------------------------------------------------
-- 3. Verification helper
-- ---------------------------------------------------------------------------
--   SELECT id, public FROM storage.buckets WHERE id = 'audio';
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'audio_%';

