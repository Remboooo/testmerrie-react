import { useEffect, useRef, useState } from 'react';
import { OvenPlayerState } from './OvenPlayer';
import { StreamSelection } from './StreamManager';

const RETRY_DELAY_MS = 2000;
const RETRY_BUDGET_MS = 16000;

/**
 * Rides out the OME readiness window: a stream can be listed before its playlist
 * is servable (first-segment 404, and much longer after a reconnect — see
 * docs/ome-stream-readiness.md). When the player errors on a *real* selection,
 * reload the SAME source (never a different quality/protocol) for a budget,
 * surfacing it as "loading" rather than a terminal error until the budget runs
 * out. Returns whether we're currently retrying.
 */
export function usePlayerRetry(
  playerState: OvenPlayerState,
  selectedStream: StreamSelection,
  reload: () => void,
): boolean {
  const [retrying, setRetrying] = useState(false);
  const firstErrorAtRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const clearTimer = () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  // A new selection gets a fresh retry budget.
  useEffect(() => {
    firstErrorAtRef.current = undefined;
    clearTimer();
    setRetrying(false);
  }, [selectedStream]);

  useEffect(() => {
    if (selectedStream === null || playerState === 'playing') {
      // Nothing to retry / recovered.
      firstErrorAtRef.current = undefined;
      clearTimer();
      setRetrying(false);
      return;
    }
    if (playerState !== 'error') {
      return; // idle / loading / stalled -> wait it out
    }
    const now = Date.now();
    if (firstErrorAtRef.current === undefined) {
      firstErrorAtRef.current = now;
    }
    if (now - firstErrorAtRef.current < RETRY_BUDGET_MS) {
      setRetrying(true);
      clearTimer();
      timerRef.current = setTimeout(() => reloadRef.current(), RETRY_DELAY_MS);
    } else {
      setRetrying(false); // budget exhausted -> let the terminal error show
    }
  }, [playerState, selectedStream]);

  useEffect(() => clearTimer, []);

  return retrying;
}
