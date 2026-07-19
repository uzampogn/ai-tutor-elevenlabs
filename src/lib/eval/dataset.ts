/**
 * Golden eval dataset types + pure merge logic (spec/eval-harness §3).
 * Seeding/pushing scripts stay thin; everything testable lives here.
 */
export const EVAL_DATASET_NAME = 'rag-golden';

export type EvalKind = 'single' | 'multi' | 'offtopic';

export interface EvalItem {
  /** Stable hash of the normalized question — upsert key locally and in Langfuse. */
  id: string;
  question: string;
  /** Expected retrieval slugs; empty for offtopic items. */
  expectedSlugs: string[];
  kind: EvalKind;
  /** Seeded candidates start false; only curated items are pushed to Langfuse. */
  curated: boolean;
}

/** djb2 over the normalized question, base36 (same scheme as digest.contentHash). */
export function questionId(question: string): string {
  const input = question.replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Existing items win (hand-edits preserved); unseen candidates are appended. */
export function mergeCandidates(existing: EvalItem[], candidates: EvalItem[]): EvalItem[] {
  const seen = new Set(existing.map((i) => i.id));
  return [...existing, ...candidates.filter((c) => !seen.has(c.id))];
}
