import { getStreams, Rendition, SessionExpiredError, startAuthentication, StreamMap, StreamProtocol, StreamProtocolUrlMap, StreamQuality, StreamQualityMap, StreamSpec } from "./BamApi";

const UPDATE_INTERVAL = 5000;
const DEFAULT_PROTOCOL = "webrtc-udp";
// The viewer's quality intent: let ABR decide, always the heaviest rendition
// (normally the passthrough), or the bitrate (bps) of the rendition they last
// picked. Streams offer different ladders, so a bitrate resolves to whichever
// offered rendition is closest.
export type QualityPreference = "auto" | "max" | number;
export const DEFAULT_QUALITY_PREFERENCE: QualityPreference = "auto";

// One choice in the quality dropdown: the playlist to load plus, on an ABR
// master, the rendition to lock in-player (auto: let ABR decide). On concrete
// playlists (no ABR master, idle, B-frame WebRTC fallback) each option is its
// own playlist and switching swaps the URL.
export type QualityOption = {
    id: string,
    quality: StreamQuality,
    auto: boolean,
    // The heaviest fixed option; picking it means "max", not its bitrate.
    max: boolean,
    rendition?: Rendition,
};

export type StreamSelectionRequest = {
    key: string|null,
    protocol: StreamProtocol|null,
};

export const NO_SELECTION: StreamSelectionRequest = {key: null, protocol: null};

export type StreamSelection = {
    key: string,
    stream: StreamSpec,
    quality: StreamQuality,
    protocol: StreamProtocol,
    option: QualityOption,
    options: QualityOption[],
} | null;

export type AvailableStreamUpdate = {
    streamMap: StreamMap,
    idleStream: StreamSpec | undefined,
    refreshTimestamp: number,
};

export type AvailableStreamListener = (update: AvailableStreamUpdate) => void;
export type SelectedStreamListener = (selection: StreamSelection) => void;

export const ADAPTIVE_QUALITY_NAMES = ["abr", "auto"];
const SOURCE_QUALITY_NAMES = ["full", "source", "original"];

