import { getStreams, SessionExpiredError, startAuthentication, StreamMap, StreamProtocol, StreamQuality, StreamQualityMap, StreamSpec } from "./BamApi";

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

export function resolveQualityTier(streams: StreamQualityMap, tier: QualityTier): StreamQuality {
    const names = Object.keys(streams);
    const adaptive = names.find(n => ADAPTIVE_QUALITY_NAMES.includes(n));
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
                    const quality = resolveQualityTier(streamDef.streams, this._qualityTier);
                    const preferred = readProtocolPreference();
                    const protocol = preferred in streamDef.streams[quality] ? preferred : DEFAULT_PROTOCOL;
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

        if (protocol === null || !(protocol in this.selectedStream.stream.streams[this.selectedStream.quality])) {
            protocol = DEFAULT_PROTOCOL;
        }

        this.selectedStream = {key: this.selectedStream.key, stream: this.selectedStream.stream, quality: this.selectedStream.quality, protocol};
        this.notify();
    }

    private resolveSelection(request: StreamSelectionRequest): StreamSelection {
        if (request.key === null || !(request.key in this.availableStreams)) {
            return null;
        }
        const stream = this.availableStreams[request.key];
        // Cards no longer pick a quality; an explicit request quality is still
        // honoured (e.g. resuming an ended stream), otherwise the global tier
        // resolves against whatever this stream offers.
        const quality: StreamQuality = (request.quality !== null && request.quality in stream.streams)
            ? request.quality
            : resolveQualityTier(stream.streams, this._qualityTier);
        if (quality === undefined || !(quality in stream.streams)) {
            return null;
        }
        const protocol: StreamProtocol = (request.protocol !== null && request.protocol in stream.streams[quality])
            ? request.protocol : DEFAULT_PROTOCOL;
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
            const refreshed = this.resolveSelection({
                key: prev.key,
                quality: prev.quality,
                protocol: prev.protocol,
            });
            // resolveSelection can return null if the quality vanished mid-flight;
            // fall back to tier resolution rather than dropping the selection.
            this.selectedStream = refreshed ?? this.resolveSelection({
                key: prev.key,
                quality: null,
                protocol: prev.protocol,
            });
        } else if (this.endedSelection !== null && this.endedSelection.key in this.availableStreams) {
            this.selectedStream = this.resolveSelection({
                key: this.endedSelection.key,
                quality: this.endedSelection.quality,
                protocol: this.endedSelection.protocol,
            });
            this.endedSelection = null;
        }
    }

    requestStreamSelection(request: StreamSelectionRequest) {
        // An explicit selection (including deselect) supersedes any sticky "ended" intent.
        this.endedSelection = null;
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
        // Re-resolve the current stream to the new tier (like a protocol change).
        if (this.selectedStream !== null) {
            this.selectedStream = this.resolveSelection({
                key: this.selectedStream.key,
                quality: null,
                protocol: this.selectedStream.protocol,
            });
        }
        this.notify();
    }
  }
