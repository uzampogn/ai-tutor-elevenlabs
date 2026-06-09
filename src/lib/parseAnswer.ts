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
