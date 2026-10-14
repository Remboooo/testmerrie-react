import { describe, it, expect, beforeEach } from 'vitest';
import {
  StreamManager, NO_SELECTION, pickProtocol, resolveIdleSelection,
  qualityOptions, pickOption, matchQualityLevel, QualityOption,
} from './StreamManager';
import { Rendition, StreamMap, StreamQualityMap, StreamSpec } from './BamApi';

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
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('falls back to the default protocol (webrtc-udp) when the requested protocol is unavailable', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'webrtc-tcp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'webrtc-udp' });
  });

  it('clears the selection for an unknown key', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'nope', protocol: null });
    expect(sm.getSelectedStream()).toBeNull();
  });

  it('clears the selection for NO_SELECTION', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    sm.requestStreamSelection(NO_SELECTION);
    expect(sm.getSelectedStream()).toBeNull();
  });
});

const R = (height: number, bitrate: number, framerate = 30): Rendition =>
  ({ width: Math.round(height * 16 / 9), height, framerate, bitrate });

// An ABR master over a typical ladder, plus the concrete playlists next to it.
const LADDER: StreamSpec = {
  name: 'rem',
  streams: {
    auto: { llhls: 'auto-llhls', hls: 'auto-hls', 'webrtc-udp': 'auto-udp' },
    full: { llhls: 'full-llhls', 'webrtc-udp': 'full-udp' },
    '480p 500kbps': { llhls: '480-llhls', 'webrtc-udp': '480-udp' },
  },
  renditions: {
    auto: [R(2160, 30000000, 60), R(1080, 6000000, 60), R(720, 2500000), R(480, 500000)],
    full: [R(2160, 30000000, 60)],
    '480p 500kbps': [R(480, 500000)],
  },
};

describe('qualityOptions', () => {
  it('offers Auto plus the ABR master\'s renditions, heaviest first', () => {
    const options = qualityOptions(LADDER, 'llhls');
    expect(options.map(o => o.id)).toEqual(['auto', 'auto@2160', 'auto@1080', 'auto@720', 'auto@480']);
    expect(options.every(o => o.quality === 'auto')).toBe(true);
  });

  it('lists the concrete playlists that serve WebRTC when the master withholds it', () => {
    const bframes: StreamSpec = {
      ...LADDER,
      streams: { ...LADDER.streams, auto: { llhls: 'auto-llhls' }, full: { llhls: 'full-llhls' } },
    };
    expect(qualityOptions(bframes, 'webrtc-udp').map(o => o.id)).toEqual(['480p 500kbps']);
    // Not wanting WebRTC, the master is fine again.
    expect(qualityOptions(bframes, 'llhls')[0].id).toBe('auto');
  });

  it('lists concrete playlists without an ABR master, by name when renditions are unknown', () => {
    const options = qualityOptions({ name: 'x', streams: Q(['480p', 'full', '720p']) }, 'llhls');
    expect(options.map(o => o.id)).toEqual(['full', '720p', '480p']);
    expect(options.some(o => o.auto)).toBe(false);
  });

  it('offers everything when nothing serves WebRTC', () => {
    expect(qualityOptions({ name: 'x', streams: Q(['full']) }, 'webrtc-udp').map(o => o.id)).toEqual(['full']);
  });
});

describe('pickOption', () => {
  const options = qualityOptions(LADDER, 'llhls');
  it('auto picks Auto', () => expect(pickOption(options, 'auto')?.id).toBe('auto'));
  it('an exact bitrate picks that rendition', () => expect(pickOption(options, 2500000)?.id).toBe('auto@720'));
  it('closeness is by ratio, not difference', () => {
    // 4 Mbps: 6M is 1.5x away, 2.5M is 1.6x away.
    expect(pickOption(options, 4000000)?.id).toBe('auto@1080');
  });
  it('clamps beyond either end of the ladder', () => {
    expect(pickOption(options, 100000000)?.id).toBe('auto@2160');
    expect(pickOption(options, 100000)?.id).toBe('auto@480');
  });
  it('auto without an ABR master picks the heaviest', () => {
    expect(pickOption(qualityOptions({ name: 'x', streams: Q(['480p', 'full']) }, 'llhls'), 'auto')?.id).toBe('full');
  });
  it('a bitrate without known renditions falls back to the heaviest', () => {
    expect(pickOption(qualityOptions({ name: 'x', streams: Q(['480p', 'full']) }, 'llhls'), 500000)?.id).toBe('full');
  });
});

