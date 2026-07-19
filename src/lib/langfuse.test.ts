import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('langfuse guarded client', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  it('disabled without keys: no processor, flush resolves silently', async () => {
    const { langfuseEnabled, getLangfuseProcessor, flushLangfuse } = await import('./langfuse');
    expect(langfuseEnabled()).toBe(false);
    expect(getLangfuseProcessor()).toBeNull();
    await expect(flushLangfuse()).resolves.toBeUndefined(); // no throw, no network
  });

  it('enabled with keys: returns a memoized processor', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
    const { langfuseEnabled, getLangfuseProcessor } = await import('./langfuse');
    expect(langfuseEnabled()).toBe(true);
    const p = getLangfuseProcessor();
    expect(p).not.toBeNull();
    expect(getLangfuseProcessor()).toBe(p);
  });

  it('flush never throws even if the processor rejects', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
    const { getLangfuseProcessor, flushLangfuse } = await import('./langfuse');
    const p = getLangfuseProcessor()!;
    vi.spyOn(p, 'forceFlush').mockRejectedValue(new Error('network down'));
    await expect(flushLangfuse()).resolves.toBeUndefined();
  });
});
