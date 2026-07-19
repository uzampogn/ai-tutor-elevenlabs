// Spec 12 — diagnostics only. Quantifies chunk-seam drift (root-cause C,
// suspected): stitched alignment total vs real audio duration.

export interface ChunkMeta { count: number; charLengths: number[]; alignSecs: number[] }

const WARN_DRIFT_SEC = 0.25;

export function driftCheck(
  audioSec: number,
  alignmentSec: number,
  meta: ChunkMeta | undefined,
): { level: 'debug' | 'warn'; message: string } {
  const delta = audioSec - alignmentSec;
  const chunks = meta?.count ?? 1;
  const level = Math.abs(delta) > WARN_DRIFT_SEC ? 'warn' : 'debug';
  const message =
    `[read-along] drift check: audio=${audioSec.toFixed(2)}s, ` +
    `alignment=${alignmentSec.toFixed(2)}s, delta=${delta.toFixed(2)}s, ` +
    `chunks=${chunks}, perChunk=[${(meta?.alignSecs ?? []).map((s) => s.toFixed(1)).join(',')}]`;
  return { level, message };
}