// Fallback ordering for playlists without rendition metadata (older API):
// resolution parsed from the name, source/full on top.
function qualityRank(name: string): number {
    if (SOURCE_QUALITY_NAMES.includes(name)) return Infinity;
    const match = name.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export function findAdaptiveQuality(streams: StreamQualityMap): StreamQuality | undefined {
    return Object.keys(streams).find(n => ADAPTIVE_QUALITY_NAMES.includes(n));
}

function offersWebRtc(urls: StreamProtocolUrlMap): boolean {
    return ("webrtc-udp" in urls) || ("webrtc-tcp" in urls);
}

function heaviestFirst(a: QualityOption, b: QualityOption): number {
    if (a.rendition?.bitrate && b.rendition?.bitrate) {
        return b.rendition.bitrate - a.rendition.bitrate;
    }
    return qualityRank(String(b.quality)) - qualityRank(String(a.quality));
}

// What the quality dropdown offers for this stream over this protocol. Stays on
// the ABR master whenever it can serve the protocol, so switching locks a level
// in-player without a remount; otherwise (no master, or WebRTC withheld from it
// for B-frames) lists the concrete playlists that can.
export function qualityOptions(stream: StreamSpec, protocol: StreamProtocol|null): QualityOption[] {
    const streams = stream.streams;
    const renditions = stream.renditions ?? {};
    const adaptive = findAdaptiveQuality(streams);
    const wantsWebRtc = !!protocol?.startsWith("webrtc");
    if (adaptive !== undefined && (!wantsWebRtc || offersWebRtc(streams[adaptive]))) {
        const locks: QualityOption[] = (renditions[adaptive] ?? []).map(rendition => ({
            id: `${adaptive}@${rendition.height}`, quality: adaptive, auto: false, max: false, rendition,
        }));
        return [{id: "auto", quality: adaptive, auto: true, max: false}, ...markMax(locks.sort(heaviestFirst))];
    }
    const concrete = Object.keys(streams).filter(name => !ADAPTIVE_QUALITY_NAMES.includes(name));
    const playable = wantsWebRtc ? concrete.filter(name => offersWebRtc(streams[name])) : concrete;
    if (playable.length === 0) {
        // Nothing serves WebRTC at all: offer everything; pickProtocol falls back.
        return protocol === null ? [] : qualityOptions(stream, null);
    }
    return markMax(playable
        .map(name => ({id: name, quality: name, auto: false, max: false, rendition: renditions[name]?.[0]}))
        .sort(heaviestFirst));
}

function markMax(heaviestFirst: QualityOption[]): QualityOption[] {
    return heaviestFirst.map((option, i) => i === 0 ? {...option, max: true} : option);
}

// The option closest to the preference. Closeness is by bitrate ratio, not
// difference (4 Mbps is nearer 6 than 2.5). "max" is always the heaviest, as
// are "auto" without an ABR master and options without known bitrates.
export function pickOption(options: QualityOption[], preference: QualityPreference): QualityOption | undefined {
    const auto = options.find(o => o.auto);
    const fixed = options.filter(o => !o.auto);
    if (preference === "max") {
        return fixed[0] ?? auto;
    }
    if (preference === "auto") {
        return auto ?? fixed[0];
    }
    const measured = fixed.filter(o => (o.rendition?.bitrate ?? 0) > 0);
    if (measured.length === 0) {
        return auto ?? fixed[0];
    }
    const distance = (o: QualityOption) => Math.abs(Math.log(o.rendition!.bitrate / preference));
    return measured.reduce((best, o) => distance(o) < distance(best) ? o : best);
}

// Which of the player's levels (HLS variants / WebRTC renditions, each in its
// own order) plays the chosen rendition: same height, closest bitrate — audio
// twins (Opus vs AAC) differ slightly. -1 when nothing matches.
export type QualityLevelInfo = { index: number; height: number; bitrate?: number };

export function matchQualityLevel(rendition: Rendition, levels: QualityLevelInfo[]): number {
    const sameHeight = levels.filter(l => l.height === rendition.height);
    const candidates = sameHeight.length > 0 ? sameHeight : levels;
    if (candidates.length === 0) {
        return -1;
    }
    const distance = (l: QualityLevelInfo) => Math.abs(Math.log((l.bitrate || 1) / (rendition.bitrate || 1)));
    return candidates.reduce((best, l) => distance(l) < distance(best) ? l : best).index;
}

// The preferred protocol if this quality offers it, else the closest one that
// it does: the other WebRTC transport, then LLHLS, then HLS. A quality can lack
// WebRTC entirely (e.g. a B-frame source, see StreamSpec.webrtcUnavailable).
const PROTOCOL_FALLBACK_ORDER: StreamProtocol[] = ["webrtc-udp", "webrtc-tcp", "llhls", "hls"];

export function pickProtocol(offered: StreamProtocolUrlMap, preferred: StreamProtocol|null): StreamProtocol {
    const sameFamily: StreamProtocol[] = preferred?.startsWith("webrtc") ? ["webrtc-udp", "webrtc-tcp"] : [];
    const order = [preferred, ...sameFamily, ...PROTOCOL_FALLBACK_ORDER];
    return order.find((p): p is StreamProtocol => p !== null && p in offered)
        ?? (Object.keys(offered)[0] as StreamProtocol | undefined)
        ?? DEFAULT_PROTOCOL;
}

// The idle loop is a StreamSpec like any other, just not listed in streamMap.
// Always uses HLS (ignores the protocol selector): LLHLS drifts out of sync
// with the HLS schedule loop and isn't worth the request-volume tradeoff.
// Falls back to the first listed protocol only if HLS is missing. Undefined/
// empty streams (not configured, or not yet encoded at any tier) → null.
export function resolveIdleSelection(
    idleStream: StreamSpec | undefined,
    preference: QualityPreference,
): StreamSelection {
    if (idleStream === undefined || Object.keys(idleStream.streams).length === 0) {
        return null;
    }
    const options = qualityOptions(idleStream, "hls");
    const option = pickOption(options, preference);
    if (option === undefined) {
        return null;
    }
    const offered = idleStream.streams[option.quality];
    const protocol: StreamProtocol = ("hls" in offered)
        ? "hls"
        : Object.keys(offered)[0] as StreamProtocol;
    return { key: "idle", stream: idleStream, quality: option.quality, protocol, option, options };
}

export function readQualityPreference(): QualityPreference {
    const v = localStorage.getItem("qualityPreference");
    const bitrate = Number(v);
    if (v === "max") {
        return "max";
    }
    return (v !== null && isFinite(bitrate) && bitrate > 0) ? bitrate : DEFAULT_QUALITY_PREFERENCE;
}

// The user's persisted protocol preference (App mirrors it to localStorage under
// "protocol"). Read fresh so autostart honours the current dropdown value.
function readProtocolPreference(): StreamProtocol {
    const v = localStorage.getItem("protocol");
    return (v === "llhls" || v === "hls" || v === "webrtc-udp" || v === "webrtc-tcp") ? v : DEFAULT_PROTOCOL;
}

export class StreamManager {
    scheduledUpdate: NodeJS.Timeout|null = null;
    refreshTimestamp: number = 0;
    availableStreams: StreamMap = {};
    idleStream: StreamSpec | undefined = undefined;
    selectedStream: StreamSelection = null;
    // When the playing stream disappears from the list we keep it here (shown
    // greyed/"ended") and auto-resume it if it comes back.
    endedSelection: StreamSelection = null;
    private availableStreamUpdate: AvailableStreamUpdate = {streamMap: {}, idleStream: undefined, refreshTimestamp: 0};
    private listeners: Set<() => void> = new Set();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify() {
        this.listeners.forEach(listener => listener());
    }

    getAvailableStreams(): AvailableStreamUpdate {
        return this.availableStreamUpdate;
    }

    getSelectedStream(): StreamSelection {
        return this.selectedStream;
    }

    getEndedSelection(): StreamSelection {
        return this.endedSelection;
    }
    // Persisted intent: "auto-pick a stream for me whenever nothing is selected".
    // Playback already starts muted until a click unlocks audio (see App's
    // canPlayAudio/clickCount), the same as any manually-picked stream, so
    // there's no autoplay-restriction problem in auto-selecting on page load.
    private _autoStart: boolean = localStorage.getItem('autoStart') === '1';
    // One-shot per StreamManager instance (i.e. per page load): once autoStart
    // has picked a stream, don't keep re-forcing it back on if the user
    // manually deselects. The persisted `_autoStart` preference itself is left
    // alone, so a fresh page load auto-selects again; re-enabling the checkbox
    // by hand also re-arms it (see the setter).
    private autoStartConsumed: boolean = false;
    private _qualityPreference: QualityPreference = readQualityPreference();
    // The protocol the user asked for. The selection's protocol can differ when
    // the quality doesn't offer it; re-resolving against this (not the fallback)
    // switches back once it's offered again.
    private requestedProtocol: StreamProtocol|null = null;
    
    private updateStreamsOnce() {
        return getStreams().then(response => {
            this.refreshTimestamp = Date.now();
            this.availableStreams = response.streams;
            this.idleStream = response.idleStream;
            this.availableStreamUpdate = {
                streamMap: this.availableStreams,
                idleStream: this.idleStream,
                refreshTimestamp: this.refreshTimestamp,
            };
            this.reconcileSelection();
            this.notify();
            this.checkAutoStart();
        }).catch(reason => {
            console.log("failed to get streams", reason);
            // Session was dropped server-side (e.g. Discord refresh failed). Don't
            // overwrite the last good stream list with an error body; kick off a
            // silent Discord re-auth (prompt=none) so a still-logged-in Discord
            // user comes back without a manual click.
            if (reason instanceof SessionExpiredError) {
                this.stopUpdates();
                startAuthentication();
            }
        });
    }

    checkAutoStart() {
        if (this._autoStart && !this.autoStartConsumed) {
            const streamEntries = Object.entries(this.availableStreams);
            if (this.selectedStream === null && streamEntries.length > 0) {
                const [streamKey, streamDef] = streamEntries[0];
                if (Object.keys(streamDef.streams).length) {
                    this.requestedProtocol = readProtocolPreference();
                    this.selectedStream = this.resolveSelection({key: streamKey, protocol: this.requestedProtocol});
                    this.autoStartConsumed = true;
                    this.notify();
                }
            }
        }
    }
  
    startUpdates() {
        if (this.scheduledUpdate === null) {
            this.scheduledUpdate = setInterval(() => this.updateStreamsOnce(), UPDATE_INTERVAL);
            this.updateStreamsOnce();
        }
    }
  
    stopUpdates() {
        if (this.scheduledUpdate !== null) {
            clearInterval(this.scheduledUpdate);
            this.scheduledUpdate = null;
        }
    }

    updateNow() {
        if (this.scheduledUpdate !== null) {
            this.scheduledUpdate.refresh();
        }
        this.updateStreamsOnce();
    }

    requestProtocolChange(protocol: StreamProtocol|null) {
        if (this.selectedStream === null) {
            return;
        }

        this.requestedProtocol = protocol;
        // Re-resolve: switching onto WebRTC may need a concrete playlist when the
        // ABR master withholds it (B-frames); switching off WebRTC can return to ABR.
        this.selectedStream = this.resolveSelection({key: this.selectedStream.key, protocol});
        this.notify();
    }

    private resolveSelection(request: StreamSelectionRequest, chosen?: QualityOption): StreamSelection {
        if (request.key === null || !(request.key in this.availableStreams)) {
            return null;
        }
        const stream = this.availableStreams[request.key];
        const options = qualityOptions(stream, request.protocol);
        const option = (chosen && options.find(o => o.id === chosen.id))
            ?? pickOption(options, this._qualityPreference);
        if (option === undefined) {
            return null;
        }
        const protocol = pickProtocol(stream.streams[option.quality], request.protocol);
        return {key: request.key, stream, quality: option.quality, protocol, option, options};
    }

    // Keep the selection in sync with availability: if the playing stream vanished
    // remember it as "ended"; if a remembered ended stream reappears, resume it
    // with the same quality/protocol. Also refresh the StreamSpec (starting flag,
    // signed URLs, metadata) from the latest poll while still selected.
    reconcileSelection() {
        if (this.selectedStream !== null && !(this.selectedStream.key in this.availableStreams)) {
            this.endedSelection = this.selectedStream;
            this.selectedStream = null;
        } else if (this.selectedStream !== null) {
            const prev = this.selectedStream;
            const protocol = this.requestedProtocol ?? prev.protocol;
            // Keep the current option while it's still offered (the preference
            // could resolve elsewhere once a measured bitrate drifts); else
            // re-pick from the preference.
            this.selectedStream = this.resolveSelection({key: prev.key, protocol}, prev.option);
        } else if (this.endedSelection !== null && this.endedSelection.key in this.availableStreams) {
            this.selectedStream = this.resolveSelection({
                key: this.endedSelection.key,
                protocol: this.requestedProtocol ?? this.endedSelection.protocol,
            }, this.endedSelection.option);
            this.endedSelection = null;
        }
    }

    requestStreamSelection(request: StreamSelectionRequest) {
        // An explicit selection (including deselect) supersedes any sticky "ended" intent.
        this.endedSelection = null;
        this.requestedProtocol = request.protocol;
        this.selectedStream = this.resolveSelection(request);
        this.notify();
    }

    isStreamAvailable(key: string): boolean {
        return key in this.availableStreams;
    }

    get autoStart(): boolean {
        return this._autoStart;
    }

    set autoStart(newVal: boolean) {
        localStorage.setItem('autoStart', newVal ? '1' : '0');
        this._autoStart = newVal;
        if (newVal) {
            this.autoStartConsumed = false;
            this.checkAutoStart();
        }
        this.notify();
    }

    get qualityPreference(): QualityPreference {
        return this._qualityPreference;
    }

    // The viewer picked an option from the dropdown: play exactly that, and
    // remember it (auto, max, or its bitrate) so other streams pick their
    // closest match.
    requestQualityChange(option: QualityOption) {
        const preference: QualityPreference = option.auto ? "auto"
            : option.max ? "max"
            : (option.rendition?.bitrate || "auto");
        localStorage.setItem('qualityPreference', String(preference));
        localStorage.removeItem('qualityTier'); // superseded
        this._qualityPreference = preference;
        if (this.selectedStream !== null) {
            this.selectedStream = this.resolveSelection({
                key: this.selectedStream.key,
                protocol: this.requestedProtocol ?? this.selectedStream.protocol,
            }, option);
        }
        this.notify();
    }
  }
