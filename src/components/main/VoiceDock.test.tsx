import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceDock from './VoiceDock';

function renderVoiceDock(overrides: Partial<React.ComponentProps<typeof VoiceDock>> = {}) {
  const props: React.ComponentProps<typeof VoiceDock> = {
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    listening: false,
    setListening: vi.fn(),
    onSend: vi.fn(),
    speaking: false,
    ...overrides,
  };
  render(<VoiceDock {...props} />);
  return props;
}

describe('VoiceDock — orb state derivation', () => {
  it('shows idle state when nothing is active', () => {
    renderVoiceDock();
    const orb = screen.getByRole('button', { name: 'Start voice input' });
    expect(orb).toHaveAttribute('data-orb-state', 'idle');
  });

  it('shows listening state when listening=true', () => {
    renderVoiceDock({ listening: true });
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute(
      'data-orb-state',
      'listening',
    );
  });

  it('shows thinking state when isLoading=true (takes precedence over listening)', () => {
    renderVoiceDock({ isLoading: true, listening: true });
    expect(screen.getByRole('button', { name: 'Thinking…' })).toHaveAttribute(
      'data-orb-state',
      'thinking',
    );
  });

  it('shows speaking state when speaking=true (highest precedence)', () => {
    renderVoiceDock({ speaking: true, isLoading: true, listening: true });
    expect(screen.getByRole('button', { name: 'Speaking…' })).toHaveAttribute(
      'data-orb-state',
      'speaking',
    );
  });
});

describe('VoiceDock — no status readout (orb is the only voice cue)', () => {
  it('does not render the "Tap to speak" / status readout beneath the orb', () => {
    renderVoiceDock({ listening: true });
    expect(screen.queryByText(/tap to speak|listening…|thinking…|speaking…/i)).toBeNull();
    expect(document.querySelector('.voice-dock-readout')).toBeNull();
  });

  it('keeps a state-appropriate aria-label on the orb for screen readers', () => {
    renderVoiceDock({ listening: true });
    // The orb's aria-label is now the sole a11y cue that voice is active.
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();
  });
});

describe('VoiceDock — orb interaction', () => {
  it('tapping the orb calls setListening(true) when not listening', async () => {
    const user = userEvent.setup();
    const props = renderVoiceDock({ listening: false });
    await user.click(screen.getByRole('button', { name: 'Start voice input' }));
    expect(props.setListening).toHaveBeenCalledWith(true);
  });

  it('orb is disabled while isLoading', () => {
    renderVoiceDock({ isLoading: true });
    const orb = screen.getByRole('button', { name: 'Thinking…' });
    expect(orb).toBeDisabled();
  });
});

describe('VoiceDock — final transcript path', () => {
  it('calls onSend with the final transcript when recognition fires a final result', () => {
    const setInput = vi.fn();
    const onSend = vi.fn();

    let capturedInstance: SpeechRecognition | undefined;

    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const instance = new OrigCtor();
      capturedInstance = instance;
      return instance;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;

    render(
      <VoiceDock
        input=""
        setInput={setInput}
        isLoading={false}
        listening={false}
        setListening={vi.fn()}
        onSend={onSend}
        speaking={false}
      />,
    );

    act(() => {
      const evt = {
        resultIndex: 0,
        results: Object.assign(
          [
            Object.assign([{ transcript: 'test question', confidence: 1 }], {
              isFinal: true,
              length: 1,
              item: () => ({ transcript: 'test question', confidence: 1 }),
            }),
          ],
          { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
        ) as SpeechRecognitionResultList,
      } as unknown as SpeechRecognitionEvent;
      capturedInstance?.onresult?.(evt);
    });

    expect(setInput).toHaveBeenCalledWith('test question');
    expect(onSend).toHaveBeenCalledWith('test question');

    window.SpeechRecognition = OrigCtor;
  });
});

describe('VoiceDock — STT unsupported', () => {
  it('shows unsupported message when SpeechRecognition is absent', () => {
    const savedSR = window.SpeechRecognition;
    const savedWSR = window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;

    renderVoiceDock();
    expect(
      screen.getByText(/voice input isn't available in this browser/i),
    ).toBeInTheDocument();

    window.SpeechRecognition = savedSR;
    window.webkitSpeechRecognition = savedWSR;
  });
});
