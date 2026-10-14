import { getStreams, SessionExpiredError, startAuthentication, StreamMap, StreamProtocol, StreamProtocolUrlMap, StreamQuality, StreamQualityMap, StreamSpec } from "./BamApi";

const UPDATE_INTERVAL = 5000;
const DEFAULT_PROTOCOL = "webrtc-udp";
export type QualityTier = "auto" | "best" | "balanced" | "saver";
export const DEFAULT_QUALITY_TIER: QualityTier = "auto";

export type StreamSelectionRequest = {
    key: string|null,
    protocol: StreamProtocol|null, 
    quality: StreamQuality|null,
};

export const NO_SELECTION: StreamSelectionRequest = {key: null, protocol: null, quality: null};

export type StreamSelection = {
    key: string,
    stream: StreamSpec,
    quality: StreamQuality,
    protocol: StreamProtocol, 
} | null;

export type AvailableStreamUpdate = {
    streamMap: StreamMap,
    idleStream: StreamSpec | undefined,
    refreshTimestamp: number,
};

export type AvailableStreamListener = (update: AvailableStreamUpdate) => void;
export type SelectedStreamListener = (selection: StreamSelection) => void;

// Quality rendition names are dynamic and owned by the backend; a tier expresses
// the user's stable intent and resolves to whatever a given stream actually offers.
export const ADAPTIVE_QUALITY_NAMES = ["abr", "auto"];
const SOURCE_QUALITY_NAMES = ["full", "source", "original"];

