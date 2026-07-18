import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prepareAnswerContext, CHAT_MODEL, CHAT_MAX_TOKENS } from '@/lib/answerPipeline';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const { system, retrieved } = await prepareAnswerContext(messages);

  const encoder = new TextEncoder();
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
          if (chunk.type === 'message_start' && process.env.NODE_ENV !== 'production') {
            const u = chunk.message.usage;
            console.log('[chat] cache usage', {
              cache_read: u.cache_read_input_tokens,
              cache_creation: u.cache_creation_input_tokens,
              input: u.input_tokens,
            });
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        console.error('[chat] Stream error:', err);
        controller.enqueue(encoder.encode('Sorry, an error occurred. Please try again.'));
      } finally {
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
