import { useSnackbar } from "notistack";
import { getStreams, StreamMap, StreamProtocol, StreamQuality, StreamQualityMap, StreamSpec } from "./BamApi";

const UPDATE_INTERVAL = 5000;
const DEFAULT_PROTOCOL = "webrtc-udp";
const DEFAULT_QUALITY = "full";

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
    refreshTimestamp: number,
};

export type AvailableStreamListener = (update: AvailableStreamUpdate) => void;
export type SelectedStreamListener = (selection: StreamSelection) => void;

export class StreamManager {
    scheduledUpdate: NodeJS.Timeout|null = null;
    refreshTimestamp: number = 0;
    availableStreams: StreamMap = {};
    selectedStream: StreamSelection = null;
    availableStreamListener: AvailableStreamListener = (update) => {};
    selectedStreamListener: SelectedStreamListener = (selection) => {};
    // This will not work because of autoplay restrictions:
    // WebRTC.js:107 The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.
    // private _autoStart: boolean = localStorage.getItem('autoStart') === '1';
    private _autoStart: boolean = false;
    
    private updateStreamsOnce() {
        return getStreams().then(streams => {
            this.refreshTimestamp = Date.now();
            this.availableStreams = streams;
            this.availableStreamListener({streamMap: streams, refreshTimestamp: this.refreshTimestamp});
            this.checkAutoStart();
        }).catch(reason => {
            console.log("failed to get streams", reason);
        });
    }

    checkAutoStart() {
        if (this._autoStart) {
            const streamEntries = Object.entries(this.availableStreams);
            if (this.selectedStream === null && streamEntries.length > 0) {
                let streamKey = streamEntries[0][0];
                let streamDef = streamEntries[0][1];
                let availableQualities = Object.getOwnPropertyNames(streamDef.streams);
                if (availableQualities.length) {
                    let quality = Object.hasOwn(streamDef.streams, DEFAULT_QUALITY) ? DEFAULT_QUALITY : Object.getOwnPropertyNames(streamDef.streams)[0];
                    this.selectedStream = {key: streamKey, stream: streamDef, protocol: DEFAULT_PROTOCOL, quality: quality};
                    this.selectedStreamListener(this.selectedStream);
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

    setAvailableStreamListener(listener: AvailableStreamListener) {
        this.availableStreamListener = listener;
        this.availableStreamListener({streamMap: this.availableStreams, refreshTimestamp: this.refreshTimestamp});
    }

    setSelectedStreamListener(listener: SelectedStreamListener) {
        this.selectedStreamListener = listener;
        this.selectedStreamListener(this.selectedStream);
    }

    requestProtocolChange(protocol: StreamProtocol|null) {
        if (this.selectedStream === null) {
            return;
        }

        if (protocol === null || !(protocol in this.selectedStream.stream.streams[this.selectedStream.quality])) {
            protocol = DEFAULT_PROTOCOL;
        }

        this.selectedStream = {key: this.selectedStream.key, stream: this.selectedStream.stream, quality: this.selectedStream.quality, protocol};
        this.selectedStreamListener(this.selectedStream);
    }

    requestStreamSelection(request: StreamSelectionRequest) {
        if (request.key === null || !(request.key in this.availableStreams)) {
            this.selectedStream = null;
        } else {
            const stream = this.availableStreams[request.key];
            const defaultQuality = Object.keys(stream.streams)[0];
            var quality: StreamQuality;
            if (request.quality !== null && request.quality in stream.streams) {
                quality = request.quality;
            } else {
                quality = defaultQuality;
            }

            var protocol: StreamProtocol;
            if (request.protocol !== null && request.protocol in stream.streams[quality]) {
                protocol = request.protocol;
            } else {
                protocol = DEFAULT_PROTOCOL;
            }
            
            this.selectedStream = {key: request.key, stream, protocol, quality};
        }
        this.selectedStreamListener(this.selectedStream);
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
            this.checkAutoStart();
        }
    }
  }
