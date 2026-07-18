// Relocated from src/app/api/speak/route.ts (byte-identical behavior).
// Defines the canonical spoken string: markdown markers removed so the text
// reads naturally to ElevenLabs TTS. This is the single source of truth that
// both the API route and buildSpokenDoc (read-along) share.

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, (m) => m.replace(/`/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(?!\s)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/(?<!\w)__(?!\s)([^_\n]*?\S)__(?!\w)/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)([^*\n]*?\S)\*(?![\w*])/g, '$1')
    .replace(/(?<!\w)_(?!\s)([^_\n]*?\S)_(?!\w)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
