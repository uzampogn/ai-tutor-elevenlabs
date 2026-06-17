import Anthropic from '@anthropic-ai/sdk';
import { getClaudeArticles } from './scraper';
import type { Article, ArticleDigest } from './types';

/**
 * Per-article "score card" digest, generated at ingest and cached by
 * slug + content hash (sibling of lib/summarize.ts). Every failure degrades to
 * `null` for that article rather than dropping it or throwing.
 */

const DIGEST_MODEL = process.env.DIGEST_MODEL ?? 'claude-haiku-4-5';
const DIGEST_MAX_TOKENS = 600;
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

/** Cache survives a body re-fetch; keyed by slug, invalidated by content hash. */
const digestCache = new Map<string, { hash: string; digest: ArticleDigest | null }>();

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
 * Digest every article, reusing cached digests for unchanged content (0 API
 * calls on a cache hit). Misses run with bounded concurrency. Returns a map
 * keyed by article URL.
 */
export async function getArticleDigests(): Promise<Record<string, ArticleDigest | null>> {
  const articles = await getClaudeArticles();
  const out: Record<string, ArticleDigest | null> = {};
  const misses: Article[] = [];

  for (const a of articles) {
    const cached = digestCache.get(slugFromUrl(a.url));
    const hash = contentHash(a.title, a.body ?? '');
    if (cached && cached.hash === hash) {
      out[a.url] = cached.digest;
    } else {
      misses.push(a);
    }
  }

  for (let i = 0; i < misses.length; i += CONCURRENCY) {
    const chunk = misses.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (a) => {
        const digest = await digestArticle(a);
        digestCache.set(slugFromUrl(a.url), {
          hash: contentHash(a.title, a.body ?? ''),
          digest,
        });
        out[a.url] = digest;
      }),
    );
  }

  return out;
}
