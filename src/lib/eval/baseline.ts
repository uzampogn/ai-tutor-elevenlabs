/**
 * Baseline regression gate (spec/eval-harness §5): committed aggregates with
 * per-metric tolerances; regression = current < baseline − tolerance.
 * All metrics are higher-is-better by construction.
 */
export interface BaselineFile {
  runName: string;
  /** git SHA at accept time. */
  acceptedAt: string;
  metrics: Record<string, { value: number; tolerance: number }>;
}

export interface DiffRow {
  metric: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  verdict: 'ok' | 'FAIL' | 'new';
}

/** Judge scores are LLM-noisy (1–5 scale) → 0.3; deterministic 0–1 metrics → 0.02. */
export function defaultTolerance(metric: string): number {
  return metric.startsWith('judge.') ? 0.3 : 0.02;
}

export function diffAgainstBaseline(
  baseline: BaselineFile | null,
  current: Record<string, number>,
): { rows: DiffRow[]; failed: boolean } {
  const rows: DiffRow[] = [];
  let failed = false;

  for (const [metric, value] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const base = baseline?.metrics[metric];
    if (!base) {
      rows.push({ metric, baseline: null, current: value, delta: null, verdict: 'new' });
      continue;
    }
    const delta = value - base.value;
    const isFail = value < base.value - base.tolerance - 1e-9; // epsilon: boundary counts as ok
    if (isFail) failed = true;
    rows.push({ metric, baseline: base.value, current: value, delta, verdict: isFail ? 'FAIL' : 'ok' });
  }

  return { rows, failed };
}

export function toBaseline(
  runName: string,
  acceptedAt: string,
  current: Record<string, number>,
): BaselineFile {
  const metrics: BaselineFile['metrics'] = {};
  for (const [metric, value] of Object.entries(current)) {
    metrics[metric] = { value, tolerance: defaultTolerance(metric) };
  }
  return { runName, acceptedAt, metrics };
}

export function formatDiffTable(rows: DiffRow[]): string {
  const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(3));
  const header = ['metric'.padEnd(28), 'baseline'.padEnd(10), 'current'.padEnd(10), 'Δ'.padEnd(9), 'verdict'].join(' ');
  const lines = rows.map((r) =>
    [r.metric.padEnd(28), fmt(r.baseline).padEnd(10), fmt(r.current).padEnd(10), fmt(r.delta).padEnd(9), r.verdict].join(' '),
  );
  return [header, ...lines].join('\n');
}
