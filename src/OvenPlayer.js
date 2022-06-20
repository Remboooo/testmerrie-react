import OvenPlayer from 'ovenplayer'

import React, { Component, createRef } from 'react';

export default class OvenPlayerComponent extends Component {
    constructor(props) {
        super(props);
        this.player = null;
        this.options = props.options;
        this.playerRef = createRef();
        console.log(props);
    }

    render() {
        return(
            <div className="ovenplayer" ref={this.playerRef}>
            </div>
        );
    }

    componentDidMount() {
        this.player = OvenPlayer.create(this.playerRef.current, this.options);
        this.player.on('ready', this.props.onReady);
        this.player.on('metaChanged', this.props.onMetaChanged);
        this.player.on('stateChanged', this.props.onStateChanged);
        this.player.on('resized', this.props.onResized);
        this.player.on('playbackRateChanged', this.props.onPlaybackRateChanged);
        this.player.on('seek', this.props.onSeek);
        this.player.on('seeked', this.props.onSeeked);
        this.player.on('time', this.props.onTime);
        this.player.on('bufferChanged', this.props.onBufferChanged);
        this.player.on('mute', this.props.onMute);
        this.player.on('volumeChanged', this.props.onVolumeChanged);
        this.player.on('playlistChanged', this.props.onPlaylistChanged);
        this.player.on('sourceChanged', this.props.onSourceChanged);
        this.player.on('qualityLevelChanged', this.props.onQualityLevelChanged);
        this.player.on('cueChanged', this.props.onCueChanged);
        this.player.on('timeDisplayModeChanged', this.props.onTimeDisplayModeChanged);
        this.player.on('adChanged', this.props.onAdChanged);
        this.player.on('adTime', this.props.onAdTime);
        this.player.on('adComplete', this.props.onAdComplete);
        this.player.on('fullscreenChanged', this.props.onFullscreenChanged);
        this.player.on('clicked', this.props.onClicked);
        this.player.on('allPlaylistEnded', this.props.onAllPlaylistEnded);
        this.player.on('hlsPrepared', this.props.onHlsPrepared);
        this.player.on('hlsDestroyed', this.props.onHlsDestroyed);
        this.player.on('dashPrepared', this.props.onDashPrepared);
        this.player.on('dashDestroyed', this.props.onDashDestroyed);
        this.player.on('destroy', this.props.onDestroy);
    }

    componentWillUnmount() {
        if (this.player) {
            this.player.remove();
            this.player = null;
        }
    }
}

OvenPlayerComponent.defaultProps = {
    options: {},
    onReady: () => {},
    onMetaChanged: (meta) => {},
    onStateChanged: (state) => {},
    onResized: (newSize) => {},
    onPlaybackRateChanged: (newRate) => {},
    onSeek: (seekTo) => {},
    onSeeked: () => {},
    onTime: (newTime) => {},
    onBufferChanged: (buffer) => {},
    onMute: (newVolumePercentage) => {},
    onVolumeChanged: (newVolumePercentage) => {},
    onPlaylistChanged: (newPlaylistIndex) => {},
    onSourceChanged: (qualityIndex) => {},
    onQualityLevelChanged: (qualityLevel) => {},
    onCueChanged: (cue) => {},
    onTimeDisplayModeChanged: (mode) => {},
    onAdChanged: (ad) => {},
    onAdTime: (adTime) => {},
    onAdComplete: (adComplete) => {},
    onFullscreenChanged: (isFullscreen) => {},
    onClicked: (event) => {},
    onAllPlaylistEnded: () => {},
    onHlsPrepared: (obj) => {},
    onHlsDestroyed: () => {},
    onDashPrepared: (obj) => {},
    onDashDestroyed: () => {},
    onDestroy: () => {},
}
