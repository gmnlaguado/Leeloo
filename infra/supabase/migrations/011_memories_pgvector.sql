-- Migration 011: Add pgvector embeddings to memories table
-- Enables semantic similarity search so Leeloo retrieves the most
-- relevant memories for each conversation turn, not just the most recent.
--
-- Run in Supabase SQL Editor → enable extension first, then add column + index.

-- 1. Enable pgvector extension (safe to run if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column — 1536 dims matches text-embedding-3-small
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. HNSW index for fast approximate nearest-neighbor search
--    ef_construction=64 gives a good balance of build speed vs recall.
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw
  ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Partial index — only rows with an embedding (avoids scanning NULLs)
CREATE INDEX IF NOT EXISTS memories_embedding_not_null
  ON memories (user_id)
  WHERE embedding IS NOT NULL;
