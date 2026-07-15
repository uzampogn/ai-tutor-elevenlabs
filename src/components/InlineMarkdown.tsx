// Renders a run of inline markdown (**bold**, *em*/_em_) into React nodes
// using the pure parseInline tokenizer. No dangerouslySetInnerHTML.
//
// Read-along: when a WordCursor is supplied, each spoken word is wrapped in a
// <span class="w" data-w> (optionally itself <strong>/<em>) and consecutive
// words sharing a sentenceId are grouped under a <span class="s" data-s>.
// Whitespace is emitted as plain text nodes so container.textContent is
// byte-identical to the non-cursor render. When no cursor is given, it renders
// exactly as before (keeps the legacy InlineMarkdown contract intact).

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { parseInline, CITATION_SENTINEL_RE } from '@/lib/parseAnswer';
import type { Article } from '@/lib/types';
import type { SpokenWord, WordCursor } from '@/lib/readAlong/spokenDoc';

interface InlineMarkdownProps {
  text: string;
  /** Optional read-along cursor; when present, emit addressable spans. */
  cursor?: WordCursor;
  /** Positional citation targets: sentinel ⟦n⟧ links to citeTargets[n-1]. */
  citeTargets?: (Article | undefined)[];
}

const SENTINEL_SPLIT_RE = /(⟦\d{1,2}⟧)/g;

/**
 * Render a text run, replacing ⟦n⟧ sentinels with superscript source links.
 * Unresolvable sentinels (no target / out of range) render as literal "[n]".
 * Citations are NOT spoken words: they live inside the surrounding word's
 * node, so they never consume a WordCursor entry.
 */
function renderCited(
  text: string,
  citeTargets: (Article | undefined)[] | undefined,
  keyBase: string,
): ReactNode {
  if (!CITATION_SENTINEL_RE.test(text)) return text;
  return text.split(SENTINEL_SPLIT_RE).filter((p) => p !== '').map((part, j) => {
    const m = part.match(/^⟦(\d{1,2})⟧$/);
    if (!m) return <Fragment key={`${keyBase}c${j}`}>{part}</Fragment>;
    const n = Number(m[1]);
    const target = citeTargets?.[n - 1];
    if (!target) return <Fragment key={`${keyBase}c${j}`}>[{n}]</Fragment>;
    return (
      <sup key={`${keyBase}c${j}`} className="cite">
        <a href={target.url} target="_blank" rel="noopener noreferrer" title={target.title}>
          [{n}]
        </a>
      </sup>
    );
  });
}

// One emitted piece: either a spoken word (carrying its model word) or a
// whitespace run that must be preserved verbatim.
type Piece =
  | { kind: 'word'; node: ReactNode; word: SpokenWord }
  | { kind: 'space'; text: string };

export default function InlineMarkdown({ text, cursor, citeTargets }: InlineMarkdownProps) {
  const tokens = parseInline(text);

  // --- Legacy path: render exactly as before (no spans). ---
  if (!cursor) {
    return (
      <>
        {tokens.map((t, i) => {
          if (t.type === 'strong') return <strong key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</strong>;
          if (t.type === 'em') return <em key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</em>;
          return <Fragment key={i}>{renderCited(t.value, citeTargets, `t${i}`)}</Fragment>;
        })}
      </>
    );
  }

  // --- Read-along path: split into word / whitespace pieces in order. ---
  const pieces: Piece[] = [];
  let key = 0;

  for (const t of tokens) {
    // Split this token's value into maximal word / whitespace runs.
    const runs = t.value.match(/\S+|\s+/g);
    if (!runs) continue;

    for (const run of runs) {
      if (/^\s+$/.test(run)) {
        pieces.push({ kind: 'space', text: run });
        continue;
      }
      // Non-whitespace run → one spoken word. Pull its id from the cursor.
      const word = cursor.next();
      if (!word) {
        // Cursor exhausted (shouldn't happen for well-formed docs); fall back
        // to a plain text node so nothing is dropped.
        pieces.push({ kind: 'space', text: run });
        continue;
      }
      const inner = run;
      let node: ReactNode;
      if (t.type === 'strong') {
        node = (
          <strong key={key++} className="w" data-w={word.id}>
            {renderCited(inner, citeTargets, `w${word.id}`)}
          </strong>
        );
      } else if (t.type === 'em') {
        node = (
          <em key={key++} className="w" data-w={word.id}>
            {renderCited(inner, citeTargets, `w${word.id}`)}
          </em>
        );
      } else {
        node = (
          <span key={key++} className="w" data-w={word.id}>
            {renderCited(inner, citeTargets, `w${word.id}`)}
          </span>
        );
      }
      pieces.push({ kind: 'word', node, word });
    }
  }

  // --- Group consecutive words sharing a sentenceId under one .s span. ---
  // Whitespace between two words of the SAME sentence stays inside the span;
  // whitespace at sentence boundaries / before the first or after the last word
  // is emitted as a plain text node between spans, preserving textContent.
  const out: ReactNode[] = [];
  let groupKey = 0;
  let i = 0;

  while (i < pieces.length) {
    const piece = pieces[i];

    if (piece.kind === 'space') {
      out.push(<Fragment key={`g${groupKey++}`}>{piece.text}</Fragment>);
      i += 1;
      continue;
    }

    // Start a sentence group at this word.
    const sentenceId = piece.word.sentenceId;
    const children: ReactNode[] = [piece.node];
    i += 1;

    // Greedily absorb following pieces that belong to this sentence: words with
    // the same sentenceId, plus the whitespace that sits between them.
    while (i < pieces.length) {
      const nxt = pieces[i];
      if (nxt.kind === 'word') {
        if (nxt.word.sentenceId === sentenceId) {
          children.push(nxt.node);
          i += 1;
        } else {
          break; // a different sentence starts
        }
      } else {
        // Whitespace: only pull it in if it's followed by a same-sentence word.
        const after = pieces[i + 1];
        if (after && after.kind === 'word' && after.word.sentenceId === sentenceId) {
          children.push(<Fragment key={`s${groupKey}-${i}`}>{nxt.text}</Fragment>);
          i += 1;
        } else {
          break; // boundary / trailing whitespace → leave outside the span
        }
      }
    }

    out.push(
      <span key={`g${groupKey++}`} className="s" data-s={sentenceId}>
        {children}
      </span>,
    );
  }

  return <>{out}</>;
}
