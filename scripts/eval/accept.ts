/**
 * Bless the latest eval run as the regression baseline (spec/eval-harness §5).
 * Deliberate, reviewable: the resulting eval/baseline.json diff goes in a PR.
 * Run: npm run eval:accept
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toBaseline } from '@/lib/eval/baseline';

const LAST_RUN_PATH = 'eval/last-run.json';
const BASELINE_PATH = 'eval/baseline.json';

if (!existsSync(LAST_RUN_PATH)) {
  console.error('[eval:accept] no eval/last-run.json — run `npm run eval` first');
  process.exit(1);
}
const last = JSON.parse(readFileSync(LAST_RUN_PATH, 'utf8')) as {
  runName: string; sha: string; aggregates: Record<string, number>;
};
writeFileSync(BASELINE_PATH, JSON.stringify(toBaseline(last.runName, last.sha, last.aggregates), null, 2) + '\n');
console.log(`[eval:accept] baseline ← ${last.runName} (${Object.keys(last.aggregates).length} metrics). Review + commit eval/baseline.json.`);
