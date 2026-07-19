import { describe, it, expect } from 'vitest';
import { buildSpokenDoc } from './spokenDoc';
import type { SpokenDoc, DocBlock } from './spokenDoc';
import { stripMarkdown } from './stripMarkdown';

// Representative answers spanning the surfaces the model must handle: plain
// prose, bold/italic, bullet + numbered lists, decimals/abbreviations, the
// Business Impact card, and edge cases. Kept link/code-free (a known render
// desync limitation noted in the implementation guide).
const CORPUS = [
  'Just a plain answer with no special section.',
  'Here is the main explanation of the topic.\n\n💼 Business Impact\n\nThis reshapes enterprise budgets.',
  '- item one\n- item two',
  '1. first\n2. second',
  '**🛠️ Developer Tools**\n- alpha release\n- beta access',
  'A **bold** claim and an *italic* aside and some _underscored_ text.',
  'Claude 4.6 is out. It scores higher, e.g. on math. The U.S. market reacted!',
  'Paragraph one here.\n\nParagraph two here.\n\n💼 Business Impact\n\nFirst impact sentence. Second impact sentence!',
  '## Heading\n\nSome body. With two sentences?\n\n- bullet a\n- bullet b\n\n💼 **Business Impact**\n\nMoney moves. Fast.',
  'Mr. Smith met Dr. Jones vs. the others. Done.',
];

describe('buildSpokenDoc — parity contract', () => {
  it.each(CORPUS)('spokenText === stripMarkdown(answer) for: %s', (answer) => {
    const doc = buildSpokenDoc(answer);
    expect(doc.spokenText).toBe(stripMarkdown(answer));
  });
});

describe('buildSpokenDoc — offset integrity', () => {
  it.each(CORPUS)('every word/sentence slice equals its text for: %s', (answer) => {
    const doc = buildSpokenDoc(answer);
    for (const w of doc.words) {
      expect(doc.spokenText.slice(w.charStart, w.charEnd)).toBe(w.text);
    }
    for (const s of doc.sentences) {
      // A sentence spans from its first word's charStart to its last word's
      // charEnd; the slice begins and ends on word boundaries.
      const first = doc.words[s.wordIds[0]];
      const last = doc.words[s.wordIds[s.wordIds.length - 1]];
      expect(s.charStart).toBe(first.charStart);
      expect(s.charEnd).toBe(last.charEnd);
    }
  });
});

describe('buildSpokenDoc — contiguity', () => {
  it.each(CORPUS)('words+separators reproduce the sentence slice for: %s', (answer) => {
    const doc = buildSpokenDoc(answer);
    for (const s of doc.sentences) {
      const sliceFromText = doc.spokenText.slice(s.charStart, s.charEnd);
      // Reconstruct by concatenating each word and the exact whitespace gap that
      // precedes the next word within the sentence.
      let rebuilt = '';
      for (let k = 0; k < s.wordIds.length; k++) {
        const w = doc.words[s.wordIds[k]];
        if (k > 0) {
          const prev = doc.words[s.wordIds[k - 1]];
          rebuilt += doc.spokenText.slice(prev.charEnd, w.charStart);
        }
        rebuilt += w.text;
      }
      expect(rebuilt).toBe(sliceFromText);
    }
  });
});

describe('buildSpokenDoc — ordering invariants', () => {
  it.each(CORPUS)('charStart < charEnd, monotonic & non-overlapping for: %s', (answer) => {
    const doc = buildSpokenDoc(answer);

    let prevEnd = -1;
    for (const w of doc.words) {
      expect(w.charStart).toBeLessThan(w.charEnd);
      expect(w.charStart).toBeGreaterThanOrEqual(prevEnd); // non-overlapping, ordered
      prevEnd = w.charEnd;
    }

    let prevSentEnd = -1;
    for (const s of doc.sentences) {
      expect(s.charStart).toBeLessThan(s.charEnd);
      expect(s.charStart).toBeGreaterThanOrEqual(prevSentEnd);
      prevSentEnd = s.charEnd;
    }

    // Word ids are a dense 0..N-1 sequence; sentence ids likewise.
    doc.words.forEach((w, i) => expect(w.id).toBe(i));
    doc.sentences.forEach((s, i) => expect(s.id).toBe(i));
    // Every word belongs to its sentence's wordIds.
    for (const w of doc.words) {
      expect(doc.sentences[w.sentenceId].wordIds).toContain(w.id);
    }
  });
});

