/**
 * Deterministic citation-integrity scoring (spec/eval-harness §4, group 2).
 * Reuses the REAL display-path transforms from parseAnswer.ts so the eval
 * guards the same glue/strip invariant the read-aloud alignment depends on.
 */
import { glueCitations, CITATION_SENTINEL_RE } from '@/lib/parseAnswer';

const MARKER_RE = /\[(\d{1,2})\]/g;

export function scoreCitations(answer: string, retrievedCount: number): Record<string, number> {
  const markers = Array.from(answer.matchAll(MARKER_RE), (m) => Number(m[1]));

  const inRange =
    retrievedCount === 0
      ? markers.length === 0
      : markers.every((n) => n >= 1 && n <= retrievedCount);

  const glued = glueCitations(answer);
  const sentinelCount = Array.from(
    glued.matchAll(new RegExp(CITATION_SENTINEL_RE.source, 'g')),
  ).length;
  const glueRoundtrip = sentinelCount === markers.length;

  const scores: Record<string, number> = {
    'citations.in_range': inRange ? 1 : 0,
    'citations.glue_roundtrip': glueRoundtrip ? 1 : 0,
  };
  if (retrievedCount > 0) {
    scores['citations.coverage'] =
      new Set(markers.filter((n) => n >= 1 && n <= retrievedCount)).size / retrievedCount;
  }
  return scores;
}
