/** Deterministic retrieval scoring (spec/eval-harness §4, metric group 1). */
import type { EvalKind } from './dataset';

export function scoreRetrieval(
  expectedSlugs: string[],
  retrievedSlugs: string[],
  kind: EvalKind,
): Record<string, number> {
  if (kind === 'offtopic') {
    return { 'retrieval.offtopic_pass': retrievedSlugs.length === 0 ? 1 : 0 };
  }

  const expected = new Set(expectedSlugs);
  const hits = retrievedSlugs.filter((s) => expected.has(s));

  const recall = expected.size === 0 ? 0 : hits.length / expected.size;
  const precision = retrievedSlugs.length === 0 ? 0 : hits.length / retrievedSlugs.length;
  const firstHit = retrievedSlugs.findIndex((s) => expected.has(s));
  const mrr = firstHit === -1 ? 0 : 1 / (firstHit + 1);

  return { 'retrieval.recall': recall, 'retrieval.precision': precision, 'retrieval.mrr': mrr };
}
