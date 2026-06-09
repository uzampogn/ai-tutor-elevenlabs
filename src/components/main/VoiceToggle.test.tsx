import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceToggle from './VoiceToggle';

describe('VoiceToggle', () => {
  it('reflects enabled=true via aria-pressed', () => {
    render(<VoiceToggle enabled speaking={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reflects enabled=false via aria-pressed', () => {
    render(<VoiceToggle enabled={false} speaking={false} onToggle={() => {}} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<VoiceToggle enabled={false} speaking={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});