// Relocated from src/app/api/speak/route.ts (byte-identical behavior).
// Defines the canonical spoken string: markdown markers removed so the text
// reads naturally to ElevenLabs TTS. This is the single source of truth that
// both the API route and buildSpokenDoc (read-along) share.

export function stripMarkdown(text: string): string {
  let out = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Inline citation markers (spec/rag-retrieval-citations 02): delete glued
  // "[n]" so TTS never speaks them. MUST mirror glueCitations in parseAnswer.ts
  // — same guarded pattern, same until-stable loop (adjacent "[1][2]") — or
  // read-along word alignment breaks. Start-of-line markers are kept on both
  // sides (literal there too).
  let prev: string;
  do {
    prev = out;
    out = out.replace(/(\S)[ \t]*\[\d{1,2}\]/g, '$1');
  } while (out !== prev);

  return out
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
