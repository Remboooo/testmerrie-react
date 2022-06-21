const API_BASE = "https://bam.bad-bit.net/api/v1"

export type VideoStreamParams = {
    width: number,
    height: number,
    codec: string,
    framerate: number,
    bitrate: number,
};

export type AudioStreamParams = {
    channels: number,
    codec: string,
    bitrate: number,
    samplerate: number,
};

export type StreamProtocolUrlMap = {
    "llhls"?: string,
    "webrtc-udp"?: string,
    "webrtc-tcp"?: string,
}

export type StreamProtocol = keyof StreamProtocolUrlMap;

export type StreamQualityMap = {
    main: StreamProtocolUrlMap,
}

export type StreamSpec = {
    name: string,
    streams: {
        main: {
            protocols: StreamProtocolUrlMap
        }
    },
    created: string,
    video: VideoStreamParams,
    audio: AudioStreamParams,
    thumbnail?: string,
};

export type StreamMap = {
    [key: string]: StreamSpec
};

export type StreamResponse = {
    streams: StreamMap,
};

export async function getStreams(): Promise<StreamMap> {
    try {
        return (await fetch(API_BASE + "/streams")).json().then(j => j.streams);
    } catch (error) {
        console.log(error);
        return {};
    }
}