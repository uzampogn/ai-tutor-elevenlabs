// "Business Impact" callout card. Renders the impact region of a SpokenDoc via
// DocBlocks, so the impact words are wrapped in addressable .s/.w spans by the
// same doc-driven construction as the main body (the decorative .impact-label
// is NOT a spoken word and stays span-free).

import DocBlocks from './DocBlocks';
import type { Article } from '@/lib/types';
import type { SpokenDoc } from '@/lib/readAlong/spokenDoc';

interface ImpactCardProps {
  doc: SpokenDoc;
  /** Positional citation targets, forwarded to DocBlocks for [n] superscripts. */
  citeTargets?: (Article | undefined)[];
}

export default function ImpactCard({ doc, citeTargets }: ImpactCardProps) {
  return (
    <div className="impact">
      <div className="impact-label">
        <span aria-hidden="true">💼</span> Business Impact
      </div>
      <div className="impact-text">
        <DocBlocks doc={doc} region="impact" citeTargets={citeTargets} />
      </div>
    </div>
  );
}
