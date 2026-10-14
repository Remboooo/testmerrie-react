import OvenPlayer from 'ovenplayer'

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QualityLock, QualityTier, resolveQualityLock } from './StreamManager';

// message box with errors div class = op-message-box
// error text div class = op-message-text

type OvenPlayerInstance = ReturnType<typeof OvenPlayer.create>;
export type OvenPlayerConfig = Parameters<typeof OvenPlayer.create>[1];
export type OvenPlayerState = "idle"|"complete"|"paused"|"playing"|"error"|"loading"|"stalled"|"adLoaded"|"adPlaying"|"adPaused"|"adComplete";
export type OvenPlayerSize = "large"|"medium"|"small"|"xsmall";
export type OvenPlayerSourceType = 'webrtc' | 'llhls' | 'hls' | 'lldash' | 'dash' | 'mp4';
export type OvenPlayerSource = {
    type: OvenPlayerSourceType;
    file: string;
    label?: string;
    framerate?: number;
    sectionStart?: number;
    sectionEnd?: number;
}

export type OvenPlayerQualityLevel = {
    bitrate: number,
    width: number,
    height: number,
    index: number,
    label: string,
}

type OvenPlayerQualityEvent = {
    currentQuality: number, 
    type: "request"|"render", 
    isAuto: boolean
}

export type OvenPlayerProps = {
    className: string,
    playerOptions: OvenPlayerConfig,
    onReady: () => void,
    onMetaChanged: (event: {duration: number, isP2P: boolean, type: string}) => void,
    onStateChanged: (event: {prevstate: OvenPlayerState, newstate: OvenPlayerState}) => void,
    onResized: (newSize: OvenPlayerSize) => void,
    onPlaybackRateChanged: (newRate: number) => void,
    onSeek: (event: {position: number, totalDuration: number}) => void,
    onSeeked: (event: {position: number, totalDuration: number}) => void,
    onTime: (event: {duration: number, position: number}) => void,
    onBufferChanged: (event: {duration: number, position: number, buffer: number}) => void,
    onMute: (newVolumePercentage: number) => void,
    onVolumeChanged: (newVolumePercentage: number) => void,
    onPlaylistChanged: (newIndex: number) => void,
    onSourceChanged: (newIndexInSourcesArray: number) => void,
    onQualityLevelChanged: (event: {currentQuality: OvenPlayerQualityLevel, type: "request"|"render", isAuto: boolean}) => void,
    onCueChanged: (vttCue: any) => void,
    onTimeDisplayModeChanged: (changedDisplayingMode: boolean) => void,
    onAdChanged: (event: {isLinear: boolean, duration: number, skipTimeOffset: number}) => void,
    onAdTime: (event: {isLinear: boolean, duration: number, skipTimeOffset: number, remaining: number, position: number}) => void,
    onAdComplete: () => void,
    onFullscreenChanged: (isFullscreen: boolean) => void,
    onClicked: (event: React.MouseEvent<HTMLButtonElement>|{type: "adclick"}) => void,
    onAllPlaylistEnded: () => void,
    onHlsPrepared: (hlsObject: any) => void,
    onHlsDestroyed: () => void,
    onPeerConnectionPrepared: (peerConnection: RTCPeerConnection) => void,
    onPeerConnectionDestroyed: () => void,
    onDashPrepared: (dashObject: any) => void,
    onDashDestroyed: () => void,
    onDestroy: () => void,
    sources: OvenPlayerSource[],
    volume: number,
    muted: boolean,
    paused: boolean,
    reloadNonce: number,
    // When set (live ABR), tier changes call setAutoQuality/setCurrentQuality
    // in place instead of remounting on a different playlist URL. Idle/fallback
    // concrete playlists leave this undefined.
    qualityLockTier: QualityTier | null,
};

