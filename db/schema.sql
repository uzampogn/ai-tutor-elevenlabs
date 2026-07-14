-- Canonical DDL for the persistent KB store (spec/kb-postgres-store).
-- Created idempotently at runtime by src/lib/db.ts:ensureSchema(); this file
-- is the human-readable reference and can be run by hand in the Neon console.

CREATE TABLE IF NOT EXISTS articles (
  slug        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL DEFAULT '',   -- djb2(title+body); '' = no cached summary (force re-summarize)
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  pub_date    TIMESTAMPTZ,                -- nullable; dateless posts sort last
  description TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  hero_image  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_meta (
  id                    INT PRIMARY KEY DEFAULT 1,
  last_successful_fetch TIMESTAMPTZ,
  last_error            TEXT,
  CONSTRAINT kb_meta_singleton CHECK (id = 1)
);

-- Vector layer (spec/rag-retrieval-citations, backlog #2). Created idempotently
-- by db.ts:ensureVectorSchema(); if CREATE EXTENSION is refused over the pooled
-- role, enable "vector" once in the Supabase dashboard (Database → Extensions).
-- Dims = 1024 (voyage-3.5-lite). No vector index on purpose: ~24 rows — a seq
-- scan wins. Revisit at ~1k rows (backlog #1 multi-source).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedded_hash TEXT NOT NULL DEFAULT ''; -- "<model>:<djb2>" at embed time
