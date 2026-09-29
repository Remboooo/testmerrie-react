import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StreamSelector from './StreamSelector';
import { StreamMap, StreamSpec } from './BamApi';

const BASE: StreamSpec = {
  name: 'rem',
  streams: { full: { llhls: 'full-llhls' } },
  created: '2026-09-29T20:00:00Z',
};

function renderSelector(streams: StreamMap) {
  return render(
    <StreamSelector
      streams={streams}
      screenshotTimestamp={0}
      onStreamRequested={() => {}}
      currentStream={null}
      endedStream={null}
    />,
  );
}

afterEach(cleanup);

describe('StreamSelector WebRTC warning', () => {
  it('warns when WebRTC is withheld because of B-frames', () => {
    renderSelector({ 'bam/rem': { ...BASE, webrtcUnavailable: { reason: 'bframes', qualities: ['full'] } } });
    expect(screen.getByText(/WebRTC alleen in lagere kwaliteit/)).toBeTruthy();
  });

  it('shows no warning for a normal stream', () => {
    renderSelector({ 'bam/rem': BASE });
    expect(screen.queryByText(/WebRTC alleen in lagere kwaliteit/)).toBeNull();
  });

  it('shows no warning while the stream is still starting', () => {
    renderSelector({ 'bam/rem': { ...BASE, starting: true, webrtcUnavailable: { reason: 'bframes', qualities: ['full'] } } });
    expect(screen.queryByText(/WebRTC alleen in lagere kwaliteit/)).toBeNull();
  });
});
