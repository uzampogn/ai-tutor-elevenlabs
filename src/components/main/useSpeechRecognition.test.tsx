import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function makeResultEvent(transcript: string, isFinal: boolean, resultIndex = 0): SpeechRecognitionEvent {
  return {
    resultIndex,
    results: Object.assign(
      [
        Object.assign([{ transcript, confidence: 1 }], {
          isFinal,
          length: 1,
          item: () => ({ transcript, confidence: 1 }),
        }),
      ],
      { length: 1, item: (i: number) => ([] as SpeechRecognitionResult[])[i] },
    ) as SpeechRecognitionResultList,
  } as unknown as SpeechRecognitionEvent;
}

/**
 * Build a SpeechRecognitionEvent whose `results` is the full *cumulative* list
 * for the session (the real API contract), unlike `makeResultEvent` which is a
 * single result. `resultIndex` is the first changed index for this event.
 */
function makeCumulativeEvent(
  segments: { transcript: string; isFinal: boolean }[],
  resultIndex = 0,
): SpeechRecognitionEvent {
  const results = segments.map((s) =>
    Object.assign([{ transcript: s.transcript, confidence: 1 }], {
      isFinal: s.isFinal,
      length: 1,
      item: () => ({ transcript: s.transcript, confidence: 1 }),
    }),
  );
  return {
    resultIndex,
    results: Object.assign(results, {
      length: results.length,
      item: (i: number) => results[i] as unknown as SpeechRecognitionResult,
    }) as unknown as SpeechRecognitionResultList,
  } as unknown as SpeechRecognitionEvent;
}

function renderWithInstance(
  args: Omit<HarnessProps, 'onResult'>,
): {
  instance: () => SpeechRecognition;
  hook: () => { supported: boolean; toggle: () => void; sendNow?: () => void };
  restore: () => void;
} {
  let captured: SpeechRecognition | undefined;
  let hookResult: { supported: boolean; toggle: () => void; sendNow?: () => void } | undefined;
  const OrigCtor = window.SpeechRecognition!;
  const MockCtor = vi.fn().mockImplementation(() => {
    const inst = new OrigCtor();
    captured = inst;
    return inst;
  }) as unknown as SpeechRecognitionStatic;
  window.SpeechRecognition = MockCtor;
  render(<Harness {...args} onResult={(r) => { hookResult = r as typeof hookResult; }} />);
  return {
    instance: () => captured!,
    hook: () => hookResult!,
    restore: () => { window.SpeechRecognition = OrigCtor; },
  };
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

  describe('silence timer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

    it('does not send before 2.5s of silence, then sends', () => {
      const onFinal = vi.fn();
      const { instance, restore } = renderWithInstance({
        listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => { instance().onresult?.(makeResultEvent('hello there', true)); });
      act(() => { vi.advanceTimersByTime(2400); });
      expect(onFinal).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(200); }); // crosses 2500ms
      expect(onFinal).toHaveBeenCalledWith('hello there');
      restore();
    });

    it('each new result resets the silence timer (rolling window)', () => {
      const onFinal = vi.fn();
      const { instance, restore } = renderWithInstance({
        listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => {
        instance().onresult?.(makeCumulativeEvent([{ transcript: 'part one ', isFinal: true }], 0));
      });
      act(() => { vi.advanceTimersByTime(2000); });
      act(() => {
        instance().onresult?.(
          makeCumulativeEvent(
            [{ transcript: 'part one ', isFinal: true }, { transcript: 'part two', isFinal: true }],
            1,
          ),
        );
      });
      act(() => { vi.advanceTimersByTime(2000); }); // 4000ms total, but only 2000 since last result
      expect(onFinal).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(600); });
      expect(onFinal).toHaveBeenCalledWith('part one part two');
      restore();
    });

    it('does not send an empty transcript when the timer fires', () => {
      const onFinal = vi.fn();
      const setListening = vi.fn();
      const { restore } = renderWithInstance({
        listening: true, setListening, onInterim: vi.fn(), onFinal,
      });

      act(() => { vi.advanceTimersByTime(3000); }); // silence, nothing said
      expect(onFinal).not.toHaveBeenCalled();
      expect(setListening).not.toHaveBeenCalledWith(false);
      restore();
    });

    it('restarts recognition when the browser ends the session while still listening', () => {
      const { instance, hook, restore } = renderWithInstance({
        listening: false, setListening: vi.fn(), onInterim: vi.fn(), onFinal: vi.fn(),
      });
      act(() => { hook().toggle(); }); // start → shouldListen = true, start() called once
      const before = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
      act(() => { instance().onend?.(new Event('end') as unknown as Event); });
      const after = (instance().start as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(after).toBe(before + 1);
      restore();
    });

    it('sendNow() sends the transcript immediately, cancelling the countdown', () => {
      const onFinal = vi.fn();
      const { instance, hook, restore } = renderWithInstance({
        listening: true, setListening: vi.fn(), onInterim: vi.fn(), onFinal,
      });

      act(() => { instance().onresult?.(makeResultEvent('send me now', true)); });
      act(() => { hook().sendNow!(); });
      expect(onFinal).toHaveBeenCalledWith('send me now');

      onFinal.mockClear();
      act(() => { vi.advanceTimersByTime(3000); }); // timer must not fire a second send
      expect(onFinal).not.toHaveBeenCalled();
      restore();
    });

    it('sendNow() with no transcript cancels: stops listening, sends nothing', () => {
      const onFinal = vi.fn();
      const setListening = vi.fn();
      const { hook, restore } = renderWithInstance({
        listening: true, setListening, onInterim: vi.fn(), onFinal,
      });

      act(() => { hook().sendNow!(); });
      expect(onFinal).not.toHaveBeenCalled();
      expect(setListening).toHaveBeenCalledWith(false);
      restore();
    });
  });
});
