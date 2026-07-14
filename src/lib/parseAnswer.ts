// Pure, framework-free parsing helpers for the streamed markdown answer.
// No markdown library; the answer surface is small (bold, italics, paragraphs).
// These functions are fully unit-testable and have no React/DOM dependencies.

import type { Article } from './scraper';

export interface ParsedAnswer {
  /** Markdown before the Business Impact heading (trimmed). */
  body: string;
  /** Text under the Business Impact heading (trimmed), or null if absent. */
  impact: string | null;
}

/**
 * Tolerant matcher for the Business Impact heading line.
 *
 * Matches (case-insensitive), the heading occupying its own line:
 *   - optional leading whitespace
 *   - optional markdown heading hashes (`#`, `##`, …)
 *   - optional `💼` emoji (with optional surrounding whitespace)
 *   - optional `**` bold wrapper
 *   - the words "business impact"
 *   - optional closing `**`
 *   - optional trailing `:` and whitespace
 *
 * Examples that match: "💼 Business Impact", "## Business Impact",
 * "**Business Impact**", "Business Impact:", "### 💼 **Business Impact**:".
 */
const IMPACT_HEADING =
  /^[ \t]*#{0,6}[ \t]*(?:💼[ \t]*)?(?:\*\*)?[ \t]*business impact[ \t]*(?:\*\*)?[ \t]*:?[ \t]*$/im;

/**
 * Split a markdown answer into its body and (optional) Business Impact section.
 *
 * Streaming-safe: when the heading hasn't arrived yet, everything is `body`
 * and `impact` is null. Empty/whitespace input yields `{ body: '', impact: null }`.
 */
export function parseAnswer(markdown: string): ParsedAnswer {
  if (!markdown || !markdown.trim()) {
    return { body: '', impact: null };
  }

  const match = IMPACT_HEADING.exec(markdown);
  if (!match || match.index === undefined) {
    return { body: markdown.trim(), impact: null };
  }

  const headingStart = match.index;
  const headingEnd = headingStart + match[0].length;

  const body = markdown.slice(0, headingStart).trim();
  const impact = markdown.slice(headingEnd).trim();

  return { body, impact: impact.length > 0 ? impact : '' };
}

/** Collapse all runs of whitespace to single spaces and lowercase. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Recover the source articles cited in an answer by matching article titles
 * against the answer text (case-insensitive, whitespace-normalized substring).
 *
 * - Returns a subset of `articles`, preserving the original objects (and URLs).
 * - No duplicates; original article order is preserved.
 * - Empty title or no match => excluded; no matches at all => [].
 */
export function matchSources(answer: string, articles: Article[]): Article[] {
  if (!answer || !answer.trim() || articles.length === 0) return [];

  const haystack = normalize(answer);
  const seen = new Set<string>();
  const matched: Article[] = [];

  for (const article of articles) {
    const needle = normalize(article.title);
    if (!needle) continue;
    if (seen.has(article.url)) continue;
    if (haystack.includes(needle)) {
      matched.push(article);
      seen.add(article.url);
    }
  }

  return matched;
}

/**
 * Client-safe slug extraction (mirrors db.slugFromUrl, which lives in a
 * server-only module and must not be imported by components).
 */
export function articleSlug(url: string): string {
  const m = url.match(/\/blog\/([^/?#]+)/);
  return m ? m[1] : url;
}

/**
 * Chips source-of-truth (spec/rag-retrieval-citations): when the chat response
 * carried retrieved slugs (X-Sources), map them to articles preserving the
 * retrieval (similarity) order; otherwise fall back to legacy title matching.
 */
export function resolveSources(
  slugs: string[] | undefined,
  answer: string,
  articles: Article[],
): Article[] {
  if (slugs && slugs.length > 0 && articles.length > 0) {
    const bySlug = new Map(articles.map((a) => [articleSlug(a.url), a]));
    const resolved = slugs
      .map((s) => bySlug.get(s))
      .filter((a): a is Article => a !== undefined);
    if (resolved.length > 0) return resolved;
  }
  return matchSources(answer, articles);
}

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

const UL_LINE = /^[-*] /;
const OL_LINE = /^\d+\. /;

type LineKind = 'ul' | 'ol' | 'para';

function lineKind(line: string): LineKind {
  if (UL_LINE.test(line)) return 'ul';
  if (OL_LINE.test(line)) return 'ol';
  return 'para';
}

/**
 * Split a markdown body into renderable blocks.
 *
 * Chunks are separated by blank lines, but within each chunk we group
 * CONSECUTIVE lines by kind — so a label line immediately followed by bullets
 * (model skipped the blank line) still yields a `[paragraph, ul]` pair instead
 * of one mangled paragraph. Streaming-safe: a partial trailing line with no
 * confirmed list prefix simply lands in a paragraph run.
 */
export function parseBlocks(body: string): Block[] {
  if (!body || !body.trim()) return [];

  const chunks = body.split(/\n{2,}/);
  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    let run: { kind: LineKind; lines: string[] } | null = null;

    const flush = () => {
      if (!run) return;
      if (run.kind === 'ul') {
        blocks.push({ type: 'ul', items: run.lines.map((l) => l.replace(UL_LINE, '')) });
      } else if (run.kind === 'ol') {
        blocks.push({ type: 'ol', items: run.lines.map((l) => l.replace(OL_LINE, '')) });
      } else {
        blocks.push({ type: 'paragraph', text: run.lines.join('\n').trim() });
      }
      run = null;
    };

    for (const line of lines) {
      const kind = lineKind(line);
      if (run && run.kind === kind) {
        run.lines.push(line);
      } else {
        flush();
        run = { kind, lines: [line] };
      }
    }
    flush();
  }

  return blocks;
}

export type InlineToken = { type: 'text' | 'strong' | 'em'; value: string };

/**
 * Convert a single line/run of inline markdown into ordered tokens:
 *   **bold**        => { type: 'strong' }
 *   *italic* / _it_ => { type: 'em' }
 *   everything else => { type: 'text' }
 *
 * Bold is matched before italics so `**x**` is not mis-read as nested emphasis.
 * Unmatched/partial markers are emitted as plain text (streaming-safe).
 */
export function parseInline(text: string): InlineToken[] {
  if (!text) return [];

  const tokens: InlineToken[] = [];
  // Order matters: **bold** first, then *em* / _em_.
  const pattern = /(\*\*([^*]+?)\*\*)|(\*([^*]+?)\*)|(_([^_]+?)_)/g;

  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }

    if (m[2] !== undefined) {
      tokens.push({ type: 'strong', value: m[2] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'em', value: m[4] });
    } else if (m[6] !== undefined) {
      tokens.push({ type: 'em', value: m[6] });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}
