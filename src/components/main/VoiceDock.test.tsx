import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('VoiceDock — send paths', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  function renderWithInstance(props: React.ComponentProps<typeof VoiceDock>) {
    let captured: SpeechRecognition | undefined;
    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const inst = new OrigCtor();
      captured = inst;
      return inst;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;
    render(<VoiceDock {...props} />);
    return { instance: () => captured!, restore: () => { window.SpeechRecognition = OrigCtor; } };
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
    const { instance, restore } = renderWithInstance({
      input: '', setInput: vi.fn(), isLoading: false, listening: true,
      setListening: vi.fn(), onSend, speaking: false,
    });

    act(() => { instance().onresult?.(finalResult('test question')); });
    expect(onSend).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2600); });
    expect(onSend).toHaveBeenCalledWith('test question');
    restore();
  });

  it('tapping the orb while listening sends immediately', () => {
    const onSend = vi.fn();
    const { instance, restore } = renderWithInstance({
      input: '', setInput: vi.fn(), isLoading: false, listening: true,
      setListening: vi.fn(), onSend, speaking: false,
    });

    act(() => { instance().onresult?.(finalResult('hello')); });
    act(() => { screen.getByRole('button', { name: 'Stop listening' }).click(); });
    expect(onSend).toHaveBeenCalledWith('hello');
    restore();
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
