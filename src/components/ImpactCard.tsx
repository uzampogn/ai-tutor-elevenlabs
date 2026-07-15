// "Business Impact" callout card. Renders the parsed impact text with inline
// markdown support. When a read-along cursor is supplied, the impact words are
// wrapped in addressable .s/.w spans (the decorative .impact-label is NOT a
// spoken word and stays span-free).

import InlineMarkdown from './InlineMarkdown';
import type { Article } from '@/lib/types';
import type { WordCursor } from '@/lib/readAlong/spokenDoc';

interface ImpactCardProps {
  text: string;
  /** Optional read-along cursor over the impact region's words. */
  cursor?: WordCursor;
  /** Positional citation targets, forwarded to InlineMarkdown. */
  citeTargets?: (Article | undefined)[];
}

export default function ImpactCard({ text, cursor, citeTargets }: ImpactCardProps) {
  return (
    <div className="impact">
      <div className="impact-label">
        <span aria-hidden="true">💼</span> Business Impact
      </div>
      <p className="impact-text">
        <InlineMarkdown text={text} cursor={cursor} citeTargets={citeTargets} />
      </p>
    </div>
  );
}
