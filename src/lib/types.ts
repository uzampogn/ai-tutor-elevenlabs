// Single source of truth for shared app types & constants.

// Re-export Article so consumers can import it from one place (`@/lib/types`)
// while keeping its sole definition in scraper.ts (do not redefine it).
export type { Article } from './scraper';

/** A single turn in the conversation. */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** The 4 suggested questions surfaced in the Welcome empty-state and composer quick chips. */
export const SUGGESTED: string[] = [
  'What are the latest AI developments this month?',
  "How does Claude's latest update affect businesses?",
  "Explain the key research findings from Anthropic's recent posts",
  'What should a non-technical executive know about recent AI news?',
];
