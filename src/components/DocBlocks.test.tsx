import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import DocBlocks from './DocBlocks';

const wordsIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-w]')).map((s) => ({
    id: Number((s as HTMLElement).dataset.w),
    text: s.textContent,
  }));

describe('DocBlocks', () => {
  it('renders exactly the doc words, ids in order (RCA composite)', () => {
    const md =
      '## Key Takeaways\n\nUse `claude-fable-5` with user_id routing — it is **fast**.\n\n- Top level\n  - Nested here\n\n```js\nconst x = 1;\n```\n\n> Quoted.\n\nDone now.';
    const doc = buildSpokenDoc(md);
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    expect(wordsIn(container)).toEqual(doc.words.map((w) => ({ id: w.id, text: w.text })));
  });

  it('one [data-s] span per sentence, ids matching the doc', () => {
    const doc = buildSpokenDoc('First sentence here. Second one!\n\nThird paragraph.');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    const ids = Array.from(container.querySelectorAll('[data-s]')).map((s) =>
      Number((s as HTMLElement).dataset.s),
    );
    expect(ids).toEqual(doc.sentences.map((s) => s.id));
  });

  it('renders code blocks as <pre> with no word spans inside', () => {
    const doc = buildSpokenDoc('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    const pre = container.querySelector('pre.ai-code')!;
    expect(pre.textContent).toBe('const x = 1;');
    expect(pre.querySelectorAll('[data-w]')).toHaveLength(0);
  });

  it('wraps emphasized words in strong/em carrying .w and data-w', () => {
    const doc = buildSpokenDoc('a **bold** and _soft_ word');
    const { container } = render(<DocBlocks doc={doc} region="body" />);
    expect(container.querySelector('strong.w[data-w]')!.textContent).toBe('bold');
    expect(container.querySelector('em.w[data-w]')!.textContent).toBe('soft');
  });

  it('renders only the requested region', () => {
    const doc = buildSpokenDoc('Body text here.\n\n💼 Business Impact\n\nImpact text here.');
    const { container } = render(<DocBlocks doc={doc} region="impact" />);
    expect(container.textContent).not.toContain('Body');
    expect(container.textContent).toContain('Impact text');
  });

  it('shows the caret only while streaming', () => {
    const doc = buildSpokenDoc('Partial answer tex');
    const on = render(<DocBlocks doc={doc} region="body" streaming />);
    expect(on.container.querySelector('.caret')).not.toBeNull();
    const off = render(<DocBlocks doc={doc} region="body" />);
    expect(off.container.querySelector('.caret')).toBeNull();
  });
});
