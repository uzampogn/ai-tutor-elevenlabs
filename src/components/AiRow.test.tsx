import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiRow from './AiRow';
import { buildSpokenDoc } from '@/lib/readAlong/spokenDoc';
import type { Article } from '@/lib/types';

const article = (over: Partial<Article> = {}): Article => ({
  title: 'Claude Opus 4 launch',
  url: 'https://www.anthropic.com/news/claude-opus-4',
  pubDate: 'Tue, 03 Jun 2025 00:00:00 GMT',
  description: 'desc',
  ...over,
});

// After Spec 01 the answer text is wrapped per-word in .w spans (grouped under
// .s sentence spans), so RTL's default getByText (which matches an element's
// OWN text node) no longer matches a multi-word sentence. We assert the same
// render-parity facts by matching against an element's full textContent.
const hasText = (root: HTMLElement, selector: string, text: string): boolean =>
  Array.from(root.querySelectorAll(selector)).some((el) => el.textContent === text);

describe('AiRow', () => {
  it('renders the impact text and an ImpactCard when content has a Business Impact section', () => {
    const content =
      'Here is the main explanation of the topic.\n\n💼 Business Impact\n\nThis reshapes enterprise budgets.';
    const { container } = render(
      <AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );

    expect(hasText(container, 'p.impact-text', 'This reshapes enterprise budgets.')).toBe(true);
    // The ImpactCard label only appears when the card renders.
    expect(screen.getByText(/Business Impact/i)).toBeInTheDocument();
    expect(hasText(container, 'p.ai-para', 'Here is the main explanation of the topic.')).toBe(true);
  });

  it('renders no impact card when content has no Business Impact section', () => {
    const content = 'Just a plain answer with no special section.';
    const { container } = render(
      <AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );

    expect(screen.queryByText(/Business Impact/i)).toBeNull();
    expect(hasText(container, 'p.ai-para', 'Just a plain answer with no special section.')).toBe(true);
  });

  it('renders a source link when content mentions an article title', () => {
    const articles = [article()];
    const content = 'The Claude Opus 4 launch was a major step forward for the industry.';
    render(<AiRow content={content} streaming={false} articles={articles} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const link = screen.getByRole('link', { name: /Claude Opus 4 launch/ });
    expect(link).toHaveAttribute('href', 'https://www.anthropic.com/news/claude-opus-4');
  });

  it('renders no source links when no article titles match', () => {
    const articles = [article()];
    const content = 'An unrelated answer mentioning nothing in the knowledge base.';
    render(<AiRow content={content} streaming={false} articles={articles} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders ul list items for bullet-point content, not raw "- " text', () => {
    const content = '- item one\n- item two';
    render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('item one');
    expect(items[1].textContent).toBe('item two');
    expect(screen.queryByText(/^- /)).toBeNull();
  });

  it('renders a grouped label as a <p> and its bullets as <li>, with no raw "- " text', () => {
    const content = '**🛠️ Developer Tools**\n- alpha release\n- beta access';
    const { container } = render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const para = container.querySelector('p.ai-para');
    expect(para).not.toBeNull();
    expect(para?.textContent).toContain('Developer Tools');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('alpha release');
    expect(items[1].textContent).toBe('beta access');
    expect(screen.queryByText(/^- /)).toBeNull();
  });

  it('renders an ol for numbered list content', () => {
    const content = '1. first\n2. second';
    const { container } = render(<AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />);

    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toBe('first');
    expect(items[1].textContent).toBe('second');
  });

  // --- Spec 01: addressable span coverage --------------------------------

  it('wraps every spoken word in a [data-w] and every sentence in a [data-s]', () => {
    const content =
      'Anthropic released a model. It scored well.\n\n💼 Business Impact\n\nBudgets shift fast.';
    const { container } = render(
      <AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );
    const doc = buildSpokenDoc(content);

    const wordSpans = container.querySelectorAll('[data-w]');
    const sentenceSpans = container.querySelectorAll('[data-s]');
    expect(wordSpans).toHaveLength(doc.words.length);
    expect(sentenceSpans).toHaveLength(doc.sentences.length);

    // Each rendered data-w id corresponds 1:1 to a model word, with matching text.
    doc.words.forEach((w) => {
      const el = container.querySelector(`[data-w="${w.id}"]`);
      expect(el).not.toBeNull();
      expect(el?.textContent).toBe(w.text);
    });
    doc.sentences.forEach((s) => {
      expect(container.querySelector(`[data-s="${s.id}"]`)).not.toBeNull();
    });
  });

  it('emits no [data-w] inside the impact label, source chips, or avatar', () => {
    const articles = [article()];
    const content =
      'The Claude Opus 4 launch mattered.\n\n💼 Business Impact\n\nIt moved markets.';
    const { container } = render(
      <AiRow content={content} streaming={false} articles={articles} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );

    expect(container.querySelector('.impact-label [data-w]')).toBeNull();
    expect(container.querySelector('.ai-avatar [data-w]')).toBeNull();
    // Source chips live outside the spoken body — no word spans there.
    const chips = container.querySelector('.source-chips') ?? container.querySelector('a[href]')?.closest('div');
    if (chips) expect(chips.querySelector('[data-w]')).toBeNull();
  });

  it('preserves textContent fidelity (no doubled/dropped whitespace from spans)', () => {
    const content =
      'A **bold** claim and an *italic* aside.\n\n- first bullet\n- second bullet\n\n💼 Business Impact\n\nIt changes pricing.';
    const { container } = render(
      <AiRow content={content} streaming={false} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );

    // Each spoken word span's text is exactly the model word (no whitespace bleed).
    const doc = buildSpokenDoc(content);
    doc.words.forEach((w) => {
      const el = container.querySelector(`[data-w="${w.id}"]`);
      expect(el?.textContent).toBe(w.text);
    });

    // Block-level textContent matches a span-free render (e.g. paragraph prose).
    expect(hasText(container, 'p.ai-para', 'A bold claim and an italic aside.')).toBe(true);
    expect(hasText(container, 'p.impact-text', 'It changes pricing.')).toBe(true);

    // Emphasis is preserved on the right word spans.
    const boldEl = container.querySelector('strong[data-w]');
    expect(boldEl?.textContent).toBe('bold');
    const emEl = container.querySelector('em[data-w]');
    expect(emEl?.textContent).toBe('italic');
  });

  it('renders a streaming partial answer with a caret and without throwing', () => {
    const content = 'Anthropic released a partial answer that is still strea';
    const { container } = render(
      <AiRow content={content} streaming={true} articles={[]} speaking={false} onReadAloud={() => {}} onStopAudio={() => {}} />,
    );

    // Caret present during streaming.
    expect(container.querySelector('.caret')).not.toBeNull();
    // Words are still wrapped — partial doc does not throw.
    const doc = buildSpokenDoc(content);
    expect(container.querySelectorAll('[data-w]')).toHaveLength(doc.words.length);
    expect(doc.words.length).toBeGreaterThan(0);
  });
});
