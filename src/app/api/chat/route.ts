import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicArticles, buildArticleContext } from '@/lib/scraper';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const articles = await getAnthropicArticles();
  const articleContext = buildArticleContext(articles);

  const systemPrompt = `You are an engaging AI news tutor specialising in the latest developments from Anthropic.

Your teaching approach:
- Open with a one-sentence summary of the most relevant point
- Use **bold** for KEY CONCEPTS and bullet points for lists
- Include a "💼 Business Impact" section in every answer
- Keep responses concise (3–5 short paragraphs max)
- Reference the article title and date when citing a source
- If the question is outside the provided articles, say so clearly

KNOWLEDGE BASE — Anthropic's 10 most recent blog articles:

${articleContext}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        for await (const chunk of messageStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
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

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
