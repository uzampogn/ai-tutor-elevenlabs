// Renders a run of inline markdown (**bold**, *em*/_em_) into React nodes
// using the pure parseInline tokenizer. No dangerouslySetInnerHTML.

import { Fragment } from 'react';
import { parseInline } from '@/lib/parseAnswer';

export default function InlineMarkdown({ text }: { text: string }) {
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
