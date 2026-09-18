import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RETRY_DELAY_MS, RETRY_DELAY_MAX_MS, usePlayerRetry } from './usePlayerRetry';
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

/** Simulate one error → reload → loading → error cycle (as OvenPlayer does). */
function cycleError(rerender: (props: { state: OvenPlayerState; sel: StreamSelection }) => void, sel = SEL) {
  act(() => rerender({ state: 'error', sel }));
  act(() => vi.advanceTimersByTime(RETRY_DELAY_MAX_MS)); // cover any current backoff
  act(() => rerender({ state: 'loading', sel }));
}

describe('usePlayerRetry', () => {
  it('treats an error as loading and reloads the same source after the delay', () => {
    const { result, rerender, reload } = render();
    expect(result.current).toBe(false);

    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);          // shown as loading, not terminal error
    expect(reload).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(RETRY_DELAY_MS));
    expect(reload).toHaveBeenCalledTimes(1);     // retried the same selection
  });

  it('stops retrying once playback recovers', () => {
    const { result, rerender } = render();
    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);

    act(() => rerender({ state: 'playing', sel: SEL }));
    expect(result.current).toBe(false);
  });

  it('keeps retrying past the old 16s budget while the stream stays selected', () => {
    const { result, rerender, reload } = render();
    act(() => rerender({ state: 'error', sel: SEL }));
    expect(result.current).toBe(true);

    // Ride well past the former ~16s give-up: still selected → still retrying.
    for (let i = 0; i < 12; i++) {
      cycleError(rerender);
    }
    expect(result.current).toBe(true);
    expect(reload.mock.calls.length).toBeGreaterThan(8);
  });

  it('backs off toward RETRY_DELAY_MAX_MS between attempts', () => {
    const { rerender, reload } = render();

    act(() => rerender({ state: 'error', sel: SEL }));
    act(() => vi.advanceTimersByTime(RETRY_DELAY_MS - 1));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);

    // Next error: 4s delay
    act(() => rerender({ state: 'loading', sel: SEL }));
    act(() => rerender({ state: 'error', sel: SEL }));
    act(() => vi.advanceTimersByTime(RETRY_DELAY_MS * 2 - 1));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(2);

    // Third: 8s; fourth+ capped at max
    act(() => rerender({ state: 'loading', sel: SEL }));
    act(() => rerender({ state: 'error', sel: SEL }));
    act(() => vi.advanceTimersByTime(RETRY_DELAY_MS * 4));
    expect(reload).toHaveBeenCalledTimes(3);

    act(() => rerender({ state: 'loading', sel: SEL }));
    act(() => rerender({ state: 'error', sel: SEL }));
    act(() => vi.advanceTimersByTime(RETRY_DELAY_MAX_MS));
    expect(reload).toHaveBeenCalledTimes(4);
  });

  it('never retries when there is no selection', () => {
    const { result, rerender, reload } = render();
    act(() => rerender({ state: 'error', sel: null }));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(reload).not.toHaveBeenCalled();
  });

  it('resets the backoff when the selection changes', () => {
    const { result, rerender, reload } = render();
    // burn a few attempts so backoff has grown
    for (let i = 0; i < 4; i++) {
      cycleError(rerender);
    }
    expect(result.current).toBe(true);
    reload.mockClear();

    // a different selection starts fresh at the initial delay
    const SEL2 = { ...SEL, key: 'bam/other' } as StreamSelection;
    act(() => rerender({ state: 'error', sel: SEL2 }));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(RETRY_DELAY_MS - 1));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
