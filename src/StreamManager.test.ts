import { describe, it, expect, beforeEach } from 'vitest';
import { StreamManager, NO_SELECTION } from './StreamManager';
import { StreamMap } from './BamApi';

const STREAMS: StreamMap = {
  'bam/rem': {
    name: 'rem',
    streams: {
      full: { llhls: 'full-llhls', 'webrtc-udp': 'full-udp', hls: 'full-hls' },
      '480p': { llhls: '480-llhls', hls: '480-hls' }, // no webrtc here
    },
  },
};

function setup(streams: StreamMap = STREAMS): StreamManager {
  const sm = new StreamManager();
  sm.availableStreams = streams;
  return sm;
}

beforeEach(() => localStorage.clear());

describe('requestStreamSelection', () => {
  it('selects the requested key/quality/protocol when all are available', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('falls back to the first quality when the requested quality is unavailable', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'nonexistent', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'llhls' });
  });

  it('falls back to the default protocol (webrtc-udp) when the requested protocol is unavailable', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'webrtc-tcp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'webrtc-udp' });
  });

  it('clears the selection for an unknown key', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'nope', quality: null, protocol: null });
    expect(sm.getSelectedStream()).toBeNull();
  });

  it('clears the selection for NO_SELECTION', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestStreamSelection(NO_SELECTION);
    expect(sm.getSelectedStream()).toBeNull();
  });
});

describe('requestProtocolChange', () => {
  it('does nothing when no stream is selected', () => {
    const sm = setup();
    sm.requestProtocolChange('llhls');
    expect(sm.getSelectedStream()).toBeNull();
  });

  it('changes to an available protocol', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestProtocolChange('hls');
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'hls' });
  });

  it('falls back to the default protocol when the requested one is unavailable for the quality', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestProtocolChange('webrtc-tcp'); // "full" has no webrtc-tcp
    expect(sm.getSelectedStream()).toMatchObject({ protocol: 'webrtc-udp' });
  });
});

describe('subscribe + snapshots', () => {
  it('notifies subscribers on selection changes and unsubscribes cleanly', () => {
    const sm = setup();
    let notifications = 0;
    const unsubscribe = sm.subscribe(() => { notifications++; });

    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    expect(notifications).toBe(1);
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem' });

    unsubscribe();
    sm.requestStreamSelection(NO_SELECTION);
    expect(notifications).toBe(1); // no further notifications after unsubscribe
  });
});

describe('autostart + availability', () => {
  it('isStreamAvailable reflects availableStreams', () => {
    const sm = setup();
    expect(sm.isStreamAvailable('bam/rem')).toBe(true);
    expect(sm.isStreamAvailable('nope')).toBe(false);
  });

  it('autoStart selects the first stream, preferring the "full" quality', () => {
    const sm = setup();
    sm.autoStart = true;
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'webrtc-udp' });
  });

  it('autoStart uses the first quality when "full" is absent', () => {
    const sm = setup({ 'x/y': { name: 'y', streams: { '480p': { hls: 'u' } } } });
    sm.autoStart = true;
    expect(sm.getSelectedStream()).toMatchObject({ key: 'x/y', quality: '480p' });
  });
});
