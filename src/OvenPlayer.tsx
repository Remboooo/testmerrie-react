import OvenPlayer from 'ovenplayer'

import React, { createRef, useEffect, useState } from 'react';

type OvenPlayerInstance = ReturnType<typeof OvenPlayer.create>;
type OvenPlayerConfig = Parameters<typeof OvenPlayer.create>[1];
type OvenPlayerState = "idle"|"complete"|"paused"|"playing"|"error"|"loading"|"stalled"|"adLoaded"|"adPlaying"|"adPaused"|"adComplete";
type OvenPlayerSize = "large"|"medium"|"small"|"xsmall";

type OvenPlayerProps = {
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
    onQualityLevelChanged: (event: {currentQuality: number, type: "request"|"render", isAuto: boolean}) => void,
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
};

export default function OvenPlayerComponent({
        playerOptions = {},
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
}: Partial<OvenPlayerProps>) {
    let playerElementRef = createRef<HTMLDivElement>();
    let [player, setPlayer] = useState<OvenPlayerInstance|null>(null);

    function registerCallbacks() {
        if (playerElementRef.current === null) {
            console.error("No player div found");
            return;
        }
        if (player == null) {
            let thePlayer = OvenPlayer.create(playerElementRef.current, playerOptions);
            thePlayer.on('ready', onReady);
            thePlayer.on('metaChanged', onMetaChanged);
            thePlayer.on('stateChanged', onStateChanged);
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
            thePlayer.on('qualityLevelChanged', onQualityLevelChanged);
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
            setPlayer(thePlayer);
        }
    }

    useEffect(() => {
        function destroy() {
            if (player) {
                player.remove();
                setPlayer(null);
            }
        }
    
        registerCallbacks();
        return destroy;
    }, [player, playerElementRef])

    return(
        <div className="ovenplayer" ref={playerElementRef}></div>
    );
}
