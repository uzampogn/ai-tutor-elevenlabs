// "Business Impact" passage. Renders the impact region of a SpokenDoc via
// DocBlocks, so the impact words are wrapped in addressable .s/.w spans by the
// same doc-driven construction as the main body (the .impact-label heading is
// NOT a spoken word and stays span-free).
//
// `ghost` draws the passage's place when an answer arrives without the heading
// (PRODUCT.md: the takeaway closes every answer; the prompt change is eval-gated,
// so the layout never depends on the model complying).

import DocBlocks from './DocBlocks';
import type { Article } from '@/lib/types';
import type { SpokenDoc } from '@/lib/readAlong/spokenDoc';

interface ImpactCardProps {
  doc?: SpokenDoc;
  /** Positional citation targets, forwarded to DocBlocks for [n] superscripts. */
  citeTargets?: (Article | undefined)[];
  onOpenSource?: (article: Article) => void;
  ghost?: boolean;
}

export default function ImpactCard({ doc, citeTargets, onOpenSource, ghost = false }: ImpactCardProps) {
  if (ghost || !doc) {
    return (
      <div className="impact is-ghost" aria-hidden="true">
        <div className="impact-label">
          <span>💼</span> Business Impact
        </div>
        <p className="impact-ghost">Not given for this answer.</p>
      </div>
    );
  }
  return (
    <div className="impact">
      <div className="impact-label">
        <span aria-hidden="true">💼</span> Business Impact
      </div>
      <div className="impact-text">
        <DocBlocks doc={doc} region="impact" citeTargets={citeTargets} onOpenSource={onOpenSource} />
      </div>
    </div>
  );
}