describe('matchQualityLevel', () => {
  // WebRTC lists renditions in OME's playlist order, HLS by bandwidth.
  const webrtcLevels = [
    { index: 0, height: 1080, bitrate: 6000000 },
    { index: 1, height: 480, bitrate: 500000 },
    { index: 2, height: 720, bitrate: 2500000 },
    { index: 3, height: 2160, bitrate: 31641136 },
  ];
  it('matches by height regardless of level order', () => {
    expect(matchQualityLevel(R(720, 2500000), webrtcLevels)).toBe(2);
    expect(matchQualityLevel(R(2160, 30000000), webrtcLevels)).toBe(3);
  });
  it('picks the closest bitrate among same-height twins', () => {
    const twins = [{ index: 0, height: 1080, bitrate: 6160000 }, { index: 1, height: 1080, bitrate: 12000000 }];
    expect(matchQualityLevel(R(1080, 6000000), twins)).toBe(0);
  });
  it('falls back to the closest bitrate when the height is gone', () => {
    expect(matchQualityLevel(R(900, 2000000), webrtcLevels)).toBe(2);
  });
  it('is -1 without levels', () => expect(matchQualityLevel(R(720, 2500000), [])).toBe(-1));
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

  it('degrades to the only configured tier regardless of the preference', () => {
    // Q() only offers llhls — used as the no-hls fallback path.
    const sel = resolveIdleSelection(idle(Q(['full'])), 500000);
    expect(sel).toMatchObject({ key: 'idle', quality: 'full', protocol: 'llhls' });
  });

  it('resolves the preference to the closest tier like a real stream', () => {
    const spec: StreamSpec = {
      ...idle(idleQ(['full', '720p', '480p'])),
      renditions: { full: [R(1080, 10000000)], '720p': [R(720, 3000000)], '480p': [R(480, 600000)] },
    };
    expect(resolveIdleSelection(spec, 500000)).toMatchObject({ quality: '480p', protocol: 'hls' });
    expect(resolveIdleSelection(spec, 2500000)).toMatchObject({ quality: '720p' });
    expect(resolveIdleSelection(spec, 'auto')).toMatchObject({ quality: 'full' });
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

describe('quality preference', () => {
  const option = (sm: StreamManager, id: string): QualityOption =>
    sm.getSelectedStream()!.options.find(o => o.id === id)!;

  it('a picked rendition locks on the ABR master and stores its bitrate', () => {
    const sm = setup({ 'bam/rem': LADDER });
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()?.option.id).toBe('auto');

    sm.requestQualityChange(option(sm, 'auto@720'));
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'llhls', option: { id: 'auto@720' } });
    expect(sm.qualityPreference).toBe(2500000);
    expect(localStorage.getItem('qualityPreference')).toBe('2500000');

    sm.requestQualityChange(option(sm, 'auto'));
    expect(sm.qualityPreference).toBe('auto');
    expect(localStorage.getItem('qualityPreference')).toBe('auto');
  });

  it('a new stream picks the closest option without storing it', () => {
    localStorage.setItem('qualityPreference', '4000000');
    const sm = setup({
      'bam/rem': LADDER,
      'bam/other': { name: 'other', streams: { auto: { llhls: 'o' } }, renditions: { auto: [R(1440, 9000000), R(360, 300000)] } },
    });
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()?.option.id).toBe('auto@1080');
    sm.requestStreamSelection({ key: 'bam/other', protocol: 'llhls' });
    expect(sm.getSelectedStream()?.option.id).toBe('auto@1440');
    expect(localStorage.getItem('qualityPreference')).toBe('4000000');
  });

  it('keeps the chosen option across polls even when its measured bitrate drifts', () => {
    const sm = setup({ 'bam/rem': LADDER });
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    sm.requestQualityChange(option(sm, 'auto@2160'));

    sm.availableStreams = { 'bam/rem': { ...LADDER, renditions: { ...LADDER.renditions, auto: [R(2160, 7000000), ...LADDER.renditions!.auto.slice(1)] } } };
    sm.reconcileSelection();
    expect(sm.getSelectedStream()?.option.id).toBe('auto@2160');
  });

  it('switches concrete playlists when there is no ABR master', () => {
    const sm = setup(); // bam/rem offers full + 480p (no adaptive)
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full' });
    sm.requestQualityChange(option(sm, '480p'));
    expect(sm.getSelectedStream()).toMatchObject({ quality: '480p', protocol: 'llhls' });
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
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    sm.requestProtocolChange('hls');
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'full', protocol: 'hls' });
  });

  it('falls back to the default protocol when the requested one is unavailable for the quality', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    sm.requestProtocolChange('webrtc-tcp'); // "full" has no webrtc-tcp
    expect(sm.getSelectedStream()).toMatchObject({ protocol: 'webrtc-udp' });
  });
});

describe('sticky ended stream + auto-resume', () => {
  it('moves a vanished playing stream to endedSelection and stops playing', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });

    sm.availableStreams = {}; // the stream dropped off the list
    sm.reconcileSelection();

    expect(sm.getSelectedStream()).toBeNull();
    expect(sm.getEndedSelection()).toMatchObject({ key: 'bam/rem', quality: 'full', protocol: 'llhls' });
  });

  it('auto-resumes with the same quality/protocol when the stream reappears', () => {
    const sm = setup();
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'hls' });
    sm.requestQualityChange(sm.getSelectedStream()!.options.find(o => o.id === '480p')!);
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
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
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
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
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

    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
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

  it('with LLHLS stays on the ABR master even when auto withholds WebRTC', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'llhls' });
  });

  it('falls back to a concrete playlist that still offers WebRTC', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'webrtc-udp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: '1080p', protocol: 'webrtc-udp' });
  });

  it('returns to ABR+WebRTC once the source stops sending B-frames', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'webrtc-udp' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: '1080p', protocol: 'webrtc-udp' });

    sm.availableStreams = NO_BFRAMES;
    sm.reconcileSelection();
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'webrtc-udp' });
  });

  it('a protocol change to WebRTC while on ABR picks a concrete WebRTC playlist', () => {
    const sm = setup(BFRAMES);
    sm.requestStreamSelection({ key: 'bam/rem', protocol: 'llhls' });
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'llhls' });
    sm.requestProtocolChange('webrtc-tcp');
    expect(sm.getSelectedStream()).toMatchObject({ quality: '1080p', protocol: 'webrtc-tcp' });

    sm.availableStreams = NO_BFRAMES;
    sm.reconcileSelection();
    expect(sm.getSelectedStream()).toMatchObject({ quality: 'auto', protocol: 'webrtc-udp' });
  });
});