// Drive hls.js directly rather than via OvenPlayer's setCurrentQuality, which
// sets hls.currentLevel: an *immediate* switch that aborts and flushes the
// buffer (a stall on live; during startup it can leave playback stuck in
// "loading"). loadLevel only changes what the next fragment is fetched at, so
// the switch lands seamlessly once the already-buffered media has played out.
function applyHlsLock(hls: any, lock: QualityLock, starting = false) {
    const target = lock.auto ? -1 : lock.index;
    if (starting) {
        hls.startLevel = target;
    }
    if (hls.manualLevel !== target) {
        hls.loadLevel = target;
    }
}

export default function OvenPlayerComponent({
        className = "",
        playerOptions = {autoStart: true, loop: true},
        onReady = () => {},
        onMetaChanged = () => {},
        onStateChanged = (state) => {},
        onResized = (newSize) => {},
        onPlaybackRateChanged = (newRate) => {},
        onSeek = (seekTo) => {},
        onSeeked = () => {},
        onTime = (newTime) => {},
        onBufferChanged = (buffer) => {},
        onMute = (newVolumePercentage) => {},
        onVolumeChanged = (newVolumePercentage) => {},
        onPlaylistChanged = (newPlaylistIndex) => {},
        onSourceChanged = (qualityIndex) => {},
        onQualityLevelChanged = (qualityLevel) => {},
        onCueChanged = (cue) => {},
        onTimeDisplayModeChanged = (mode) => {},
        onAdChanged = (ad) => {},
        onAdTime = (adTime) => {},
        onAdComplete = () => {},
        onFullscreenChanged = (isFullscreen) => {},
        onClicked = (event) => {},
        onAllPlaylistEnded = () => {},
        onHlsPrepared = (obj) => {},
        onHlsDestroyed = () => {},
        onPeerConnectionPrepared = (pc) => {},
        onPeerConnectionDestroyed = () => {},
        onDashPrepared = (obj) => {},
        onDashDestroyed = () => {},
        onDestroy = () => {},
        sources = [],
        volume = 100,
        muted = false,
        paused = false,
        reloadNonce = 0,
        qualityLockTier = null,
}: Partial<OvenPlayerProps>) {
    let playerElementRef = useRef<HTMLDivElement>(null);
    let containerElementRef = useRef<HTMLDivElement>(null);
    let playerRef = useRef<OvenPlayerInstance|undefined>(undefined);
    let volumeRef = useRef<number>(volume);
    let mutedRef = useRef<boolean>(muted);
    let onStateChangedRef = useRef(onStateChanged);
    let onQualityLevelChangedRef = useRef(onQualityLevelChanged);
    let hlsRef = useRef<any>(null);
    let qualityLockTierRef = useRef<QualityTier | null>(qualityLockTier);

    let [loadedSources, setLoadedSources] = useState<OvenPlayerSource[]>([]);

    volumeRef.current = volume;
    mutedRef.current = muted;
    onStateChangedRef.current = onStateChanged;
    onQualityLevelChangedRef.current = onQualityLevelChanged;
    qualityLockTierRef.current = qualityLockTier;

    const stateChangedCallback = useCallback((event: {prevstate: OvenPlayerState, newstate: OvenPlayerState}) => {
        if (playerRef.current) {
            playerRef.current.setVolume(volumeRef.current);
            playerRef.current.setMute(mutedRef.current);
        }
        const player = playerRef.current;
        if (player && event.prevstate === "loading" && event.newstate === "playing") {
            // No explicit seek: hls.js already joins a live playlist near the live
            // edge on its own (governed by liveSyncDurationCount), which is what
            // actually lands every viewer on the same real moment for a genuinely
            // live source (OME Schedule/DVR window) — arbitrary-looking only
            // because it depends on when you tuned in. An explicit seek here used
            // to double the startup wait (a second buffer-fill after the seek) for
            // no sync benefit; a previous version also seeked to
            // `Date.now() % player.getDuration()`, which never synced anyone since
            // getDuration() on a live source is the DVR window size (drifts per
            // client/poll), not a fixed content length.
            if (containerElementRef.current) {
                containerElementRef.current.classList.remove("loading-content");
            };
        }

        onStateChangedRef.current(event);
    }, []);

    let createPlayer = useCallback(() => {
        if (playerElementRef.current === null) {
            console.error("No player div found");
            return;
        }
        console.log("create player");
        if (playerRef.current == null && playerElementRef.current != null) {
            // OvenPlayer.debug(true);
            let thePlayer = OvenPlayer.create(playerElementRef.current, {...playerOptions, volume: 0, mute: true});
            thePlayer.on('ready', onReady);
            thePlayer.on('metaChanged', onMetaChanged);
            thePlayer.on('stateChanged', stateChangedCallback);
            thePlayer.on('resized', onResized);
            thePlayer.on('playbackRateChanged', onPlaybackRateChanged);
            thePlayer.on('seek', onSeek);
            thePlayer.on('seeked', onSeeked);
            thePlayer.on('time', onTime);
            thePlayer.on('bufferChanged', onBufferChanged);
            thePlayer.on('mute', onMute);
            thePlayer.on('volumeChanged', onVolumeChanged);
            thePlayer.on('playlistChanged', onPlaylistChanged);
            thePlayer.on('sourceChanged', onSourceChanged);
            thePlayer.on('qualityLevelChanged', (event: OvenPlayerQualityEvent) => {onQualityLevelChangedRef.current({currentQuality: thePlayer.getQualityLevels()[event.currentQuality] as OvenPlayerQualityLevel, type: event.type, isAuto: event.isAuto})});
            thePlayer.on('cueChanged', onCueChanged);
            thePlayer.on('timeDisplayModeChanged', onTimeDisplayModeChanged);
            thePlayer.on('adChanged', onAdChanged);
            thePlayer.on('adTime', onAdTime);
            thePlayer.on('adComplete', onAdComplete);
            thePlayer.on('fullscreenChanged', onFullscreenChanged);
            thePlayer.on('clicked', onClicked);
            thePlayer.on('allPlaylistEnded', onAllPlaylistEnded);
            thePlayer.on('hlsPrepared', (hls: any) => {
                hlsRef.current = hls;
                // Lock as soon as the levels are known, before hls.js fetches its
                // first fragments at its own ABR guess — the polling apply below
                // comes too late for that and would buffer a few seconds of the
                // wrong rendition on every start.
                hls.on("hlsManifestParsed", () => { // Hls.Events.MANIFEST_PARSED
                    const tier = qualityLockTierRef.current;
                    if (tier !== null) {
                        applyHlsLock(hls, resolveQualityLock(tier, hls.levels.map((l: any, index: number) => ({index, height: l.height, bitrate: l.bitrate}))), true);
                    }
                });
                onHlsPrepared(hls);
            });
            thePlayer.on('hlsDestroyed', () => {hlsRef.current = null; onHlsDestroyed();});
            // OME's WebRTC provider hands us the raw RTCPeerConnection so we can
            // read live getStats() (bitrate/fps/resolution) — hls has no equivalent.
            thePlayer.on('peerConnectionPrepared', onPeerConnectionPrepared);
            thePlayer.on('peerConnectionDestroyed', onPeerConnectionDestroyed);
            thePlayer.on('dashPrepared', onDashPrepared);
            thePlayer.on('dashDestroyed', onDashDestroyed);
            thePlayer.on('destroy', onDestroy);
            playerRef.current = thePlayer;
        }
    }, [playerOptions]);

    let destroy = useCallback(() => {
        console.log("destroy player");
        if (playerRef.current) {
            try {
                playerRef.current.remove();
            } catch (e) {
                console.log("destroying player failed:", e);
            }
            playerRef.current = undefined;
        }
    }, []);

    useEffect(() => {
        return destroy;
    }, [])

    useEffect(() => {
        createPlayer();
    }, [playerElementRef])

    useEffect(() => {
        setLoadedSources([]);
    }, [playerRef])

    useEffect(() => {
        // Bumping reloadNonce forces the current sources to be reloaded (used to
        // retry a source that errored, e.g. during OME's readiness window) without
        // a full player unmount/remount, which would blink the video.
        if (reloadNonce !== 0) {
            setLoadedSources([]);
        }
    }, [reloadNonce])

    useEffect(() => {
        if (playerRef.current == null) {
            console.log("ERROR: NO PLAYER CREATED");
            return;
        }

        if (loadedSources.length != sources.length || !loadedSources.every((v, i) => v.type == sources[i].type && v.file == sources[i].file)) {
            console.log("muted", muted, "volume", volume);
            playerRef.current.setVolume(volume);
            playerRef.current.setMute(muted);

            if (sources.length !== 0) {
                // Workaround: somehow the player does not transition to 'loading' immediately for WebRTC
                console.log("loading sources", sources)
                onStateChanged({prevstate: "idle", newstate: "loading"});
                if (containerElementRef.current) {
                    containerElementRef.current.classList.add("loading-content");
                };
                playerRef.current.load([{type: "mp4", file: ""}]);
                // Clone: OvenPlayer mutates the source objects it's given in place
                // (annotates type/label/default), which would otherwise corrupt our
                // caller's `sources` prop and, since App keys the player off a string
                // derived from it, spuriously look like a source change next render.
                playerRef.current.load(sources.map(s => ({...s})));
                playerRef.current.setCurrentSource(0);
            } else {
                console.log("stopping");
                playerRef.current.stop();
            }
            
            setLoadedSources(sources);
            
            playerRef.current.setVolume(volume);
            playerRef.current.setMute(muted);
            
            if (!paused && sources.length !== 0) {
                console.log("playing");
                playerRef.current.play();
            }
        }
    }, [playerRef, paused, sources, loadedSources, createPlayer]);

    useEffect(() => {
        if (playerRef.current) {
            playerRef.current.setVolume(volume);
            playerRef.current.setMute(muted);
        }
    }, [playerRef, volume, muted]);

    useEffect(() => {
        if (playerRef.current) {
            if (paused) {
                playerRef.current.stop();
            } else {
                playerRef.current.play();
            }
        }
    }, [playerRef, paused]);

    // Apply the global quality tier as an in-player ABR lock once levels exist
    // (HLS manifest / WebRTC playlist). Retries briefly after a source load —
    // levels are not available until the provider finishes negotiating.
    useEffect(() => {
        if (qualityLockTier === null) {
            return;
        }
        const apply = (): boolean => {
            const player = playerRef.current;
            if (!player) {
                return false;
            }
            const levels = player.getQualityLevels() as OvenPlayerQualityLevel[];
            if (!levels?.length) {
                return false;
            }
            const lock = resolveQualityLock(qualityLockTier, levels);
            const hls = hlsRef.current;
            try {
                if (player.getProviderName() === "hls" && hls) {
                    applyHlsLock(hls, lock);
                } else if (lock.auto) {
                    if (!player.isAutoQuality()) {
                        player.setAutoQuality(true);
                    }
                } else if (player.isAutoQuality() || player.getCurrentQuality() !== lock.index) {
                    player.setCurrentQuality(lock.index);
                }
            } catch (e) {
                console.log("quality lock apply failed:", e);
                return false;
            }
            return true;
        };

        if (apply()) {
            return;
        }
        const interval = setInterval(() => {
            if (apply()) {
                clearInterval(interval);
            }
        }, 250);
        const timeout = setTimeout(() => clearInterval(interval), 15000);
        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [qualityLockTier, loadedSources, reloadNonce]);

    return(
        <div className="player-container" ref={containerElementRef}>
            <div 
                className="ovenplayer"
                ref={playerElementRef}
            ></div>
        </div>
    );
}
