import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrbStage from './OrbStage';

// Pin these tests to the Web Speech engine: they assert engine-level behaviour
// (sync setListening, injected SpeechRecognition instances, the unsupported
// message) that useVoiceInput routes to Scribe first. The Scribe path is covered
// by OrbStage.scribe.test.tsx.
vi.mock('./useVoiceInput', async () => {
  const { useSpeechRecognition } = await import('./useSpeechRecognition');
  return {
    useVoiceInput: (opts: Parameters<typeof useSpeechRecognition>[0]) => ({
      ...useSpeechRecognition(opts),
      engine: 'webspeech' as const,
    }),
  };
});

type StageProps = Omit<React.ComponentProps<typeof OrbStage>, 'planeRef'>;

/** A plane with the two anchor slots, the way AppShell lays them out. */
function Plane(props: StageProps) {
  const ref = useRef<HTMLElement>(null);
  return (
    <main ref={ref} className="main" data-testid="plane">
      <div className="scroll">
        {props.pose === 'centre' && <div data-orb-anchor="centre" />}
      </div>
      {props.pose === 'home' && (
        <div className="foot">
          <div data-orb-anchor="home" />
        </div>
      )}
      <OrbStage {...props} planeRef={ref} />
    </main>
  );
}

function renderStage(overrides: Partial<StageProps> = {}) {
  const props: StageProps = {
    pose: 'centre',
    isMobile: false,
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    listening: false,
    setListening: vi.fn(),
    onSend: vi.fn(),
    speaking: false,
    ...overrides,
  };
  const utils = render(<Plane {...props} />);
  return { props, ...utils };
}

describe('OrbStage — orb state derivation', () => {
  it('shows idle state when nothing is active', () => {
    renderStage();
    expect(screen.getByRole('button', { name: 'Start voice input' })).toHaveAttribute('data-orb-state', 'idle');
  });

  it('shows listening state when listening=true', () => {
    renderStage({ listening: true });
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('data-orb-state', 'listening');
  });

  it('shows thinking state when isLoading=true (takes precedence over listening)', () => {
    renderStage({ isLoading: true, listening: true });
    expect(screen.getByRole('button', { name: 'Thinking…' })).toHaveAttribute('data-orb-state', 'thinking');
  });

  it('shows speaking state when speaking=true (highest precedence)', () => {
    renderStage({ speaking: true, isLoading: true, listening: true });
    expect(screen.getByRole('button', { name: 'Speaking…' })).toHaveAttribute('data-orb-state', 'speaking');
  });
});

describe('OrbStage — poses', () => {
  it('starts centre stage on the welcome and moves home once the conversation starts', () => {
    const { rerender, props } = renderStage({ pose: 'centre' });
    expect(document.querySelector('.orb-body')).toHaveAttribute('data-pose', 'centre');
    rerender(<Plane {...props} pose="home" />);
    expect(document.querySelector('.orb-body')).toHaveAttribute('data-pose', 'home');
  });

  it('marks the body as speaking so the lean applies', () => {
    renderStage({ pose: 'home', speaking: true });
    expect(document.querySelector('.orb-body')).toHaveClass('is-speaking');
  });

  it('shows the interim transcript beside the orb while listening', () => {
    renderStage({ pose: 'home', listening: true, input: 'what changed this week' });
    expect(screen.getByText('what changed this week')).toHaveClass('orb-caption');
  });

  it('shows no caption when idle', () => {
    renderStage({ pose: 'home', input: 'typed but not listening' });
    expect(document.querySelector('.orb-caption')).toBeNull();
  });
});

describe('OrbStage — tap and keyboard', () => {
  it('tapping the orb calls setListening(true) when not listening', async () => {
    const user = userEvent.setup();
    const { props } = renderStage({ listening: false });
    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    expect(props.setListening).toHaveBeenCalledWith(true);
  });

  it('the V key outside editable fields starts listening', () => {
    const { props } = renderStage({ listening: false });
    fireEvent.keyDown(document.body, { key: 'v' });
    expect(props.setListening).toHaveBeenCalledWith(true);
  });

  it('the V key inside a textarea is left to the textarea', () => {
    const { props } = renderStage({ listening: false });
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    fireEvent.keyDown(ta, { key: 'v' });
    expect(props.setListening).not.toHaveBeenCalled();
    ta.remove();
  });

  it('orb is disabled while isLoading', () => {
    renderStage({ isLoading: true });
    expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled();
  });
});

describe('OrbStage — send paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function renderWithInstance(overrides: Partial<StageProps>) {
    let captured: SpeechRecognition | undefined;
    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const inst = new OrigCtor();
      captured = inst;
      return inst;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;
    const r = renderStage(overrides);
    return {
      ...r,
      instance: () => captured!,
      restore: () => {
        window.SpeechRecognition = OrigCtor;
      },
    };
  }

  function finalResult(transcript: string): SpeechRecognitionEvent {
    return {
      resultIndex: 0,
      results: Object.assign(
        [
          Object.assign([{ transcript, confidence: 1 }], {
            isFinal: true,
            length: 1,
            item: () => ({ transcript, confidence: 1 }),
          }),
        ],
        { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
      ) as SpeechRecognitionResultList,
    } as unknown as SpeechRecognitionEvent;
  }

  it('calls onSend after the silence window, not immediately', () => {
    const onSend = vi.fn();
    const { instance, restore } = renderWithInstance({ listening: true, onSend });

    act(() => {
      instance().onresult?.(finalResult('test question'));
    });
    expect(onSend).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(onSend).toHaveBeenCalledWith('test question');
    restore();
  });

  it('tapping the orb while listening sends immediately', () => {
    const onSend = vi.fn();
    const { instance, restore } = renderWithInstance({ listening: true, onSend });

    act(() => {
      instance().onresult?.(finalResult('hello'));
    });
    act(() => {
      screen.getByRole('button', { name: 'Stop listening' }).click();
    });
    expect(onSend).toHaveBeenCalledWith('hello');
    restore();
  });
});

describe('OrbStage — voice unsupported', () => {
  it('draws the voice-off note, disables the orb, and tells the shell', () => {
    const savedSR = window.SpeechRecognition;
    const savedWSR = window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;

    const onSupportedChange = vi.fn();
    renderStage({ onSupportedChange });
    expect(screen.getByRole('status')).toHaveTextContent(/voice input isn't available in this browser/i);
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeDisabled();
    expect(onSupportedChange).toHaveBeenLastCalledWith(false);

    window.SpeechRecognition = savedSR;
    window.webkitSpeechRecognition = savedWSR;
  });
});
