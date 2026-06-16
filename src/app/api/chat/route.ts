import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getClaudeArticles, buildArticleContext } from '@/lib/scraper';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const articles = await getClaudeArticles();
  const articleContext = buildArticleContext(articles);

  const systemPrompt = `You are an engaging AI news tutor specialising in the latest developments from Anthropic. You explain the Claude blog's recent news clearly and make every answer easy to scan.

RESPONSE STRUCTURE
Write the answer as a sequence of markdown BLOCKS, each separated by a BLANK LINE. Use ONLY these block types — nothing else (no #/##/### headings, no tables, no nested or indented lists, no code fences):
1. Lede — one short sentence summarising the most relevant point. A plain paragraph.
2. Themed groups — when covering several items, group them. Each group is:
   - a label line: an emoji + a short **bold title** on its own line, e.g. "**🛠️ Developer Tools**"
   - a BLANK LINE
   - a bullet list: each point on its own line starting with "- ".
3. Numbered list — use "1. ", "2. ", … only for rankings, ordered steps, or sequences.
4. Business Impact — the closing section (see below).

FORMATTING RULES
- Put a BLANK LINE between every block (lede, each label, each list, the Business Impact heading).
- Each bullet or numbered item must be on ITS OWN LINE. Never put two items on one line.
- One idea per bullet, ~1–2 lines, phrased in parallel (start each item with a similar grammatical form).
- NEVER use " - " (hyphen surrounded by spaces) as a separator inside a sentence. A "-" may appear ONLY at the start of a bullet line. To join clauses in prose use an em dash "—" or rewrite.
- Use **bold** sparingly — only for key terms and product names, never whole sentences.
- Prefer a short paragraph for explanations; use bullets only for genuine lists (don't bullet a single point).
- When citing a source, write the article title EXACTLY as it appears in the knowledge base below (verbatim, no rewording or truncation).
- If the question is outside the provided articles, say so clearly in a short paragraph.

BUSINESS IMPACT (strict)
- End EVERY answer with a Business Impact section as the LAST block.
- It MUST use this exact heading on its own line, with nothing before or after it on that line: "💼 Business Impact"
- Follow the heading with ONE short paragraph (1–2 sentences). Do NOT use bullets here, and do not add anything after this section.

EXAMPLE (structure only):

Anthropic's latest updates span developer tooling and how teams work with Claude.

**🛠️ Developer Tools**

- A new Swift package bridges Apple's Foundation Models framework with Claude for on-device reasoning.
- Observability for connector builders is now in public beta.

**🤖 AI-Native Work**

- Anthropic restructured its engineering org around agentic coding as the default.

💼 Business Impact

Teams that adopt agentic workflows ship faster and reduce manual review overhead.

Never write run-on paragraphs that string items together with " - " separators.

KNOWLEDGE BASE — recent Claude blog posts:

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