function qualityRank(name: string): number {
    if (SOURCE_QUALITY_NAMES.includes(name)) return Infinity;
    const match = name.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export function findAdaptiveQuality(streams: StreamQualityMap): StreamQuality | undefined {
    return Object.keys(streams).find(n => ADAPTIVE_QUALITY_NAMES.includes(n));
}

// Maps a tier to a concrete playlist name when there is no ABR master (idle
// filler, or live streams that only advertise fixed ladders). Prefer
// adaptive for tier "auto" when present.
export function resolveQualityTier(streams: StreamQualityMap, tier: QualityTier): StreamQuality {
    const names = Object.keys(streams);
    const adaptive = findAdaptiveQuality(streams);
    const concrete = names
        .filter(n => !ADAPTIVE_QUALITY_NAMES.includes(n))
        .sort((a, b) => qualityRank(b) - qualityRank(a)); // heaviest first
    switch (tier) {
        case "best": return concrete[0] ?? adaptive ?? names[0];
        case "saver": return concrete[concrete.length - 1] ?? adaptive ?? names[0];
        case "balanced": return concrete.length ? concrete[Math.floor(concrete.length / 2)] : (adaptive ?? names[0]);
        case "auto":
        default: return adaptive ?? concrete[0] ?? names[0];
    }
}

function offersWebRtc(urls: StreamProtocolUrlMap): boolean {
    return ("webrtc-udp" in urls) || ("webrtc-tcp" in urls);
}

// Live playback playlist: stay on the ABR master whenever possible so quality
// tiers can lock levels in-player without remounting. Fall back to concrete
// playlists when the user wants WebRTC but the adaptive playlist withholds it
// (B-frame Bypass — see StreamSpec.webrtcUnavailable).
export function resolvePlaylistQuality(
    streams: StreamQualityMap,
    tier: QualityTier,
    preferredProtocol: StreamProtocol | null = null,
    requestedQuality: StreamQuality | null = null,
): StreamQuality {
    const adaptive = findAdaptiveQuality(streams);
    if (adaptive) {
        const wantsWebRtc = !!preferredProtocol?.startsWith("webrtc");
        if (!wantsWebRtc || offersWebRtc(streams[adaptive])) {
            return adaptive;
        }
        // Adaptive can't do WebRTC — pick among concrete playlists that can,
        // so B-frame sources still get a WebRTC URL (fixed ladder, remount).
        if (requestedQuality !== null
            && requestedQuality in streams
            && !ADAPTIVE_QUALITY_NAMES.includes(String(requestedQuality))
            && offersWebRtc(streams[requestedQuality])) {
            return requestedQuality;
        }
        const webrtcConcrete: StreamQualityMap = Object.fromEntries(
            Object.entries(streams).filter(([name, urls]) =>
                !ADAPTIVE_QUALITY_NAMES.includes(name) && offersWebRtc(urls),
            ),
        );
        if (Object.keys(webrtcConcrete).length > 0) {
            return resolveQualityTier(webrtcConcrete, tier);
        }
    }
    if (requestedQuality !== null && requestedQuality in streams) {
        return requestedQuality;
    }
    return resolveQualityTier(streams, tier);
}

// Match a quality tier to an OvenPlayer/hls.js level index (by height). Used to
// lock ABR without swapping playlist URLs.
export type QualityLevelInfo = { index: number; height: number; bitrate?: number };

export type QualityLock =
    | { auto: true }
    | { auto: false; index: number };

export function resolveQualityLock(tier: QualityTier, levels: QualityLevelInfo[]): QualityLock {
    if (tier === "auto" || levels.length === 0) {
        return { auto: true };
    }
    // Collapse same-height twins (e.g. Bypass vs Bypass+opus, or 1080p vs
    // 1080p+aac) to the highest-bitrate candidate so tier picks map 1:1 to
    // visible resolutions.
    const byHeight = new Map<number, QualityLevelInfo>();
    for (const level of levels) {
        const prev = byHeight.get(level.height);
        if (!prev || (level.bitrate ?? 0) > (prev.bitrate ?? 0)) {
            byHeight.set(level.height, level);
        }
    }
    const sorted = [...byHeight.values()].sort(
        (a, b) => (b.height - a.height) || ((b.bitrate ?? 0) - (a.bitrate ?? 0)),
    );
    const pick = tier === "best" ? sorted[0]
        : tier === "saver" ? sorted[sorted.length - 1]
        : sorted[Math.floor(sorted.length / 2)];
    return { auto: false, index: pick.index };
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
    tier: QualityTier,
): StreamSelection {
    if (idleStream === undefined || Object.keys(idleStream.streams).length === 0) {
        return null;
    }
    const quality = resolveQualityTier(idleStream.streams, tier);
    const offered = idleStream.streams[quality];
    const protocol: StreamProtocol = ("hls" in offered)
        ? "hls"
        : Object.keys(offered)[0] as StreamProtocol;
    return { key: "idle", stream: idleStream, quality, protocol };
}

function readQualityTier(): QualityTier {
    const v = localStorage.getItem("qualityTier");
    return (v === "auto" || v === "best" || v === "balanced" || v === "saver") ? v : DEFAULT_QUALITY_TIER;
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
    private _qualityTier: QualityTier = readQualityTier();
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
                    const quality = resolvePlaylistQuality(
                        streamDef.streams, this._qualityTier, this.requestedProtocol, null,
                    );
                    const protocol = pickProtocol(streamDef.streams[quality], this.requestedProtocol);
                    this.selectedStream = {key: streamKey, stream: streamDef, protocol, quality};
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
        this.selectedStream = this.resolveSelection({
            key: this.selectedStream.key,
            quality: null,
            protocol,
        });
        this.notify();
    }

    private resolveSelection(request: StreamSelectionRequest): StreamSelection {
        if (request.key === null || !(request.key in this.availableStreams)) {
            return null;
        }
        const stream = this.availableStreams[request.key];
        // Prefer the ABR master so tier changes lock levels in-player. Explicit
        // quality is only used when falling back to concrete playlists (no ABR,
        // or WebRTC withheld on the adaptive playlist).
        const quality = resolvePlaylistQuality(
            stream.streams, this._qualityTier, request.protocol, request.quality,
        );
        if (quality === undefined || !(quality in stream.streams)) {
            return null;
        }
        const protocol = pickProtocol(stream.streams[quality], request.protocol);
        return {key: request.key, stream, protocol, quality};
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
            const refreshed = this.resolveSelection({
                key: prev.key,
                quality: prev.quality,
                protocol,
            });
            // resolveSelection can return null if the quality vanished mid-flight;
            // fall back to tier resolution rather than dropping the selection.
            this.selectedStream = refreshed ?? this.resolveSelection({
                key: prev.key,
                quality: null,
                protocol,
            });
        } else if (this.endedSelection !== null && this.endedSelection.key in this.availableStreams) {
            this.selectedStream = this.resolveSelection({
                key: this.endedSelection.key,
                quality: this.endedSelection.quality,
                protocol: this.requestedProtocol ?? this.endedSelection.protocol,
            });
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

    get qualityTier(): QualityTier {
        return this._qualityTier;
    }

    requestQualityChange(tier: QualityTier) {
        localStorage.setItem('qualityTier', tier);
        this._qualityTier = tier;
        // Re-resolve: with an ABR master the playlist URL stays put and the
        // player locks levels from qualityTier; without ABR this still swaps
        // concrete playlist URLs as before.
        if (this.selectedStream !== null) {
            this.selectedStream = this.resolveSelection({
                key: this.selectedStream.key,
                quality: null,
                protocol: this.requestedProtocol ?? this.selectedStream.protocol,
            });
        }
        this.notify();
    }
  }
