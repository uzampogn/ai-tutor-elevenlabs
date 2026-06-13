import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InputDock, { type InputMode } from './InputDock';

function renderInputDock(overrides: Partial<React.ComponentProps<typeof InputDock>> = {}) {
  const props: React.ComponentProps<typeof InputDock> = {
    inputMode: 'voice',
    setInputMode: vi.fn(),
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    listening: false,
    setListening: vi.fn(),
    onSend: vi.fn(),
    speaking: false,
    ...overrides,
  };
  render(<InputDock {...props} />);
  return props;
}

describe('InputDock — mode rendering', () => {
  it('renders VoiceDock (orb) when inputMode=voice', () => {
    renderInputDock({ inputMode: 'voice' });
    // The Orb renders a button with class "orb" and data-orb-state
    const orb = document.querySelector('.orb');
    expect(orb).not.toBeNull();
  });

  it('renders Composer (textarea) when inputMode=text', () => {
    renderInputDock({ inputMode: 'text' });
    expect(
      screen.getByPlaceholderText(/ask about the latest ai news/i),
    ).toBeInTheDocument();
    // Orb should not be present
    expect(document.querySelector('.orb')).toBeNull();
  });
});

describe('InputDock — mode switch', () => {
  it('renders both Voice and Text buttons', () => {
    renderInputDock();
    expect(screen.getByRole('button', { name: 'Voice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument();
  });

  it('Voice button has aria-pressed=true when inputMode=voice', () => {
    renderInputDock({ inputMode: 'voice' });
    expect(screen.getByRole('button', { name: 'Voice' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('Text button has aria-pressed=true when inputMode=text', () => {
    renderInputDock({ inputMode: 'text' });
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Voice' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking Voice button calls setInputMode("voice")', async () => {
    const user = userEvent.setup();
    const props = renderInputDock({ inputMode: 'text' });
    await user.click(screen.getByRole('button', { name: 'Voice' }));
    expect(props.setInputMode).toHaveBeenCalledWith('voice');
  });

  it('clicking Text button calls setInputMode("text")', async () => {
    const user = userEvent.setup();
    const props = renderInputDock({ inputMode: 'voice' });
    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(props.setInputMode).toHaveBeenCalledWith('text');
  });
});

describe('InputDock — footer disclaimer', () => {
  it('shows disclaimer in voice mode', () => {
    renderInputDock({ inputMode: 'voice' });
    expect(
      screen.getByText(/answers are grounded in the claude blog/i),
    ).toBeInTheDocument();
  });

  it('shows disclaimer in text mode (via Composer)', () => {
    renderInputDock({ inputMode: 'text' });
    expect(
      screen.getByText(/answers are grounded in the claude blog/i),
    ).toBeInTheDocument();
  });
});
