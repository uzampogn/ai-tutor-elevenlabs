import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { startObservation, LangfuseOtelSpanAttributes } from '@langfuse/tracing';
import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from '@/lib/answerPipeline';
import { RETRIEVAL_K, SIM_FLOOR } from '@/lib/retrievalConfig';
import { flushLangfuse } from '@/lib/langfuse';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m?.role === 'user')
    : undefined;
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';

  const root = startObservation('chat', { input: { question } });
  // Set the trace-level name (v5 OTel keeps observation name and trace name separate;
  // Task 12's managed evaluator filters traces by name = 'chat'). Safe no-op on non-recording spans.
  root.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, 'chat');
  const retrievalSpan = root.startObservation('retrieval', { input: { question } }, { asType: 'retriever' });

  let system: Awaited<ReturnType<typeof prepareAnswerContext>>['system'];
  let retrieved: Awaited<ReturnType<typeof prepareAnswerContext>>['retrieved'];
  try {
    ({ system, retrieved } = await prepareAnswerContext(messages));
  } catch (err) {
    // Retrieval/context prep failed: end the open spans and flush so the trace isn't
    // dangling, then re-throw to preserve the exact client-visible failure (same status/body).
    try {
      retrievalSpan.end();
      root.end();
      await flushLangfuse();
    } catch (traceErr) {
      console.warn('[langfuse] trace finalize failed:', traceErr);
    }
    throw err;
  }

  retrievalSpan
    .update({
      output: { slugs: retrieved.map((r) => r.slug), similarities: retrieved.map((r) => r.similarity) },
      metadata: { k: RETRIEVAL_K, simFloor: SIM_FLOOR },
    })
    .end();

  const generation = root.startObservation(
    'generation',
    { model: CHAT_MODEL, input: { question } },
    { asType: 'generation' },
  );

  const encoder = new TextEncoder();
  let answerText = '';
  let usage: { input?: number; output?: number; cacheRead?: number } = {};

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: CHAT_MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system,
          messages,
        });
        for await (const chunk of messageStream) {
          if (chunk.type === 'message_start') {
            const u = chunk.message.usage;
            usage = { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0 };
            if (process.env.NODE_ENV !== 'production') {
              console.log('[chat] cache usage', {
                cache_read: u.cache_read_input_tokens,
                cache_creation: u.cache_creation_input_tokens,
                input: u.input_tokens,
              });
            }
          }
          if (chunk.type === 'message_delta' && chunk.usage) {
            usage.output = chunk.usage.output_tokens;
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            answerText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        console.error('[chat] Stream error:', err);
        controller.enqueue(encoder.encode('Sorry, an error occurred. Please try again.'));
      } finally {
        try {
          generation
            .update({
              output: answerText,
              usageDetails: { input: usage.input ?? 0, output: usage.output ?? 0, cache_read_input_tokens: usage.cacheRead ?? 0 },
            })
            .end();
          // Set BOTH the root observation's output and the trace-level I/O:
          // v5 OTel keeps them separate, and spec §2 requires the trace output to
          // carry the answer + source slugs (so trace-level evaluators can read it).
          const traceOutput = { answer: answerText, sources: retrieved.map((r) => r.slug) };
          root
            .update({ output: traceOutput })
            .setTraceIO({ input: { question }, output: traceOutput })
            .end();
          await flushLangfuse(); // stream is still open ⇒ serverless fn still alive; Next 14 has no after()
        } catch (err) {
          console.warn('[langfuse] trace finalize failed:', err);
        }
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  if (retrieved.length > 0) headers['X-Sources'] = retrieved.map((r) => r.slug).join(',');
  return new Response(stream, { headers });
}
