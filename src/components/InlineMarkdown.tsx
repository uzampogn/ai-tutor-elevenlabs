// Renders a run of inline markdown (**bold**, *em*/_em_) into React nodes
// using the pure parseInline tokenizer. No dangerouslySetInnerHTML.
//
// Read-along spans (word/sentence addressing) are handled by DocBlocks (Spec
// 10), which renders directly from spokenText offsets. InlineMarkdown stays a
// plain, span-free renderer — still used by ScoreCard.

import { Fragment } from 'react';
import { parseInline } from '@/lib/parseAnswer';

interface InlineMarkdownProps {
  text: string;
}

export default function InlineMarkdown({ text }: InlineMarkdownProps) {
  const tokens = parseInline(text);

  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'strong') return <strong key={i}>{t.value}</strong>;
        if (t.type === 'em') return <em key={i}>{t.value}</em>;
        return <Fragment key={i}>{t.value}</Fragment>;
      })}
    </>
  );
}
