/**
 * Push curated items to the Langfuse dataset (spec/eval-harness §3).
 * Upserts by item id; only curated items go up. Run: npm run eval:push
 */
import { readFileSync } from 'node:fs';
import { LangfuseClient } from '@langfuse/client';
import { EVAL_DATASET_NAME, type EvalItem } from '@/lib/eval/dataset';

async function main() {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error('[eval:push] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY required');
    process.exit(1);
  }
  const items: EvalItem[] = JSON.parse(readFileSync('eval/dataset.json', 'utf8'));
  const curated = items.filter((i) => i.curated);
  if (curated.length === 0) {
    console.error('[eval:push] no curated items — edit eval/dataset.json first');
    process.exit(1);
  }

  const langfuse = new LangfuseClient();
  try {
    await langfuse.api.datasets.create({ name: EVAL_DATASET_NAME, description: 'RAG golden set (spec/eval-harness)' });
    console.log(`[eval:push] created dataset ${EVAL_DATASET_NAME}`);
  } catch {
    // already exists — fine, we upsert items below
  }

  for (const item of curated) {
    await langfuse.dataset.createItem({
      datasetName: EVAL_DATASET_NAME,
      id: item.id, // stable id ⇒ re-push upserts instead of duplicating
      input: { question: item.question },
      expectedOutput: { slugs: item.expectedSlugs },
      metadata: { kind: item.kind },
    });
  }
  console.log(`[eval:push] upserted ${curated.length} curated items to ${EVAL_DATASET_NAME}`);
}

main().catch((err) => { console.error('[eval:push] failed:', err); process.exit(1); });
