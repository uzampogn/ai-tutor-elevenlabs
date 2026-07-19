/**
 * In-repo LLM judge (spec/eval-harness §4, group 3): 4 rubric dimensions,
 * 1–5 each, strict JSON out, one retry, null on failure (never throws).
 * The rubric is version-controlled here on purpose — PR-reviewable.
 */
import type Anthropic from '@anthropic-ai/sdk';

export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'claude-sonnet-4-6';
const JUDGE_MAX_TOKENS = 800;

const DIMENSIONS = ['groundedness', 'citation_faithfulness', 'relevance', 'pedagogy'] as const;

export interface JudgeVerdict {
  /** Keys: judge.groundedness, judge.citation_faithfulness, judge.relevance, judge.pedagogy — values 1–5. */
  scores: Record<string, number>;
  rationales: Record<string, string>;
}

export function buildJudgePrompt(question: string, sourcesBlock: string, answer: string): string {
  return `You are a strict evaluation judge for an AI news tutor. The tutor answered a question using ONLY the source excerpts below (numbered [Source n]); inline [n] markers in the answer cite those sources.

Score the ANSWER on four dimensions, each an integer 1 (very poor) to 5 (excellent):
- groundedness: are the answer's claims supported by the provided excerpts, not outside knowledge? Unsupported claims lower the score.
- citation_faithfulness: does each [n] marker cite a source that actually supports the sentence it follows? Wrong or decorative citations lower the score. If the answer has no markers, judge whether that is appropriate (e.g. nothing was retrieved).
- relevance: does the answer address the question that was asked?
- pedagogy: is it clear, well structured, and pitched at a tutor-appropriate depth?

Return ONLY a JSON object — no markdown, no code fence, no preamble — exactly this shape:
{"groundedness":{"score":N,"rationale":"one sentence"},"citation_faithfulness":{"score":N,"rationale":"one sentence"},"relevance":{"score":N,"rationale":"one sentence"},"pedagogy":{"score":N,"rationale":"one sentence"}}

QUESTION:
${question}

SOURCE EXCERPTS:
${sourcesBlock || '(nothing was retrieved for this question)'}

ANSWER:
${answer}`;
}

/** Pull the JSON object out of the reply, tolerating a ```json fence (same pattern as digest.ts). */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

export function parseJudgeJson(text: string): JudgeVerdict | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(text));
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, { score?: unknown; rationale?: unknown }>;
    const scores: Record<string, number> = {};
    const rationales: Record<string, string> = {};
    for (const dim of DIMENSIONS) {
      const entry = obj[dim];
      const score = entry?.score;
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) return null;
      scores[`judge.${dim}`] = score;
      rationales[`judge.${dim}`] = typeof entry.rationale === 'string' ? entry.rationale : '';
    }
    return { scores, rationales };
  } catch {
    return null;
  }
}

export async function judgeAnswer(
  client: Anthropic,
  args: { question: string; sourcesBlock: string; answer: string },
): Promise<JudgeVerdict | null> {
  const prompt = buildJudgePrompt(args.question, args.sourcesBlock, args.answer);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.messages.create({
        model: EVAL_JUDGE_MODEL,
        max_tokens: JUDGE_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      const verdict = parseJudgeJson(text);
      if (verdict) return verdict;
    } catch (err) {
      console.error('[eval:judge] call failed:', err);
      return null;
    }
  }
  return null;
}
