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
2. Create bucket: `audio` (public)
3. Create bucket: `avatars` (public)

Or run these SQL commands:

```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('audio', 'audio', true);

INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true);
```

## Setting Up Storage Policies

For the `audio` bucket:

```sql
CREATE POLICY "Audio files are publicly accessible"
ON storage.objects FOR SELECT
USING ( bucket_id = 'audio' );

CREATE POLICY "Authenticated users can upload audio"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'audio' 
  AND auth.role() = 'authenticated'
);
```

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
