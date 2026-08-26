import { MutableRefObject, ReactNode, useEffect, useRef, useState } from 'react';
import { OvenPlayerQualityLevel, OvenPlayerState } from './OvenPlayer';
import { ADAPTIVE_QUALITY_NAMES, QualityTier, StreamSelection } from './StreamManager';
import { formatBitrate } from './FormatUtil';
import { WebglSupport } from './webgl/useWebglSupport';
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
    effectsEnabled: boolean;
    webglEnabled: boolean;
    webglSupport: WebglSupport;
    effectiveRenderer: 'webgl' | 'svg';
};

// Why the renderer ended up where it did, not just what it is — useful for
// spotting "user wanted WebGL but it silently fell back" at a glance.
function rendererLabel(effectsEnabled: boolean, webglEnabled: boolean, webglSupport: WebglSupport, effectiveRenderer: 'webgl' | 'svg'): string {
    if (!effectsEnabled) return 'Uit';
    if (effectiveRenderer === 'webgl') return 'WebGL';
    if (!webglEnabled) return 'SVG (uitgeschakeld)';
    if (webglSupport === 'unavailable') return 'SVG (WebGL niet ondersteund)';
    if (webglSupport === 'checking') return 'SVG (WebGL wordt gecontroleerd…)';
    return 'SVG (WebGL-context verloren)';
}

type WebrtcLive = { width?: number; height?: number; bitrate?: number; fps?: number; avail?: number };

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
export default function StatsHud({ playerState, selection, qualityTier, liveQualityRef, bufferRef, hlsRef, pcRef, effectsEnabled, webglEnabled, webglSupport, effectiveRenderer }: StatsHudProps) {
    const [, setTick] = useState(0);
    const webrtcLiveRef = useRef<WebrtcLive | null>(null);
    const prevRef = useRef<{ bytes: number; ts: number; bitrate?: number } | null>(null);
    useEffect(() => {
        const id = setInterval(() => {
            const pc = pcRef.current;
            // The <video> element always knows its painted resolution — Firefox in
            // particular often omits frameWidth/frameHeight from inbound-rtp stats.
            const vidEl = document.querySelector<HTMLVideoElement>(".ovenplayer video");
            if (pc) {
                // WebRTC has no bandwidth-estimate accessor, but we can measure the
                // real inbound video stream: bitrate from the bytesReceived delta,
                // plus fps off the inbound-rtp report.
                pc.getStats().then((report) => {
                    let vid: any, pair: any;
                    report.forEach((s: any) => {
                        if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) vid = s;
                        // The selected ICE candidate pair carries the receiver's
                        // available-bandwidth estimate (when the browser reports it).
                        if (s.type === "candidate-pair" && (s.nominated || s.selected || s.state === "succeeded")) pair = s;
                    });
                    const prev = prevRef.current;
                    let bitrate = prev?.bitrate;
                    if (vid) {
                        const bytes = vid.bytesReceived ?? 0;
                        const ts = vid.timestamp as number;
                        if (prev && ts > prev.ts) {
                            bitrate = (bytes - prev.bytes) * 8 / ((ts - prev.ts) / 1000);
                        }
                        prevRef.current = { bytes, ts, bitrate };
                    }
                    webrtcLiveRef.current = {
                        width: vid?.frameWidth || vidEl?.videoWidth || undefined,
                        height: vid?.frameHeight || vidEl?.videoHeight || undefined,
                        fps: vid?.framesPerSecond,
                        bitrate,
                        avail: pair?.availableIncomingBitrate,
                    };
                }).catch(() => {});
            } else {
                // No peer connection captured: still surface resolution from the element.
                prevRef.current = null;
                webrtcLiveRef.current = vidEl?.videoWidth
                    ? { width: vidEl.videoWidth, height: vidEl.videoHeight }
                    : null;
            }
            setTick(t => t + 1);
        }, 1000);
        return () => clearInterval(id);
    }, [pcRef]);

    const video = selection?.stream.video;
    const audio = selection?.stream.audio;
    const buf = bufferRef.current;
    const bufferSec = buf && isFinite(buf.buffer) && isFinite(buf.position)
        ? Math.max(0, buf.buffer - buf.position)
        : null;
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
    // "Kwaliteit" resolved side: for an adaptive track ("abr"/"auto") the track
    // name is uninformative, so show the live-measured height (e.g. "1080p")
    // instead; concrete/named renditions (720p, full) keep their own label.
    const isAdaptiveTrack = !!selection && ADAPTIVE_QUALITY_NAMES.includes(String(selection.quality));
    const qualityResolved = (isAdaptiveTrack && liveH) ? `${liveH}p` : selection?.quality;
    // hls.js exposes a throughput estimate; WebRTC's (when present) rides on the
    // selected ICE candidate pair.
    const bandwidthEstimate = isWebrtc ? wrtc?.avail : bandwidth;

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
                <Row label="Weergave" value={rendererLabel(effectsEnabled, webglEnabled, webglSupport, effectiveRenderer)} />
                <Row label="Protocol" value={selection?.protocol} />
                <Row label="Kwaliteit" value={`${TIER_LABELS[qualityTier]} → ${qualityResolved ?? "—"}`} />
                <Row label="Rendition" value={renditionStr} />
                {liveFps != null && <Row label="FPS" value={Math.round(liveFps)} />}
                {bufferSec != null && <Row label="Buffer" value={`${bufferSec.toFixed(1)} s`} />}
                {bandwidthEstimate != null && <Row label="Verbinding (schatting)" value={formatBitrate(bandwidthEstimate)} />}
            </div>
        </div>
    );
}
