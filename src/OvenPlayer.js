import OvenPlayer from 'ovenplayer'

import React, { Component, createRef, useEffect } from 'react';

let player = null;

export default function OvenPlayerComponent({
        options = {},
        onReady = () => {},
        onMetaChanged = (meta) => {},
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
        onAdComplete = (adComplete) => {},
        onFullscreenChanged = (isFullscreen) => {},
        onClicked = (event) => {},
        onAllPlaylistEnded = () => {},
        onHlsPrepared = (obj) => {},
        onHlsDestroyed = () => {},
        onDashPrepared = (obj) => {},
        onDashDestroyed = () => {},
        onDestroy = () => {},
}) {
    let playerRef = createRef();

    function registerCallbacks() {
        player = OvenPlayer.create(playerRef.current, options);
        player.on('ready', onReady);
        player.on('metaChanged', onMetaChanged);
        player.on('stateChanged', onStateChanged);
        player.on('resized', onResized);
        player.on('playbackRateChanged', onPlaybackRateChanged);
        player.on('seek', onSeek);
        player.on('seeked', onSeeked);
        player.on('time', onTime);
        player.on('bufferChanged', onBufferChanged);
        player.on('mute', onMute);
        player.on('volumeChanged', onVolumeChanged);
        player.on('playlistChanged', onPlaylistChanged);
        player.on('sourceChanged', onSourceChanged);
        player.on('qualityLevelChanged', onQualityLevelChanged);
        player.on('cueChanged', onCueChanged);
        player.on('timeDisplayModeChanged', onTimeDisplayModeChanged);
        player.on('adChanged', onAdChanged);
        player.on('adTime', onAdTime);
        player.on('adComplete', onAdComplete);
        player.on('fullscreenChanged', onFullscreenChanged);
        player.on('clicked', onClicked);
        player.on('allPlaylistEnded', onAllPlaylistEnded);
        player.on('hlsPrepared', onHlsPrepared);
        player.on('hlsDestroyed', onHlsDestroyed);
        player.on('dashPrepared', onDashPrepared);
        player.on('dashDestroyed', onDashDestroyed);
        player.on('destroy', onDestroy);
    }

    function destroy() {
        if (player) {
            player.remove();
            player = null;
        }
    }

    useEffect(() => {
        registerCallbacks();
        return destroy;
    }, [])

    return(
        <div className="ovenplayer" ref={playerRef}></div>
    );
}
