import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSwipeToClose } from './useSwipeToClose';

function drag(handlers: any, fromX: number, toX: number) {
  handlers.onPointerDown({ clientX: fromX, clientY: 0 });
  handlers.onPointerMove({ clientX: toX, clientY: 2 });
  handlers.onPointerUp({ clientX: toX, clientY: 2 });
}

describe('useSwipeToClose', () => {
  it('closes on a leftward swipe past threshold', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'left', enabled: true }));
    drag(result.current, 200, 120); // 80px left
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('ignores small or wrong-direction drags', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'left', enabled: true }));
    drag(result.current, 200, 180); // 20px, under threshold
    drag(result.current, 200, 300); // rightward
    expect(onClose).not.toHaveBeenCalled();
  });
  it('is inert when disabled', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToClose({ onClose, direction: 'right', enabled: false }));
    drag(result.current, 200, 400);
    expect(onClose).not.toHaveBeenCalled();
  });
});
