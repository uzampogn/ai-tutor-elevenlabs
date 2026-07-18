/**
 * Next.js instrumentation hook: registers the OTel tracer provider with the
 * Langfuse span processor — only in the Node runtime and only when keys exist.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { langfuseEnabled, getLangfuseProcessor } = await import('@/lib/langfuse');
  if (!langfuseEnabled()) return;
  const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
  const provider = new NodeTracerProvider({ spanProcessors: [getLangfuseProcessor()!] });
  provider.register();
}
