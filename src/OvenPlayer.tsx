import OvenPlayer from 'ovenplayer'

import React, { createRef, useCallback, useEffect, useRef, useState } from 'react';

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
    onDashPrepared: (dashObject: any) => void,
    onDashDestroyed: () => void,
    onDestroy: () => void,
    sources: OvenPlayerSource[],
    volume: number,
    muted: boolean,
    paused: boolean,
    startAtRandomOffset: boolean,
};

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
        onDashPrepared = (obj) => {},
        onDashDestroyed = () => {},
        onDestroy = () => {},
        sources = [],
        volume = 100,
        muted = false,
        paused = false,
        startAtRandomOffset = false,
}: Partial<OvenPlayerProps>) {
    let playerElementRef = useRef<HTMLDivElement>(null);
    let containerElementRef = useRef<HTMLDivElement>(null);
    let playerRef = useRef<OvenPlayerInstance>();
    let volumeRef = useRef<number>(volume);
    let mutedRef = useRef<boolean>(muted);
    let startAtRandomOffsetRef = useRef<boolean>(startAtRandomOffset);
    let onStateChangedRef = useRef(onStateChanged);
    let onQualityLevelChangedRef = useRef(onQualityLevelChanged);

    let [loadedSources, setLoadedSources] = useState<OvenPlayerSource[]>([]);

    let seekedToRandomRef = useRef<boolean>();

    volumeRef.current = volume;
    mutedRef.current = muted;
    startAtRandomOffsetRef.current = startAtRandomOffset;
    onStateChangedRef.current = onStateChanged;
    onQualityLevelChangedRef.current = onQualityLevelChanged;

    const stateChangedCallback = useCallback((event: {prevstate: OvenPlayerState, newstate: OvenPlayerState}) => {
        if (playerRef.current) {
            playerRef.current.setVolume(volumeRef.current); 
            playerRef.current.setMute(mutedRef.current); 
        }
        const player = playerRef.current;
        const startAtRandomOffset = startAtRandomOffsetRef.current;
        if (player && event.prevstate === "loading" && event.newstate === "playing") {
            if ((!startAtRandomOffset) || (startAtRandomOffset && seekedToRandomRef.current)) {
                if (containerElementRef.current) {
                    containerElementRef.current.classList.remove("loading-content");
                };
            }

            if (startAtRandomOffset && !seekedToRandomRef.current) {
                seekedToRandomRef.current = true;
                let pos = (Date.now() * 1e-3) % player.getDuration();
                console.log("Seek to " + pos + " / " + player.getDuration());
                setTimeout(() => player.seek(pos));
            }
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
            thePlayer.on('hlsPrepared', onHlsPrepared);
            thePlayer.on('hlsDestroyed', onHlsDestroyed);
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
                seekedToRandomRef.current = false;
                playerRef.current.load([{type: "mp4", file: ""}]);
                playerRef.current.load(sources);
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

    return(
        <div className="player-container" ref={containerElementRef}>
            <div 
                className="ovenplayer"
                ref={playerElementRef}
            ></div>
        </div>
    );
}
