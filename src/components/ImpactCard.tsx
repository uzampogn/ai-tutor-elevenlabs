// "Business Impact" callout card. Renders the parsed impact text with inline
// markdown support.

import InlineMarkdown from './InlineMarkdown';

export default function ImpactCard({ text }: { text: string }) {
  return (
    <div className="impact">
      <div className="impact-label">
        <span aria-hidden="true">💼</span> Business Impact
      </div>
      <p className="impact-text">
        <InlineMarkdown text={text} />
      </p>
    </div>
  );
}
