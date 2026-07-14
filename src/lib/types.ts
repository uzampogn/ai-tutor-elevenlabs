// Single source of truth for shared app types & constants.

// Re-export Article so consumers can import it from one place (`@/lib/types`)
// while keeping its sole definition in scraper.ts (do not redefine it).
export type { Article } from './scraper';

/** A single turn in the conversation. */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Retrieved-source slugs (X-Sources header order) for assistant turns. */
  sources?: string[];
}

/** AI-generated score-card digest for one article (see lib/digest.ts). */
export interface ArticleDigest {
  tldr: string; // 1–2 sentences
  takeaways: string[]; // 3–4 bullets
  whyItMatters: string; // one business-impact line
  tags: string[]; // exactly 3 topic tags
  questions: string[]; // 2–3 self-contained tutor questions
}

/** The 4 suggested questions surfaced in the Welcome empty-state and composer quick chips. */
export const SUGGESTED: string[] = [
  'What are the latest AI developments this month?',
  "How does Claude's latest update affect businesses?",
  "Explain the key research findings from Anthropic's recent posts",
  'What should a non-technical executive know about recent AI news?',
];
