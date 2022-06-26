import './App.css';

import { useEffect, useRef, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector from './StreamSelector';
import { StreamProtocol } from './BamApi';
import { useSnackbar } from 'notistack';
import { AvailableStreamUpdate, StreamManager, StreamSelection } from './StreamManager';

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
  "llhls": "llhls",
  "webrtc-udp": "webrtc",
  "webrtc-tcp": "webrtc",
}

const STREAM_MANAGER = new StreamManager();

function streamSelectionToOvenPlayerSourceList(selection: StreamSelection): OvenPlayerSource[] {
  return selection === null ? [] : [{
    type: PROTOCOL_TO_OVENPLAYER_TYPE[selection.protocol],
    file: selection.stream.streams.main.protocols[selection.protocol] as string
  }]
}

export default function App() {
  const [streamSelectorOpen, setStreamSelectorOpen] = useState<boolean>(false);
  const [availableStreamUpdate, setAvailableStreamUpdate] = useState<AvailableStreamUpdate>({streamMap: {}, refreshTimestamp: 0});
  const [selectedStream, setSelectedStream] = useState<StreamSelection>(null);
  const [sourcesList, setSourcesList] = useState<OvenPlayerSource[]>([]);
  const [mouseOnStreamSelector, setMouseOnStreamSelector] = useState<boolean>(false);
  const [playerState, setPlayerState] = useState<OvenPlayerState>("idle");
  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => {setImmediate(() => {setStreamSelectorOpen(true);});}, []);

  useEffect(() => {
    STREAM_MANAGER.setAvailableStreamListener(setAvailableStreamUpdate);
  }, [setAvailableStreamUpdate]);

  useEffect(() => {
    STREAM_MANAGER.setSelectedStreamListener(setSelectedStream);
  }, [setSelectedStream]);

  useEffect(() => {
    setSourcesList(streamSelectionToOvenPlayerSourceList(selectedStream));
  }, [selectedStream, setSourcesList]);

  function tryRestartAfterError() {
    // TODO
  }

  useEffect(() => {
    if (!mouseOnStreamSelector && selectedStream !== null) {
      setStreamSelectorOpen(false);
    }
    else if (mouseOnStreamSelector) {
      setStreamSelectorOpen(true);
    }
  }, [mouseOnStreamSelector, selectedStream])

  useEffect(() => {
    console.log("new state", playerState);

    if (playerState === "error") {
      setTimeout(tryRestartAfterError, 1000);
    }
  }, [playerState]);

  return (
    <div className={"App " + playerState}>
      <OvenPlayerComponent
        onClicked={() => {}}
        onStateChanged={({prevstate, newstate}) => {setPlayerState(newstate);}}
        sources={sourcesList}
        playerOptions={{autoStart: true, controls: false}}
        volume={100}
      />
      <div 
        className="invisible-menu-opener"
        onMouseOver={() => {setMouseOnStreamSelector(true);}}
      ></div>
      <StreamSelector 
        open={streamSelectorOpen} 
        onClose={() => {setMouseOnStreamSelector(false);}} 
        onStreamRequested={(selection) => STREAM_MANAGER.requestStreamSelection(selection)}
        streams={availableStreamUpdate.streamMap}
        screenshotTimestamp={availableStreamUpdate.refreshTimestamp}
        currentStream={selectedStream}
        onMouseOver={() => {setMouseOnStreamSelector(true);}}
        onMouseOut={() => {setMouseOnStreamSelector(false);}}
      />
    </div>
  );
}