describe('buildSpokenDoc — sentence splitting', () => {
  it('does not split decimals, e.g., or U.S.', () => {
    const doc = buildSpokenDoc(
      'Claude 4.6 is out. It scores higher, e.g. on math. The U.S. market reacted!',
    );
    const texts = doc.sentences.map((s) => doc.spokenText.slice(s.charStart, s.charEnd));
    expect(texts).toEqual([
      'Claude 4.6 is out.',
      'It scores higher, e.g. on math.',
      'The U.S. market reacted!',
    ]);
  });

  it('splits on ? and !', () => {
    const doc = buildSpokenDoc('Is it ready? Yes! It ships now.');
    const texts = doc.sentences.map((s) => doc.spokenText.slice(s.charStart, s.charEnd));
    expect(texts).toEqual(['Is it ready?', 'Yes!', 'It ships now.']);
  });

  it('treats common abbreviations as non-terminal', () => {
    const doc = buildSpokenDoc('Mr. Smith met Dr. Jones vs. the others. Done.');
    const texts = doc.sentences.map((s) => doc.spokenText.slice(s.charStart, s.charEnd));
    expect(texts).toEqual(['Mr. Smith met Dr. Jones vs. the others.', 'Done.']);
  });

  it('makes each list item its own sentence', () => {
    const doc = buildSpokenDoc('- item one\n- item two\n- item three');
    expect(doc.sentences).toHaveLength(3);
    const texts = doc.sentences.map((s) => doc.spokenText.slice(s.charStart, s.charEnd));
    expect(texts).toEqual(['item one', 'item two', 'item three']);
  });

  it('makes a label line its own sentence (newline before next line)', () => {
    const doc = buildSpokenDoc('Developer Tools\n- alpha release\n- beta access');
    const texts = doc.sentences.map((s) => doc.spokenText.slice(s.charStart, s.charEnd));
    expect(texts).toEqual(['Developer Tools', 'alpha release', 'beta access']);
  });
});

describe('buildSpokenDoc — emphasis carry-through', () => {
  it('tags bold/italic/underscore words and leaves plain words undefined', () => {
    const doc = buildSpokenDoc(
      'A **bold** claim and an *italic* aside and some _underscored_ text.',
    );
    const byText = (t: string) => doc.words.find((w) => w.text === t);
    expect(byText('bold')?.emphasis).toBe('strong');
    expect(byText('italic')?.emphasis).toBe('em');
    expect(byText('underscored')?.emphasis).toBe('em');
    expect(byText('claim')?.emphasis).toBeUndefined();
    expect(byText('A')?.emphasis).toBeUndefined();
  });

  it('tags a multi-word bold run per word', () => {
    const doc = buildSpokenDoc('Plain **two bold words** here.');
    const byText = (t: string) => doc.words.find((w) => w.text === t);
    expect(byText('two')?.emphasis).toBe('strong');
    expect(byText('bold')?.emphasis).toBe('strong');
    expect(byText('words')?.emphasis).toBe('strong');
    expect(byText('here.')?.emphasis).toBeUndefined();
  });
});

describe('buildSpokenDoc — region tagging', () => {
  it('tags impact sentences impact, body sentences body', () => {
    const doc = buildSpokenDoc(
      'Body sentence one. Body sentence two.\n\n💼 Business Impact\n\nImpact one. Impact two.',
    );
    const bodySentences = doc.sentences.filter((s) => s.region === 'body');
    const impactSentences = doc.sentences.filter((s) => s.region === 'impact');
    expect(bodySentences.length).toBeGreaterThan(0);
    expect(impactSentences.length).toBeGreaterThan(0);

    for (const s of impactSentences) {
      expect(doc.spokenText.slice(s.charStart, s.charEnd)).toMatch(/Impact/);
    }
  });

  it('excludes the Business Impact heading words from doc.words (per guide §2)', () => {
    const doc = buildSpokenDoc(
      'Here is the body.\n\n💼 Business Impact\n\nThis reshapes budgets.',
    );
    // Heading characters still occupy spokenText (audio unchanged)...
    expect(doc.spokenText).toContain('Business Impact');
    // ...but no addressable word covers them.
    expect(doc.words.some((w) => /Business|Impact/.test(w.text))).toBe(false);
  });

  it('tags everything body when there is no impact section', () => {
    const doc = buildSpokenDoc('Plain answer. No impact here.');
    expect(doc.sentences.every((s) => s.region === 'body')).toBe(true);
  });
});

describe('buildSpokenDoc — edge cases', () => {
  it('empty / whitespace answer yields an empty doc', () => {
    for (const input of ['', '   ', '\n\n\t  \n']) {
      const doc = buildSpokenDoc(input);
      expect(doc.spokenText).toBe('');
      expect(doc.words).toEqual([]);
      expect(doc.sentences).toEqual([]);
    }
  });

  it('partial / streaming markdown does not throw', () => {
    const fragments = [
      'Partial **bold without close and a trailing',
      'A sentence cut off in the mid',
      '- bullet that just',
      '## Heading line only',
      '💼 Business Impact',
    ];
    for (const f of fragments) {
      expect(() => buildSpokenDoc(f)).not.toThrow();
    }
  });

  it('impact-less answer marks all words body', () => {
    const doc = buildSpokenDoc('Just body text. Nothing else.');
    expect(doc.words.length).toBeGreaterThan(0);
    expect(doc.sentences.every((s) => s.region === 'body')).toBe(true);
  });
});

