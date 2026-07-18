import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Scribe, RealtimeEvents, __lastConnection } from '@/test/fakeScribeClient';
import VoiceDock from './VoiceDock';

function Shell({ onStartListening }: { onStartListening: () => void }) {
  // Minimal stand-in for AppShell's listening state ownership.
  const [listening, setListening] = React.useState(false);
  return (
    <VoiceDock
      input=""
      setInput={vi.fn()}
      isLoading={false}
      listening={listening}
      setListening={setListening}
      onSend={vi.fn()}
      speaking={false}
      onStartListening={onStartListening}
    />
  );
}

describe('VoiceDock + Scribe integration', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ token: 'tok' }), { status: 200 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('tapping the orb pauses playback (onStartListening) and only shows listening after SESSION_STARTED', async () => {
    const onStartListening = vi.fn();
    render(<Shell onStartListening={onStartListening} />);
    const user = userEvent.setup();

    const orb = screen.getByRole('button', { name: 'Start voice input' });
    await user.click(orb);
    expect(onStartListening).toHaveBeenCalledTimes(1);

    // Socket not open yet → orb must still be idle.
    await vi.waitFor(() => expect(Scribe.connect).toHaveBeenCalled());
    expect(orb).toHaveAttribute('data-orb-state', 'idle');

    act(() =>
      __lastConnection().emit(RealtimeEvents.SESSION_STARTED, {
        message_type: 'session_started',
        session_id: 's',
        config: {},
      }),
    );
    expect(screen.getByRole('button', { name: 'Stop listening' })).toHaveAttribute(
      'data-orb-state',
      'listening',
    );
  });
});
