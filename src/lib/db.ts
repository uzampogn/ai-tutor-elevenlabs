import postgres from 'postgres';
import type { Article } from './scraper';

export interface ArticleRow extends Article {
  hash: string;
}
export interface KbMeta {
  lastSuccessfulFetch: number | null; // epoch ms
  lastError: string | null;
}

const url = process.env.DATABASE_URL;
// Supabase transaction pooler (port 6543) is serverless-safe. `prepare: false` is REQUIRED there:
// transaction-mode pooling hands each query a different backend, so prepared statements can't be
// reused. `max: 1` keeps per-instance connections minimal; the client is module-scoped so warm
// invocations reuse it. `sql` is a tagged-template query fn — null when unconfigured, so every
// export no-ops (pure live-scrape fallback).
const sql = url ? postgres(url, { prepare: false, max: 1, idle_timeout: 20 }) : null;

/** Canonical slug derivation (PK). Mirrors the blog URL shape. */
export function slugFromUrl(u: string): string {
  const m = u.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : u;
}

let schemaReady: Promise<void> | null = null;
export async function ensureSchema(): Promise<void> {
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS articles (
        slug TEXT PRIMARY KEY, hash TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
        url TEXT NOT NULL, pub_date TIMESTAMPTZ, description TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        hero_image TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS kb_meta (
        id INT PRIMARY KEY DEFAULT 1, last_successful_fetch TIMESTAMPTZ, last_error TEXT,
        CONSTRAINT kb_meta_singleton CHECK (id = 1)
      )`;
    })();
  }
  return schemaReady;
}

type Row = Record<string, unknown>;
function rowToArticle(r: Row): Article {
  const pd = r.pub_date as string | Date | null;
  return {
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    pubDate: pd ? new Date(pd).toISOString() : '',
    description: String(r.description ?? ''),
    body: String(r.body ?? ''),
    summary: String(r.summary ?? ''),
    heroImage: String(r.hero_image ?? ''),
  };
}

export async function getArticles(): Promise<Article[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = (await sql`
    SELECT slug, hash, title, url, pub_date, description, body, summary, hero_image
    FROM articles ORDER BY pub_date DESC NULLS LAST`) as Row[];
  return rows.map(rowToArticle);
}

export async function getKnownSummaries(): Promise<Map<string, { hash: string; summary: string }>> {
  const map = new Map<string, { hash: string; summary: string }>();
  if (!sql) return map;
  await ensureSchema();
  const rows = (await sql`SELECT slug, hash, summary FROM articles WHERE hash <> ''`) as Row[];
  for (const r of rows) map.set(String(r.slug), { hash: String(r.hash), summary: String(r.summary) });
  return map;
}

export async function upsertArticles(rows: ArticleRow[]): Promise<void> {
  if (!sql || rows.length === 0) return;
  await ensureSchema();
  for (const a of rows) {
    await sql`
      INSERT INTO articles (slug, hash, title, url, pub_date, description, body, summary, hero_image, updated_at)
      VALUES (${slugFromUrl(a.url)}, ${a.hash}, ${a.title}, ${a.url}, ${a.pubDate || null},
              ${a.description}, ${a.body}, ${a.summary}, ${a.heroImage}, now())
      ON CONFLICT (slug) DO UPDATE SET
        hash = EXCLUDED.hash, title = EXCLUDED.title, url = EXCLUDED.url,
        pub_date = EXCLUDED.pub_date, description = EXCLUDED.description, body = EXCLUDED.body,
        summary = EXCLUDED.summary, hero_image = EXCLUDED.hero_image, updated_at = now()`;
  }
}

export async function deleteMissing(keepSlugs: string[]): Promise<void> {
  if (!sql || keepSlugs.length === 0) return; // empty list → never wipe the table
  await ensureSchema();
  await sql`DELETE FROM articles WHERE slug <> ALL(${keepSlugs})`;
}

export async function readMeta(): Promise<KbMeta> {
  if (!sql) return { lastSuccessfulFetch: null, lastError: null };
  await ensureSchema();
  const rows = (await sql`SELECT last_successful_fetch, last_error FROM kb_meta WHERE id = 1`) as Row[];
  if (rows.length === 0) return { lastSuccessfulFetch: null, lastError: null };
  const r = rows[0];
  return {
    lastSuccessfulFetch: r.last_successful_fetch ? new Date(r.last_successful_fetch as string).getTime() : null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

export async function writeMeta(patch: { lastSuccessfulFetch?: number | null; lastError?: string | null }): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  const current = await readMeta();
  const nextFetch = patch.lastSuccessfulFetch !== undefined ? patch.lastSuccessfulFetch : current.lastSuccessfulFetch;
  const nextError = patch.lastError !== undefined ? patch.lastError : current.lastError;
  const tsIso = nextFetch != null ? new Date(nextFetch).toISOString() : null;
  await sql`
    INSERT INTO kb_meta (id, last_successful_fetch, last_error)
    VALUES (1, ${tsIso}, ${nextError})
    ON CONFLICT (id) DO UPDATE SET
      last_successful_fetch = EXCLUDED.last_successful_fetch, last_error = EXCLUDED.last_error`;
}
