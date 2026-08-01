import { describe, it, expect, beforeEach } from 'vitest';
import { StreamManager, NO_SELECTION, StreamSelection } from './StreamManager';
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

function setup(streams: StreamMap = STREAMS) {
  const sm = new StreamManager();
  sm.availableStreams = streams;
  let last: StreamSelection | undefined;
  sm.setSelectedStreamListener((s) => { last = s; }); // fires once immediately with the current (null) selection
  return { sm, last: () => last };
}

beforeEach(() => localStorage.clear());

describe('requestStreamSelection', () => {
  it('selects the requested key/quality/protocol when all are available', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    expect(last()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('falls back to the first quality when the requested quality is unavailable', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'nonexistent', protocol: 'llhls' });
    expect(last()).toMatchObject({ quality: 'full', protocol: 'llhls' });
  });

  it('falls back to the default protocol (webrtc-udp) when the requested protocol is unavailable', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'webrtc-tcp' });
    expect(last()).toMatchObject({ quality: 'full', protocol: 'webrtc-udp' });
  });

  it('clears the selection for an unknown key', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'nope', quality: null, protocol: null });
    expect(last()).toBeNull();
  });

  it('clears the selection for NO_SELECTION', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestStreamSelection(NO_SELECTION);
    expect(last()).toBeNull();
  });
});

describe('requestProtocolChange', () => {
  it('does nothing when no stream is selected', () => {
    const { sm } = setup();
    let calls = 0;
    sm.setSelectedStreamListener(() => { calls++; }); // fires once immediately
    calls = 0;
    sm.requestProtocolChange('llhls');
    expect(calls).toBe(0);
  });

  it('changes to an available protocol', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestProtocolChange('hls');
    expect(last()).toMatchObject({ quality: 'full', protocol: 'hls' });
  });

  it('falls back to the default protocol when the requested one is unavailable for the quality', () => {
    const { sm, last } = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestProtocolChange('webrtc-tcp'); // "full" has no webrtc-tcp
    expect(last()).toMatchObject({ protocol: 'webrtc-udp' });
  });
});

describe('autostart + availability', () => {
  it('isStreamAvailable reflects availableStreams', () => {
    const { sm } = setup();
    expect(sm.isStreamAvailable('bam/rem')).toBe(true);
    expect(sm.isStreamAvailable('nope')).toBe(false);
  });

  it('autoStart selects the first stream, preferring the "full" quality', () => {
    const { sm, last } = setup();
    sm.autoStart = true;
    expect(last()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'webrtc-udp' });
  });

  it('autoStart uses the first quality when "full" is absent', () => {
    const { sm, last } = setup({ 'x/y': { name: 'y', streams: { '480p': { hls: 'u' } } } });
    sm.autoStart = true;
    expect(last()).toMatchObject({ key: 'x/y', quality: '480p' });
  });
});
