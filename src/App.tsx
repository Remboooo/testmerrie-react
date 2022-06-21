import './App.css';

import { useEffect, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector, { StreamSelection } from './StreamSelector';
import { StreamProtocol } from './BamApi';
import { useSnackbar } from 'notistack';

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
  "llhls": "llhls",
  "webrtc-udp": "webrtc",
  "webrtc-tcp": "webrtc",
}

export default function App() {
  const [streamSelectorOpen, setStreamSelectorOpen] = useState<boolean>(false);
  const [streamSelection, setStreamSelection] = useState<StreamSelection|null>(null);
  const [sourcesList, setSourcesList] = useState<OvenPlayerSource[]>([]);
  const [playerStateClassName, setPlayerStateClassName] = useState<string>("idle");

  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => setStreamSelectorOpen(true), []);

  useEffect(() => {
    if (!streamSelection?.stream) {
      setSourcesList([]);
      return;
    }
    let stream = streamSelection.stream;
    let protocol = streamSelection.protocol;
    let url = stream.streams.main.protocols[protocol];
    if (url !== undefined) {
      setSourcesList([{
        file: url,
        type: PROTOCOL_TO_OVENPLAYER_TYPE[protocol],
        label: stream.name,
      }])
    } else {
      enqueueSnackbar("Stream heeft geen " + protocol + "stream", {variant: "error"});
    }

  }, [streamSelection, enqueueSnackbar]);

  useEffect(() => {
    console.log("create");
    return () => console.log("destroy");
  }, [])

  function onPlayerStateChanged(event: {prevstate: OvenPlayerState, newstate: OvenPlayerState}) {
    console.log("new state", event.newstate);
    setPlayerStateClassName(event.newstate);
  }

  return (
    <div className={"App " + playerStateClassName}>
      <OvenPlayerComponent
        onClicked={() => setStreamSelectorOpen(true)}
        onStateChanged={onPlayerStateChanged}
        sources={sourcesList}
        playerOptions={{autoStart: true, controls: false}}
        volume={100}
      />
      <StreamSelector 
        open={streamSelectorOpen} 
        onClose={() => setStreamSelectorOpen(false)} 
        onSelectionChange={setStreamSelection}
      />
    </div>
  );
}
