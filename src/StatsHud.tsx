import { MutableRefObject, ReactNode, useEffect, useRef, useState } from 'react';
import { OvenPlayerQualityLevel, OvenPlayerState } from './OvenPlayer';
import { QualityTier, StreamSelection } from './StreamManager';
import { formatBitrate } from './FormatUtil';
import './StatsHud.css';

const TIER_LABELS: Record<QualityTier, string> = {
    auto: "Auto",
    best: "Beste",
    balanced: "Gebalanceerd",
    saver: "Databesparing",
};

const STATE_LABELS: Partial<Record<OvenPlayerState, string>> = {
    idle: "inactief",
    loading: "laden…",
    playing: "speelt",
    paused: "gepauzeerd",
    stalled: "hapert",
    error: "fout",
    complete: "klaar",
};

export type BufferInfo = { buffer: number; position: number };

export type StatsHudProps = {
    playerState: OvenPlayerState;
    selection: StreamSelection;
    qualityTier: QualityTier;
    liveQualityRef: MutableRefObject<OvenPlayerQualityLevel | null>;
    bufferRef: MutableRefObject<BufferInfo | null>;
    hlsRef: MutableRefObject<any>;
    pcRef: MutableRefObject<RTCPeerConnection | null>;
};

type WebrtcLive = { width?: number; height?: number; bitrate?: number; fps?: number };

function Row({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="stats-row">
            <span className="stats-label">{label}</span>
            <span className="stats-value">{value ?? "—"}</span>
        </div>
    );
}

// Read-only telemetry overlay. Source ("Bron") comes from the middleware's
// stream metadata; the live column ("Nu") reflects what the player is actually
// doing. The live numbers are held in refs and polled here at 1 Hz so frequent
// buffer/bandwidth updates don't re-render the whole App.
export default function StatsHud({ playerState, selection, qualityTier, liveQualityRef, bufferRef, hlsRef, pcRef }: StatsHudProps) {
    const [, setTick] = useState(0);
    const webrtcLiveRef = useRef<WebrtcLive | null>(null);
    const prevRef = useRef<{ bytes: number; ts: number } | null>(null);
    useEffect(() => {
        const id = setInterval(() => {
            const pc = pcRef.current;
            if (pc) {
                // WebRTC has no bandwidth-estimate accessor, but we can measure the
                // real inbound video stream: bitrate from the bytesReceived delta,
                // plus fps/resolution straight off the inbound-rtp report.
                pc.getStats().then((report) => {
                    let vid: any;
                    report.forEach((s: any) => {
                        if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) vid = s;
                    });
                    if (vid) {
                        const now = { bytes: vid.bytesReceived ?? 0, ts: vid.timestamp };
                        const prev = prevRef.current;
                        const bitrate = (prev && now.ts > prev.ts)
                            ? (now.bytes - prev.bytes) * 8 / ((now.ts - prev.ts) / 1000)
                            : undefined;
                        prevRef.current = now;
                        webrtcLiveRef.current = { width: vid.frameWidth, height: vid.frameHeight, fps: vid.framesPerSecond, bitrate };
                    }
                }).catch(() => {});
            } else {
                prevRef.current = null;
                webrtcLiveRef.current = null;
            }
            setTick(t => t + 1);
        }, 1000);
        return () => clearInterval(id);
    }, [pcRef]);

    const video = selection?.stream.video;
    const audio = selection?.stream.audio;
    const buf = bufferRef.current;
    const bufferSec = buf ? Math.max(0, buf.buffer - buf.position) : null;
    const bandwidth = hlsRef.current?.bandwidthEstimate as number | undefined;

    // Live "Nu" rendition: measured from WebRTC getStats, or the nominal hls level.
    const isWebrtc = !!selection?.protocol && selection.protocol.startsWith("webrtc");
    const wrtc = webrtcLiveRef.current;
    const hlsLevel = liveQualityRef.current;
    const liveW = isWebrtc ? wrtc?.width : hlsLevel?.width;
    const liveH = isWebrtc ? wrtc?.height : hlsLevel?.height;
    const liveBitrate = isWebrtc ? wrtc?.bitrate : (hlsLevel ? Number(hlsLevel.bitrate) : undefined);
    const liveFps = isWebrtc ? wrtc?.fps : undefined;
    const renditionStr = (liveW && liveH)
        ? `${liveW}×${liveH}${liveBitrate ? ` · ${formatBitrate(liveBitrate)}` : ""}`
        : null;

    return (
        <div className="stats-hud">
            <div className="stats-col">
                <div className="stats-heading">Bron</div>
                <Row label="Resolutie" value={video ? `${video.width}×${video.height}` : null} />
                <Row label="FPS" value={video?.framerate ? Math.round(video.framerate * 100) / 100 : null} />
                <Row label="Video" value={video ? `${video.codec} · ${formatBitrate(Number(video.bitrate))}` : null} />
                <Row label="Audio" value={audio ? `${audio.codec}${audio.channels ? ` · ${audio.channels}ch` : ""}${audio.samplerate ? ` · ${Math.round(audio.samplerate / 1000)}kHz` : ""} · ${formatBitrate(Number(audio.bitrate))}` : null} />
            </div>
            <div className="stats-col">
                <div className="stats-heading">Nu</div>
                <Row label="Status" value={STATE_LABELS[playerState] ?? playerState} />
                <Row label="Protocol" value={selection?.protocol} />
                <Row label="Kwaliteit" value={`${TIER_LABELS[qualityTier]} → ${selection?.quality ?? "—"}`} />
                <Row label="Rendition (live)" value={renditionStr} />
                {liveFps != null && <Row label="FPS (live)" value={Math.round(liveFps)} />}
                <Row label="Buffer" value={bufferSec !== null ? `${bufferSec.toFixed(1)} s` : null} />
                <Row label="Verbinding (schatting)" value={bandwidth ? formatBitrate(bandwidth) : null} />
            </div>
        </div>
    );
}
