import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useSpeechRecognition } from './useSpeechRecognition';

// Helper component that exposes the hook result via callbacks so we can
// drive it imperatively from the test.
interface HarnessProps {
  listening: boolean;
  setListening: (v: boolean) => void;
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  disabled?: boolean;
  onResult?: (result: { supported: boolean; toggle: () => void }) => void;
}

function Harness({ onResult, ...hookArgs }: HarnessProps) {
  const result = useSpeechRecognition(hookArgs);
  React.useEffect(() => {
    onResult?.(result);
  });
  return null;
}

describe('useSpeechRecognition', () => {
  it('returns supported=true when SpeechRecognition is mocked in the environment', () => {
    const setListening = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    let hookResult: { supported: boolean; toggle: () => void } | undefined;

    render(
      <Harness
        listening={false}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
        onResult={(r) => { hookResult = r; }}
      />,
    );

    expect(hookResult?.supported).toBe(true);
  });

  it('toggle() calls setListening(true) on first call then setListening(false) after rerender with listening=true', () => {
    const setListening = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    let hookResult: { supported: boolean; toggle: () => void } | undefined;

    const { rerender } = render(
      <Harness
        listening={false}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
        onResult={(r) => { hookResult = r; }}
      />,
    );

    // First toggle: should call start and setListening(true)
    act(() => { hookResult?.toggle(); });
    expect(setListening).toHaveBeenCalledWith(true);

    // Rerender with listening=true (as if parent updated state)
    rerender(
      <Harness
        listening={true}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
        onResult={(r) => { hookResult = r; }}
      />,
    );

    // Second toggle: should call stop and setListening(false)
    act(() => { hookResult?.toggle(); });
    expect(setListening).toHaveBeenCalledWith(false);
  });

  it('onFinal callback fires when recognition produces a final result', () => {
    const setListening = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();

    let capturedInstance: SpeechRecognition | undefined;

    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const instance = new OrigCtor();
      capturedInstance = instance;
      return instance;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;

    render(
      <Harness
        listening={false}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
      />,
    );

    // Simulate a final result event
    act(() => {
      const evt: SpeechRecognitionEvent = {
        resultIndex: 0,
        results: Object.assign(
          [
            Object.assign([{ transcript: 'hello world', confidence: 1 }], {
              isFinal: true,
              length: 1,
              item: () => ({ transcript: 'hello world', confidence: 1 }),
            }),
          ],
          { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
        ) as SpeechRecognitionResultList,
      } as unknown as SpeechRecognitionEvent;
      capturedInstance?.onresult?.(evt);
    });

    expect(onFinal).toHaveBeenCalledWith('hello world');
    expect(onInterim).not.toHaveBeenCalled();

    window.SpeechRecognition = OrigCtor;
  });

  it('onInterim fires for interim results', () => {
    const setListening = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();

    let capturedInstance: SpeechRecognition | undefined;

    const OrigCtor = window.SpeechRecognition!;
    const MockCtor = vi.fn().mockImplementation(() => {
      const instance = new OrigCtor();
      capturedInstance = instance;
      return instance;
    }) as unknown as SpeechRecognitionStatic;
    window.SpeechRecognition = MockCtor;

    render(
      <Harness
        listening={false}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
      />,
    );

    act(() => {
      const evt: SpeechRecognitionEvent = {
        resultIndex: 0,
        results: Object.assign(
          [
            Object.assign([{ transcript: 'partial', confidence: 0.5 }], {
              isFinal: false,
              length: 1,
              item: () => ({ transcript: 'partial', confidence: 0.5 }),
            }),
          ],
          { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
        ) as SpeechRecognitionResultList,
      } as unknown as SpeechRecognitionEvent;
      capturedInstance?.onresult?.(evt);
    });

    expect(onInterim).toHaveBeenCalledWith('partial');
    expect(onFinal).not.toHaveBeenCalled();

    window.SpeechRecognition = OrigCtor;
  });

  it('aborts and sets listening=false when disabled=true and listening=true', () => {
    const setListening = vi.fn();
    const onInterim = vi.fn();
    const onFinal = vi.fn();

    const { rerender } = render(
      <Harness
        listening={true}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
        disabled={false}
      />,
    );

    // Now disable while still "listening"
    rerender(
      <Harness
        listening={true}
        setListening={setListening}
        onInterim={onInterim}
        onFinal={onFinal}
        disabled={true}
      />,
    );

    expect(setListening).toHaveBeenCalledWith(false);
  });
});
