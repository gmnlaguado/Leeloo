# Supabase Database Setup

## Prerequisites

1. Create a Supabase project at https://supabase.com
2. Copy your project URL and keys to `.env`

## Running Migrations

### Option 1: Using Supabase CLI (Recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

### Option 2: Manual SQL Execution

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `migrations/001_initial_schema.sql`
4. Run the query

## Setting Up Storage Buckets

After running the migrations, create storage buckets:

1. Go to Storage section in Supabase Dashboard
2. Create bucket: `audio` (**private** — do not check "Public bucket")
3. Create bucket: `avatars` (public)

Or run these SQL commands:

```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio', 'audio', false);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true);
```

> **Security note:** the `audio` bucket used to be created `public: true` with
> a blanket "anyone can SELECT" policy. That let anyone who obtained an
> `audio_url` (from `conversation_logs` or `briefings`) fetch any user's
> voice recording, bypassing table-level RLS entirely — bucket-level public
> access is a separate authorization boundary from `public.*` table RLS.
> `010_secure_audio_bucket.sql` fixes this for existing projects by flipping
> the bucket to private and replacing the public policy with the owner-scoped
> one below. New projects should provision the bucket as private from the
> start, as shown above.

## Setting Up Storage Policies

The `audio` bucket is **private** and scoped per-user. Objects must be
uploaded under a `${profileId}/<filename>` path, where `profileId` is the
uploader's `profiles.id` (the same identity `auth.clerk_profile_id()`
resolves from the Clerk JWT — see `007_clerk_rls_fix.sql`). Policies compare
the leading path segment (via `storage.foldername(name)`) against
`auth.clerk_profile_id()`, so a user can only read/write objects under their
own folder:

```sql
CREATE POLICY "audio_owner_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'audio'
    AND auth.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.clerk_profile_id()::text
  );

CREATE POLICY "audio_owner_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'audio'
    AND auth.clerk_profile_id() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.clerk_profile_id()::text
  );

-- (see 010_secure_audio_bucket.sql for the matching UPDATE/DELETE policies)
```

Because the bucket is private, backend services (which connect with the
`service_role` key and bypass RLS, same as every table) must hand out a
**short-lived signed URL** rather than a permanent public one whenever an
audio file needs to be served to a client:

```ts
const { data, error } = await supabase.storage
  .from('audio')
  .createSignedUrl(objectPath, 3600); // 1 hour
```

Only store the bare `objectPath` (e.g. `${profileId}/2026-07-22-briefing.mp3`)
in `conversation_logs.audio_url` / `briefings.audio_url` — never a permanent
public URL — and generate the signed URL on demand at read time.

## Environment Variables

Add these to your `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Enabling pgvector for Semantic Search (Optional)

For advanced memory retrieval:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE memories ADD COLUMN embedding vector(1536);

CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

## Testing the Setup

Run this query to verify tables were created:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected tables:
- profiles
- devices
- tasks
- memories
- integrations
- child_requests
- calendar_events
- wake_events
- conversation_logs
