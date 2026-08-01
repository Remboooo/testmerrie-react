import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayerRetry } from './usePlayerRetry';
import { OvenPlayerState } from './OvenPlayer';
import { StreamSelection } from './StreamManager';

const SEL = { key: 'bam/rem', stream: {} as any, quality: 'full', protocol: 'llhls' } as StreamSelection;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function render(reload = vi.fn()) {
  return {
    reload,
    ...renderHook(
      ({ state, sel }: { state: OvenPlayerState; sel: StreamSelection }) => usePlayerRetry(state, sel, reload),
      { initialProps: { state: 'loading' as OvenPlayerState, sel: SEL } },
    ),
  };
}

describe('usePlayerRetry', () => {
  it('treats an error as loading and reloads the same source after the delay', () => {
    const { result, rerender, reload } = render();
    expect(result.current).toBe(false);

    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);          // shown as loading, not terminal error
    expect(reload).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(2000));
    expect(reload).toHaveBeenCalledTimes(1);     // retried the same selection
  });

  it('stops retrying once playback recovers', () => {
    const { result, rerender } = render();
    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);

    act(() => rerender({ state: 'playing', sel: SEL }));
    expect(result.current).toBe(false);
  });

  it('gives up after the retry budget so the terminal error can show', () => {
    const { result, rerender } = render();
    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);

    // keep erroring past the ~16s budget
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(2000));
      act(() => rerender({ state: 'loading', sel: SEL }));
      act(() => rerender({ state: 'error', sel: SEL }));
    }
    expect(result.current).toBe(false);
  });

  it('never retries when there is no selection', () => {
    const { result, rerender, reload } = render();
    act(() => rerender({ state: 'error', sel: null }));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(reload).not.toHaveBeenCalled();
  });

  it('resets the budget when the selection changes', () => {
    const { result, rerender } = render();
    // exhaust the budget on the first selection (cycle state so the effect re-runs,
    // as the real retry->rebuild loop does)
    act(() => rerender({ state: 'error', sel: SEL }));
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(2000));
      act(() => rerender({ state: 'loading', sel: SEL }));
      act(() => rerender({ state: 'error', sel: SEL }));
    }
    expect(result.current).toBe(false);

    // a different selection starts fresh
    const SEL2 = { ...SEL, key: 'bam/other' } as StreamSelection;
    act(() => rerender({ state: 'error', sel: SEL2 }));
    expect(result.current).toBe(true);
  });
});
