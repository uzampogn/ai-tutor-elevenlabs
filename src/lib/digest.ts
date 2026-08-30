import Anthropic from '@anthropic-ai/sdk';
import * as db from './db';
import type { Article, ArticleDigest } from './types';

/**
 * Per-article "score card" digest, generated at ingest and persisted in
 * Postgres keyed by slug + content hash (sibling of lib/summarize.ts). Every
 * failure degrades to `null` for that article rather than dropping it or
 * throwing. The read path (`/api/digest`) never enters this module.
 */

const DIGEST_MODEL = process.env.DIGEST_MODEL ?? 'claude-sonnet-5';
// Sonnet 5's tokenizer produces ~30% more tokens for the same text than
// Haiku 4.5's, so give the JSON digest a matching bump in output headroom.
const DIGEST_MAX_TOKENS = 800;
const BODY_INPUT_CAP = 12_000;
const CONCURRENCY = 5;

const DIGEST_SYSTEM_PROMPT =
  'You are an AI-news tutor distilling a Claude blog post into a score card. ' +
  'Return ONLY a JSON object — no markdown, no code fence, no preamble — with these keys: ' +
  'tldr (a 1-2 sentence string), takeaways (array of 3-4 short strings), ' +
  'whyItMatters (one sentence on the business impact for a non-technical reader), ' +
  'tags (array of exactly 3 short topic tags), ' +
  'questions (array of 2-3 self-contained questions a curious learner would ask about THIS article). ' +
  'Every field is plain text — no markdown.';

// One guarded client at module scope: a missing key degrades to null digests
// rather than crashing ingest at import time (mirrors lib/summarize.ts).
let client: Anthropic | null = null;
try {
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch (err) {
  console.error('[digest] client init failed; digests will be null:', err);
  client = null;
}

/** Cheap stable hash (djb2) over title+body — changes only when content changes. */
function contentHash(title: string, body: string): string {
  const input = `${title} ${body}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function slugFromUrl(url: string): string {
  const m = url.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : url;
}

/** Pull the JSON object out of the reply, tolerating a ```json fence or stray prose. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidDigest(v: unknown): v is ArticleDigest {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.tldr === 'string' &&
    isStringArray(d.takeaways) &&
    typeof d.whyItMatters === 'string' &&
    isStringArray(d.tags) &&
    isStringArray(d.questions)
  );
}

/** Digest one article. Never throws — returns null on any failure. */
export async function digestArticle(a: Article): Promise<ArticleDigest | null> {
  const body = (a.body ?? '').trim();
  if (!body || !client) return null;

  try {
    const res = await client.messages.create({
      model: DIGEST_MODEL,
      max_tokens: DIGEST_MAX_TOKENS,
      // Sonnet 5 runs adaptive thinking when `thinking` is omitted, and thinking
      // tokens count against max_tokens. The digest is a fixed-shape JSON task —
      // keep the pre-bump (non-thinking) behavior so the small cap can't truncate.
      thinking: { type: 'disabled' },
      system: DIGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${a.title}\n\n${body.slice(0, BODY_INPUT_CAP)}` }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    const parsed: unknown = JSON.parse(extractJson(text));
    return isValidDigest(parsed) ? parsed : null;
  } catch (err) {
    console.error(`[digest] failed for ${a.url}:`, err);
    return null;
  }
}

/**
 * Ingest step: digest every article whose content hash differs from the stored
 * digest_hash, persisting non-null results immediately (failures leave the
 * stored hash unchanged, so the next ingest retries). Never throws — a digest
 * problem must not block ingest.
 */
export async function digestStaleArticles(
  articles: Article[],
): Promise<{ digested: number; failed: number }> {
  try {
    // No DB → `getDigestStates()` returns an empty map (every article looks
    // stale) and `updateDigests()` discards the results, so the whole step is a
    // Sonnet burst with nowhere to land. Digests are only ever read back from
    // Postgres, so skip rather than pay for them. (`default — unratified`.)
    if (!client || !db.isDbConfigured()) return { digested: 0, failed: 0 };
    const states = await db.getDigestStates();
    const stale = articles.filter((a) => {
      if (!(a.body ?? '').trim()) return false; // nothing meaningful to digest
      return states.get(slugFromUrl(a.url)) !== contentHash(a.title, a.body ?? '');
    });
    let digested = 0;
    let failed = 0;
    for (let i = 0; i < stale.length; i += CONCURRENCY) {
      const chunk = stale.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (a) => ({ a, digest: await digestArticle(a) })),
      );
      const rows = results
        .filter((r): r is { a: Article; digest: ArticleDigest } => r.digest !== null)
        .map((r) => ({
          slug: slugFromUrl(r.a.url),
          digest: r.digest,
          digestHash: contentHash(r.a.title, r.a.body ?? ''),
        }));
      await db.updateDigests(rows);
      digested += rows.length;
      failed += results.length - rows.length;
    }
    return { digested, failed };
  } catch (err) {
    console.error('[digest] digestStaleArticles failed:', err);
    return { digested: 0, failed: 0 };
  }
}
