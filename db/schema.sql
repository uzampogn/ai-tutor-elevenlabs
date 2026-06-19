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
