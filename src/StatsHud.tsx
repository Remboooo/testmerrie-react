import { MutableRefObject, ReactNode, useEffect, useState } from 'react';
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
};

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
export default function StatsHud({ playerState, selection, qualityTier, liveQualityRef, bufferRef, hlsRef }: StatsHudProps) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const video = selection?.stream.video;
    const audio = selection?.stream.audio;
    const live = liveQualityRef.current;
    const buf = bufferRef.current;
    const bufferSec = buf ? Math.max(0, buf.buffer - buf.position) : null;
    const bandwidth = hlsRef.current?.bandwidthEstimate as number | undefined;

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
                <Row label="Rendition" value={live ? `${live.width}×${live.height} · ${formatBitrate(Number(live.bitrate))}` : null} />
                <Row label="Buffer" value={bufferSec !== null ? `${bufferSec.toFixed(1)} s` : null} />
                <Row label="Verbinding (schatting)" value={bandwidth ? formatBitrate(bandwidth) : null} />
            </div>
        </div>
    );
}
