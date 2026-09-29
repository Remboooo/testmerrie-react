import { describe, it, expect, beforeEach } from 'vitest';
import { StreamManager, NO_SELECTION, pickProtocol, resolveQualityTier, resolveIdleSelection } from './StreamManager';
import { StreamMap, StreamQualityMap, StreamSpec } from './BamApi';

const Q = (names: string[]): StreamQualityMap => Object.fromEntries(names.map(n => [n, { llhls: n }]));

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

describe('resolveQualityTier', () => {
  const full = Q(['abr', 'full', '1080p', '720p', '480p']);
  it('auto prefers the adaptive rendition', () => expect(resolveQualityTier(full, 'auto')).toBe('abr'));
  it('best picks the source/highest', () => expect(resolveQualityTier(full, 'best')).toBe('full'));
  it('saver picks the lowest', () => expect(resolveQualityTier(full, 'saver')).toBe('480p'));
  it('balanced picks a middle rendition', () => expect(resolveQualityTier(full, 'balanced')).toBe('720p'));

  const noAdaptive = Q(['1080p', '720p', '480p']);
  it('auto without adaptive uses the highest concrete', () => expect(resolveQualityTier(noAdaptive, 'auto')).toBe('1080p'));
  it('balanced of three picks the middle', () => expect(resolveQualityTier(noAdaptive, 'balanced')).toBe('720p'));

  it('degrades gracefully to the only rendition', () => {
    expect(resolveQualityTier(Q(['480p']), 'best')).toBe('480p');
    expect(resolveQualityTier(Q(['abr']), 'saver')).toBe('abr');
  });
});

describe('resolveIdleSelection', () => {
  const idle = (streams: StreamQualityMap): StreamSpec => ({ name: 'idle', streams });
  // Idle qualities typically offer hls + llhls; client always picks hls.
  const idleQ = (names: string[]): StreamQualityMap =>
    Object.fromEntries(names.map(n => [n, { llhls: `${n}-llhls`, hls: `${n}-hls` }]));

  it('is null when no idle stream is configured', () => {
    expect(resolveIdleSelection(undefined, 'auto')).toBeNull();
  });

  it('is null when the idle stream is configured but no quality tier exists yet', () => {
    expect(resolveIdleSelection(idle({}), 'auto')).toBeNull();
  });

  it('degrades to the only configured tier regardless of the requested one', () => {
    // Q() only offers llhls — used as the no-hls fallback path.
    const sel = resolveIdleSelection(idle(Q(['full'])), 'saver');
    expect(sel).toMatchObject({ key: 'idle', quality: 'full', protocol: 'llhls' });
  });

  it('resolves through the same tier logic as a real stream once multiple qualities exist', () => {
    const sel = resolveIdleSelection(idle(idleQ(['full', '720p', '480p'])), 'saver');
    expect(sel).toMatchObject({ quality: '480p', protocol: 'hls' });
  });

  it('always picks hls even when llhls is listed first', () => {
    const sel = resolveIdleSelection(idle(idleQ(['full'])), 'auto');
    expect(sel).toMatchObject({ quality: 'full', protocol: 'hls' });
  });

  it('falls back to the first-listed protocol when hls is unavailable', () => {
    const sel = resolveIdleSelection(idle(Q(['full'])), 'auto');
    expect(sel).toMatchObject({ protocol: 'llhls' });
  });
});

