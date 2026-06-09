import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from './Composer';

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const props: React.ComponentProps<typeof Composer> = {
    input: '',
    setInput: vi.fn(),
    isLoading: false,
    listening: false,
    setListening: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe('Composer / SendBtn', () => {
  it('disables Send when input is empty', () => {
    renderComposer({ input: '' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('disables Send when input is only whitespace', () => {
    renderComposer({ input: '   ' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('disables Send when isLoading is true even with text', () => {
    renderComposer({ input: 'hello', isLoading: true });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('enables Send when input has text and not loading', () => {
    renderComposer({ input: 'hello' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('calls onSend when the Send button is clicked', async () => {
    const user = userEvent.setup();
    const props = renderComposer({ input: 'hello' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('calls onSend when Enter is pressed in the textarea', async () => {
    const user = userEvent.setup();
    const props = renderComposer({ input: 'hello' });
    const ta = screen.getByPlaceholderText(/ask about the latest ai news/i);
    ta.focus();
    await user.keyboard('{Enter}');
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const props = renderComposer({ input: 'hello' });
    const ta = screen.getByPlaceholderText(/ask about the latest ai news/i);
    ta.focus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(props.onSend).not.toHaveBeenCalled();
  });
});