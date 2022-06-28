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
export type SelectedStreamListener = (selection: StreamSelection|null) => void;

export class StreamManager {
    scheduledUpdate: NodeJS.Timeout|null = null;
    refreshTimestamp: number = 0;
    availableStreams: StreamMap = {};
    selectedStream: StreamSelection = null;
    availableStreamListener: AvailableStreamListener = (update) => {};
    selectedStreamListener: SelectedStreamListener = (selection) => {};
    private _autoStart: boolean = localStorage.getItem('autoStart') === '1';
  
    constructor() {
        this.startUpdates();
    }
  
    private updateStreamsOnce() {
        return getStreams().then(streams => {
            this.refreshTimestamp = Date.now();
            this.availableStreams = streams;
            this.availableStreamListener({streamMap: streams, refreshTimestamp: this.refreshTimestamp});
            this.checkAutoStart();
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
        console.log("Requested stream", request);
        console.log("Available streams", this.availableStreams);
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
        console.log("Assigned stream", this.selectedStream);
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
    }
  }
