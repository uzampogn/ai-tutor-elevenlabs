// Doc-driven answer renderer (Spec 10). Renders a SpokenDoc region's blocks;
// every spoken word is a spokenText slice wrapped in an addressable span, so
// the DOM word sequence equals doc.words BY CONSTRUCTION (the Spec 01
// invariant the old parallel markdown re-tokenization could not guarantee).

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { DocBlock, SpokenDoc, SpokenWord } from '@/lib/readAlong/spokenDoc';

interface DocBlocksProps {
  doc: SpokenDoc;
  region: 'body' | 'impact';
  /** Append the streaming caret after the region's last rendered word. */
  streaming?: boolean;
}

/** Render one item's words: sentence-grouped spans, gaps from spokenText. */
function renderWords(doc: SpokenDoc, wordIds: number[], keyBase: string): ReactNode[] {
  const words = wordIds.map((id) => doc.words[id]).filter(Boolean) as SpokenWord[];
  // Group contiguous same-sentence words (ids are document-ordered).
  const groups: SpokenWord[][] = [];
  for (const w of words) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].sentenceId === w.sentenceId) g.push(w);
    else groups.push([w]);
  }

  const out: ReactNode[] = [];
  groups.forEach((group, gi) => {
    // Whitespace between sentence groups stays OUTSIDE the .s span.
    if (gi > 0) {
      const prev = groups[gi - 1][groups[gi - 1].length - 1];
      const gap = doc.spokenText.slice(prev.charEnd, group[0].charStart);
      if (gap) out.push(<Fragment key={`${keyBase}-gap-${gi}`}>{gap}</Fragment>);
    }
    out.push(
      <span key={`${keyBase}-s-${gi}`} className="s" data-s={group[0].sentenceId}>
        {group.map((w, wi) => {
          const text = doc.spokenText.slice(w.charStart, w.charEnd);
          const gap = wi > 0 ? doc.spokenText.slice(group[wi - 1].charEnd, w.charStart) : '';
          const Tag = w.emphasis === 'strong' ? 'strong' : w.emphasis === 'em' ? 'em' : 'span';
          return (
            <Fragment key={w.id}>
              {gap}
              <Tag className="w" data-w={w.id}>
                {text}
              </Tag>
            </Fragment>
          );
        })}
      </span>,
    );
  });
  return out;
}

export default function DocBlocks({ doc, region, streaming }: DocBlocksProps) {
  const blocks = doc.blocks.filter((b) => b.region === region);
  const caret = streaming ? <span className="caret" /> : null;
  const lastBlock = blocks[blocks.length - 1];
  const lastBlockIsWordless = lastBlock?.type === 'code' || lastBlock?.type === 'image';

  return (
    <>
      {/* Positional keys (i, j) are safe: blocks/items are append-only during
          streaming — never reordered or removed. */}
      {blocks.map((block: DocBlock, i) => {
        const isLast = i === blocks.length - 1;
        if (block.type === 'code') {
          return (
            <pre key={i} className="ai-code">
              <code>{block.raw}</code>
            </pre>
          );
        }
        if (block.type === 'image') return null; // v1: images render nothing
        if (block.type === 'paragraph') {
          return (
            <p key={i} className="ai-para">
              {renderWords(doc, block.wordIds, `b${i}`)}
              {isLast && caret}
            </p>
          );
        }
        const List = block.type === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className="ai-list">
            {block.items.map((item, j) => (
              <li key={j} className="ai-list-item">
                {renderWords(doc, item.wordIds, `b${i}-i${j}`)}
                {isLast && j === block.items.length - 1 && caret}
              </li>
            ))}
          </List>
        );
      })}
      {blocks.length === 0 && caret}
      {lastBlockIsWordless && caret}
    </>
  );
}
