import './App.css';

import { useEffect, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector from './StreamSelector';
import { StreamProtocol } from './BamApi';
import { useSnackbar } from 'notistack';
import { AvailableStreamUpdate, StreamManager, StreamSelection } from './StreamManager';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

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
  const [availableStreamUpdate, setAvailableStreamUpdate] = useState<AvailableStreamUpdate>({streamMap: {}, refreshTimestamp: 0});
  const [selectedStream, setSelectedStream] = useState<StreamSelection>(null);
  const [sourcesList, setSourcesList] = useState<OvenPlayerSource[]>([]);
  const [mouseOnDrawer, setMouseOnDrawer] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [playerState, setPlayerState] = useState<OvenPlayerState>("idle");
  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => {setImmediate(() => {setDrawerOpen(true);});}, []);

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
    if (!mouseOnDrawer && selectedStream !== null) {
      setDrawerOpen(false);
    }
    else if (mouseOnDrawer) {
      setDrawerOpen(true);
    }
  }, [mouseOnDrawer, selectedStream])

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
        onMouseOver={() => {setMouseOnDrawer(true);}}
      ></div>
      <Drawer
        open={drawerOpen}
        onClose={() => {setMouseOnDrawer(false);}}
        anchor="top"
      >
        <Box
            onMouseOver={() => {setMouseOnDrawer(true);}}
            onMouseOut={() => {setMouseOnDrawer(false);}}
        >
          <StreamSelector 
            onStreamRequested={(selection) => STREAM_MANAGER.requestStreamSelection(selection)}
            streams={availableStreamUpdate.streamMap}
            screenshotTimestamp={availableStreamUpdate.refreshTimestamp}
            currentStream={selectedStream}
          />
          <Box sx={{paddingLeft: 2, paddingRight: 2}} display="flex" justifyContent="flex-end">
            <FormGroup>
              <FormControlLabel control={
                <Checkbox checked={STREAM_MANAGER.autoStart} onChange={() => {STREAM_MANAGER.autoStart = !STREAM_MANAGER.autoStart;}} />
              } label="Doe maar een streampie. Als het beweegt wil ik het zien." />
              </FormGroup>
          </Box>
        </Box>
      </Drawer>
    </div>
  );
}