describe('requestQualityChange', () => {
  it('re-resolves the current stream to the new tier and persists it', () => {
    const sm = setup(); // bam/rem offers full + 480p (no adaptive)
    sm.requestStreamSelection({ key: 'bam/rem', quality: null, protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full' }); // auto -> highest concrete

    sm.requestQualityChange('saver');
    expect(sm.qualityTier).toBe('saver');
    expect(sm.getSelectedStream()).toMatchObject({ quality: '480p', protocol: 'llhls' });
    expect(localStorage.getItem('qualityTier')).toBe('saver');
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

describe('sticky ended stream + auto-resume', () => {
  it('moves a vanished playing stream to endedSelection and stops playing', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });

    sm.availableStreams = {}; // the stream dropped off the list
    sm.reconcileSelection();

    expect(sm.getSelectedStream()).toBeNull();
    expect(sm.getEndedSelection()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('auto-resumes with the same quality/protocol when the stream reappears', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: '480p', protocol: 'hls' });
    sm.availableStreams = {};
    sm.reconcileSelection(); // ended

    sm.availableStreams = STREAMS; // came back
    sm.reconcileSelection();

    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: '480p', protocol: 'hls' });
    expect(sm.getEndedSelection()).toBeNull();
  });

  it('refreshes starting/metadata from the latest poll while still selected', () => {
    const sm = setup();
    sm.availableStreams = {
      'bam/rem': { ...STREAMS['bam/rem'], starting: true, thumbnail: undefined },
    };
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    expect(sm.getSelectedStream()?.stream.starting).toBe(true);

    sm.availableStreams = {
      'bam/rem': { ...STREAMS['bam/rem'], starting: false, thumbnail: 'https://example/thumb.jpg' },
    };
    sm.reconcileSelection();

    expect(sm.getSelectedStream()?.stream.starting).toBe(false);
    expect(sm.getSelectedStream()?.stream.thumbnail).toBe('https://example/thumb.jpg');
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('an explicit deselect drops the sticky intent (no resume)', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.availableStreams = {};
    sm.reconcileSelection();
    expect(sm.getEndedSelection()).not.toBeNull();

    sm.requestStreamSelection(NO_SELECTION);
    expect(sm.getEndedSelection()).toBeNull();

    sm.availableStreams = STREAMS; // reappears, but we cancelled -> no resume
    sm.reconcileSelection();
    expect(sm.getSelectedStream()).toBeNull();
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

  it('autoStart honours the persisted protocol preference when the quality offers it', () => {
    localStorage.setItem('protocol', 'hls'); // 'full' offers hls
    const sm = setup();
    sm.autoStart = true;
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'hls' });
  });

  it('autoStart falls back to webrtc-udp when the preferred protocol is not offered for the quality', () => {
    localStorage.setItem('protocol', 'webrtc-tcp'); // 'full' has no webrtc-tcp
    const sm = setup();
    sm.autoStart = true;
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'webrtc-udp' });
  });

  it('autoStart preference persists to a fresh instance (e.g. a page reload) and re-selects', () => {
    const sm1 = setup();
    sm1.autoStart = true;
    const sm2 = setup();
    expect(sm2.autoStart).toBe(true);
    sm2.checkAutoStart();
    expect(sm2.getSelectedStream()).toMatchObject({ key: 'bam/rem' });
  });

  it("doesn't re-select after a manual deselect within the same instance", () => {
    const sm = setup();
    sm.autoStart = true;
    expect(sm.getSelectedStream()).not.toBeNull();
    sm.requestStreamSelection(NO_SELECTION);
    sm.checkAutoStart();
    expect(sm.getSelectedStream()).toBeNull();
    expect(sm.autoStart).toBe(true); // preference itself stays on
  });

  it('manually re-enabling autoStart after a deselect re-arms it', () => {
    const sm = setup();
    sm.autoStart = true;
    sm.requestStreamSelection(NO_SELECTION);
    sm.autoStart = false;
    sm.autoStart = true;
    expect(sm.getSelectedStream()).not.toBeNull();
  });
});

describe('pickProtocol', () => {
  const all = { 'webrtc-udp': 'u', 'webrtc-tcp': 't', llhls: 'l', hls: 'h' };
  it('keeps the preferred protocol when offered', () => expect(pickProtocol(all, 'hls')).toBe('hls'));
  it('prefers the other WebRTC transport first', () => expect(pickProtocol({ 'webrtc-tcp': 't', llhls: 'l' }, 'webrtc-udp')).toBe('webrtc-tcp'));
  it('falls back to LLHLS when WebRTC is withheld', () => expect(pickProtocol({ llhls: 'l', hls: 'h' }, 'webrtc-udp')).toBe('llhls'));
  it('falls back to HLS when that is all there is', () => expect(pickProtocol({ hls: 'h' }, 'webrtc-tcp')).toBe('hls'));
  it('uses the fallback order without a preference', () => expect(pickProtocol(all, null)).toBe('webrtc-udp'));
});

describe('WebRTC withheld for B-frame qualities', () => {
  // Middleware drops WebRTC from qualities carrying the B-frame source ("auto", "full").
  const BFRAMES: StreamMap = {
    'bam/rem': {
      name: 'rem',
      streams: {
        auto: { llhls: 'auto-llhls', hls: 'auto-hls' },
        full: { llhls: 'full-llhls', hls: 'full-hls' },
        '1080p': { llhls: '1080-llhls', 'webrtc-udp': '1080-udp', 'webrtc-tcp': '1080-tcp' },
      },
      webrtcUnavailable: { reason: 'bframes', qualities: ['auto', 'full'] },
    },
  };
  const NO_BFRAMES: StreamMap = {
    'bam/rem': {
      name: 'rem',
      streams: {
        auto: { llhls: 'auto-llhls', 'webrtc-udp': 'auto-udp' },
        full: { llhls: 'full-llhls', 'webrtc-udp': 'full-udp' },
        '1080p': { llhls: '1080-llhls', 'webrtc-udp': '1080-udp' },
      },
    },
  };

  it('plays the tier quality over LLHLS instead of a missing WebRTC URL', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', quality: null, protocol: 'webrtc-udp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'llhls' });
  });

  it('keeps WebRTC for a quality that still offers it', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', quality: '1080p', protocol: 'webrtc-udp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: '1080p', protocol: 'webrtc-udp' });
  });

  it('returns to WebRTC once the source stops sending B-frames', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', quality: null, protocol: 'webrtc-udp' });
    expect(sm.getSelectedStream()).toMatchObject({ protocol: 'llhls' });

    sm.availableStreams = NO_BFRAMES;
    sm.reconcileSelection();
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'webrtc-udp' });
  });

  it('a protocol change to WebRTC on a withheld quality falls back but is remembered', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
    sm.requestProtocolChange('webrtc-tcp');
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'llhls' });

    sm.availableStreams = NO_BFRAMES;
    sm.reconcileSelection();
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'webrtc-udp' });
  });
});
