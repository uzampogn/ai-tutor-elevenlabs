import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Orb, { type OrbState } from './Orb';

const ALL_STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking'];

describe('Orb', () => {
  it('renders a button element', () => {
    render(<Orb state="idle" onClick={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it.each(ALL_STATES)('sets data-orb-state="%s" for the %s state', (state) => {
    render(<Orb state={state} onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-orb-state', state);
  });

  it('calls onClick when the button is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Orb state="idle" onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled=true', () => {
    render(<Orb state="idle" onClick={() => {}} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is not disabled by default', () => {
    render(<Orb state="idle" onClick={() => {}} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('has aria-pressed=true only when state is listening', () => {
    const { rerender } = render(<Orb state="idle" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    rerender(<Orb state="listening" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');

    rerender(<Orb state="thinking" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    rerender(<Orb state="speaking" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('has the correct aria-label for each state', () => {
    const expectedLabels: Record<OrbState, string> = {
      idle: 'Start voice input',
      listening: 'Stop listening',
      thinking: 'Thinking…',
      speaking: 'Speaking…',
    };

    const { rerender } = render(<Orb state="idle" onClick={() => {}} />);
    for (const state of ALL_STATES) {
      rerender(<Orb state={state} onClick={() => {}} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', expectedLabels[state]);
    }
  });
});