describe('emphasis overlay flanking (Spec 09)', () => {
  it('does not tag snake_case as emphasis', () => {
    const doc = buildSpokenDoc('The user_id maps to auth_token here.');
    expect(doc.words.every((w) => w.emphasis === undefined)).toBe(true);
    expect(doc.spokenText).toContain('user_id');
  });

  it('still tags real strong/em', () => {
    const doc = buildSpokenDoc('a **bold** and _soft_ word');
    const byText = (t: string) => doc.words.find((w) => w.text === t)!;
    expect(byText('bold').emphasis).toBe('strong');
    expect(byText('soft').emphasis).toBe('em');
  });
});

/** Flatten block word ids in document order. */
function flatIds(doc: SpokenDoc): number[] {
  const out: number[] = [];
  for (const b of doc.blocks) {
    if (b.type === 'paragraph') out.push(...b.wordIds);
    else if (b.type === 'ul' || b.type === 'ol') for (const it of b.items) out.push(...it.wordIds);
  }
  return out;
}

const RCA_FIXTURES: Record<string, string> = {
  heading: '## Key Takeaways\n\nModels improved a lot this year.',
  codeFence: 'Here is how:\n\n```js\nconst x = 1;\n```\n\nThat prints one.',
  inlineCode: 'Use the `claude-fable-5` model id for this.',
  snakeCase: 'The field user_id maps to the auth_token record.',
  bullets: 'Points:\n\n- Top level\n  - Nested here\n+ Plus item',
  blockquote: '> Quoted line here.\n\nRegular paragraph.',
  hrule: 'Before the rule.\n\n---\n\nAfter the rule.',
  image: 'See this: works.\n\n![alt text](https://example.com/i.png)\n\nDone now.',
  link: 'Read [the announcement](https://claude.com/blog/post) today.',
  doubleUnder: 'This is __really bold__ text.',
  emoji: 'Great results 🚀 this quarter.\n\n💼 Business Impact\n\nRevenue grew fast.',
  ordered: 'Steps:\n\n1. First do this\n2. Then that',
};

describe('block overlay (Spec 09)', () => {
  it('partitions words exactly, in order, for every fixture', () => {
    for (const [name, md] of Object.entries(RCA_FIXTURES)) {
      const doc = buildSpokenDoc(md);
      expect(flatIds(doc), name).toEqual(doc.words.map((w) => w.id));
    }
  });

  it('produces the expected block shapes', () => {
    const doc = buildSpokenDoc(RCA_FIXTURES.codeFence);
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'paragraph']);
    const code = doc.blocks[1] as Extract<DocBlock, { type: 'code' }>;
    expect(code.raw).toBe('const x = 1;');
    const lists = buildSpokenDoc(RCA_FIXTURES.bullets).blocks;
    expect(lists.map((b) => b.type)).toEqual(['paragraph', 'ul']);
    expect((lists[1] as Extract<DocBlock, { type: 'ul' }>).items).toHaveLength(3);
  });

  it('tags impact-region blocks', () => {
    const doc = buildSpokenDoc(RCA_FIXTURES.emoji);
    const regions = doc.blocks.map((b) => b.region);
    expect(regions).toEqual(['body', 'impact']);
  });

  it('never throws and keeps the partition on every streaming prefix', () => {
    const full = Object.values(RCA_FIXTURES).join('\n\n');
    for (let i = 0; i <= full.length; i++) {
      const doc = buildSpokenDoc(full.slice(0, i));
      expect(flatIds(doc)).toEqual(doc.words.map((w) => w.id));
    }
  });
});

describe('buildSpokenDoc — citation markers are invisible (alignment invariant)', () => {
  it('marked and unmarked answers produce identical spoken docs', () => {
    const marked = buildSpokenDoc('Claude shipped it [1]. Fast [2][3]. Done.');
    const clean = buildSpokenDoc('Claude shipped it. Fast. Done.');
    expect(marked.spokenText).toBe(clean.spokenText);
    expect(marked.words.length).toBe(clean.words.length);
  });

  it('attaches glued markers to the word they follow (citation overlay)', () => {
    const doc = buildSpokenDoc('Claude shipped it [1]. Fast [2][3]. Done.');
    // [1] glued to "it." → source 1; [2][3] glued to "Fast." → sources 2,3.
    const cited = doc.words.filter((w) => w.citations && w.citations.length > 0);
    expect(cited.map((w) => [w.text, w.citations])).toEqual([
      ['it.', [1]],
      ['Fast.', [2, 3]],
    ]);
  });

  it('leaves a start-of-line marker unattached (kept literal both sides)', () => {
    const doc = buildSpokenDoc('[1] leads the line.');
    expect(doc.words.every((w) => !w.citations || w.citations.length === 0)).toBe(true);
    expect(doc.spokenText).toBe('[1] leads the line.');
  });
});
