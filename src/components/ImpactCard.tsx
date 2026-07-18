// "Business Impact" callout card. Renders the impact region of a SpokenDoc via
// DocBlocks, so the impact words are wrapped in addressable .s/.w spans by the
// same doc-driven construction as the main body (the decorative .impact-label
// is NOT a spoken word and stays span-free).

import DocBlocks from './DocBlocks';
import type { SpokenDoc } from '@/lib/readAlong/spokenDoc';

interface ImpactCardProps {
  doc: SpokenDoc;
}

export default function ImpactCard({ doc }: ImpactCardProps) {
  return (
    <div className="impact">
      <div className="impact-label">
        <span aria-hidden="true">💼</span> Business Impact
      </div>
      <div className="impact-text">
        <DocBlocks doc={doc} region="impact" />
      </div>
    </div>
  );
}
