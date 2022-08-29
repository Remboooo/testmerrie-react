import { useSnackbar } from "notistack";
import { getStreams, StreamMap, StreamProtocol, StreamSpec } from "./BamApi";

const UPDATE_INTERVAL = 5000;
const DEFAULT_PROTOCOL = "webrtc-udp";

export type StreamSelectionRequest = {
    key: string|null,
    protocol: StreamProtocol|null, 
};

export const NO_SELECTION: StreamSelectionRequest = {key: null, protocol: null};

export type StreamSelection = {
    key: string,
    stream: StreamSpec,
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
  
    constructor() {
        this.startUpdates();
    }
  
    private updateStreamsOnce() {
        return getStreams().then(streams => {
            this.refreshTimestamp = Date.now();
            this.availableStreams = streams;
            this.availableStreamListener({streamMap: streams, refreshTimestamp: this.refreshTimestamp});
            this.checkAutoStart();
        }).catch(reason => {
            console.log("failed to get streams", reason);
            // TODO remove me testing
            this.availableStreams = {"test": {name: "test", streams: {main: {protocols: {}}}, created: "2022-08-07T01:02:03Z", video: {width: 1, height: 2, framerate: 3, codec: "aids", bitrate: 3}, audio: {channels: 1, codec: "aids", bitrate: 2, samplerate: 3}}}
            this.availableStreamListener({streamMap: this.availableStreams, refreshTimestamp: this.refreshTimestamp});
        });
    }

    checkAutoStart() {
        if (this._autoStart) {
            const streamEntries = Object.entries(this.availableStreams);
            if (this.selectedStream === null && streamEntries.length > 0) {
                this.selectedStream = {key: streamEntries[0][0], stream: streamEntries[0][1], protocol: DEFAULT_PROTOCOL};
                this.selectedStreamListener(this.selectedStream);
            }
        }
    }
  
    startUpdates() {
        if (!this.scheduledUpdate) {
            this.scheduledUpdate = setInterval(() => this.updateStreamsOnce(), UPDATE_INTERVAL);
            this.updateStreamsOnce();
        }
    }
  
    stopUpdates() {
        if (this.scheduledUpdate) {
            clearInterval(this.scheduledUpdate);
        }
    }

    updateNow() {
        if (this.scheduledUpdate) {
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

    requestStreamSelection(request: StreamSelectionRequest) {
        if (request.key === null || !(request.key in this.availableStreams)) {
            this.selectedStream = null;
        } else {
            const stream = this.availableStreams[request.key];
            var protocol: StreamProtocol;
            if (request.protocol !== null && request.protocol in stream.streams.main.protocols) {
                protocol = request.protocol;
            } else {
                protocol = DEFAULT_PROTOCOL;
            }
            this.selectedStream = {key: request.key, stream: stream, protocol: protocol};
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
