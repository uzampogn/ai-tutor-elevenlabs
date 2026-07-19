/**
 * Guarded Langfuse singleton (spec/eval-harness): mirrors the embeddings.ts
 * degradation pattern — no LANGFUSE_* keys ⇒ everything is a silent no-op and
 * the app behaves exactly as before this feature existed.
 */
import { LangfuseSpanProcessor } from '@langfuse/otel';

export function langfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

let processor: LangfuseSpanProcessor | null = null;

export function getLangfuseProcessor(): LangfuseSpanProcessor | null {
  if (!langfuseEnabled()) return null;
  if (!processor) processor = new LangfuseSpanProcessor();
  return processor;
}

/** Flush pending events; never throws into the caller (chat path safety). */
export async function flushLangfuse(): Promise<void> {
  try {
    await processor?.forceFlush();
  } catch (err) {
    console.warn('[langfuse] flush failed:', err);
  }
}
