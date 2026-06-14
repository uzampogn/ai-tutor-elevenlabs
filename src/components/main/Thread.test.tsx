import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Thread from './Thread';
import type { Message } from '@/lib/types';

// Spec 04: while a read-along is active the controller owns scroll, so the
// bottom-pin effect (scrollIntoView on every `messages` change) must be
// suppressed. These tests spy on Element.prototype.scrollIntoView and toggle
// `isReading` indirectly via `readAlong` + `speakingContent`.
//
// isReading === (readAlong !== 'off' && !!speakingContent).

const ANSWER = 'First sentence here. Second sentence here.';

function makeProps(
  overrides: Partial<React.ComponentProps<typeof Thread>> = {},
): React.ComponentProps<typeof Thread> {
  const messages: Message[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: ANSWER },
  ];
  return {
    messages,
    isLoading: false,
    articles: [],
    speakingContent: null,
    readAlong: 'off',
    timings: null,
    audio: null,
    onAsk: vi.fn(),
    onReadAloud: vi.fn(),
    onStopAudio: vi.fn(),
    ...overrides,
  };
}

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoViewSpy = vi.fn();
  // jsdom doesn't implement scrollIntoView; install a spy for both the bottom
  // anchor (Thread's effect) and any span the controller might target.
  Element.prototype.scrollIntoView = scrollIntoViewSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Thread — bottom-pin vs read-along', () => {
  it('with isReading=false, a messages change pins to bottom (today\'s behavior)', () => {
    const { rerender } = render(<Thread {...makeProps()} />);
    // Initial mount already scrolled once.
    const callsAfterMount = scrollIntoViewSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // A new message arrives → effect fires again.
    const next = makeProps({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: ANSWER },
        { role: 'user', content: 'more' },
      ],
    });
    rerender(<Thread {...next} />);
    expect(scrollIntoViewSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('with isReading=true, a messages change does NOT pin to bottom', () => {
    // readAlong='sentence' + speakingContent set → isReading true. No audio, so
    // the controller stays inert; only the bottom-pin suppression is exercised.
    const props = makeProps({ readAlong: 'sentence', speakingContent: ANSWER });
    const { rerender } = render(<Thread {...props} />);
    scrollIntoViewSpy.mockClear();

    const next = makeProps({
      readAlong: 'sentence',
      speakingContent: ANSWER,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: ANSWER },
        { role: 'user', content: 'more' },
      ],
    });
    rerender(<Thread {...next} />);

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('readAlong=off keeps the bottom-pin even when something is speaking', () => {
    // 'off' is a total no-op → isReading false → pin still fires.
    const props = makeProps({ readAlong: 'off', speakingContent: ANSWER });
    const { rerender } = render(<Thread {...props} />);
    scrollIntoViewSpy.mockClear();

    const next = makeProps({
      readAlong: 'off',
      speakingContent: ANSWER,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: ANSWER },
        { role: 'user', content: 'more' },
      ],
    });
    rerender(<Thread {...next} />);

    expect(scrollIntoViewSpy).toHaveBeenCalled();
  });
});
