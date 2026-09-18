import { useEffect, useRef, useState } from 'react';
import { OvenPlayerState } from './OvenPlayer';
import { StreamSelection } from './StreamManager';

// Fresh starts are usually a few seconds; OME #969 reconnects can 404 for ~a
// minute. We never give up while the selection is still live — only back off.
export const RETRY_DELAY_MS = 2000;
export const RETRY_DELAY_MAX_MS = 10000;

/**
 * Rides out the OME readiness window: a stream can be listed before its playlist
 * is servable (first-segment 404, and much longer after a reconnect — see
 * docs/ome-stream-readiness.md). When the player errors on a *real* selection,
 * reload the SAME source (never a different quality/protocol), surfacing it as
 * "loading" rather than a terminal error, for as long as that selection stays
 * selected. Delay grows from RETRY_DELAY_MS up to RETRY_DELAY_MAX_MS so a
 * stubborn readiness window doesn't hammer OME. Returns whether we're currently
 * retrying.
 */
export function usePlayerRetry(
  playerState: OvenPlayerState,
  selectedStream: StreamSelection,
  reload: () => void,
): boolean {
  const [retrying, setRetrying] = useState(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const clearTimer = () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  // A new selection (key/quality/protocol) starts a fresh retry sequence.
  // Depend on those fields — not object identity — because StreamManager
  // refreshes the StreamSpec on every poll (starting flag, signed URLs).
  useEffect(() => {
    attemptRef.current = 0;
    clearTimer();
    setRetrying(false);
  }, [selectedStream?.key, selectedStream?.quality, selectedStream?.protocol]);

  useEffect(() => {
    if (selectedStream === null || playerState === 'playing') {
      // Nothing to retry / recovered.
      attemptRef.current = 0;
      clearTimer();
      setRetrying(false);
      return;
    }
    if (playerState !== 'error') {
      return; // idle / loading / stalled -> wait it out
    }
    // Still selected and errored: keep trying. Giving up here left users stuck
    // on the terminal overlay while OME was still warming up (#969 / slow ingest).
    const delay = Math.min(
      RETRY_DELAY_MS * Math.pow(2, attemptRef.current),
      RETRY_DELAY_MAX_MS,
    );
    attemptRef.current += 1;
    setRetrying(true);
    clearTimer();
    timerRef.current = setTimeout(() => reloadRef.current(), delay);
  }, [playerState, selectedStream?.key, selectedStream?.quality, selectedStream?.protocol]);

  useEffect(() => clearTimer, []);

  return retrying;
}
