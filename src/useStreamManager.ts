import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AvailableStreamUpdate, DEFAULT_QUALITY_TIER, QualityTier, StreamManager, StreamSelection } from './StreamManager';

const EMPTY_UPDATE: AvailableStreamUpdate = { streamMap: {}, idleStream: undefined, refreshTimestamp: 0 };
const noopSubscribe = () => () => {};

/**
 * Owns the StreamManager lifecycle and exposes its state reactively via
 * useSyncExternalStore, replacing the manual listener-wiring effects and the
 * class-in-useState pattern in App.
 */
export function useStreamManager(authenticated: boolean): {
  manager: StreamManager | undefined;
  availableStreams: AvailableStreamUpdate;
  selectedStream: StreamSelection;
  endedSelection: StreamSelection;
  qualityTier: QualityTier;
} {
  const [manager, setManager] = useState<StreamManager | undefined>();

  useEffect(() => {
    if (authenticated && !manager) {
      setManager(new StreamManager());
    }
  }, [authenticated, manager]);

  const subscribe = useCallback(
    (onChange: () => void) => (manager ? manager.subscribe(onChange) : noopSubscribe()),
    [manager],
  );
  const availableStreams = useSyncExternalStore(subscribe, () => manager?.getAvailableStreams() ?? EMPTY_UPDATE);
  const selectedStream = useSyncExternalStore(subscribe, () => manager?.getSelectedStream() ?? null);
  const endedSelection = useSyncExternalStore(subscribe, () => manager?.getEndedSelection() ?? null);
  const qualityTier = useSyncExternalStore(subscribe, () => manager?.qualityTier ?? DEFAULT_QUALITY_TIER);

  return { manager, availableStreams, selectedStream, endedSelection, qualityTier };
}
