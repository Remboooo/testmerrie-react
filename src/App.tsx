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
import Stack from '@mui/material/Stack';
import { VolumeDown, VolumeUp } from '@mui/icons-material';
import Slider from '@mui/material/Slider';
import Divider from '@mui/material/Divider';
import tuinfeest from './tuinfeest.svg';

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
  const [volume, setVolume] = useState<number>(() => {const vol = localStorage.getItem("volume"); return vol === null ? 100 : parseInt(vol);});
  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => {setImmediate(() => {setDrawerOpen(true);});}, []);

  useEffect(() => {localStorage.setItem("volume", '' + volume);}, [volume]);

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
        volume={volume}
      />
      <div 
        className="invisible-menu-opener"
        onMouseOver={() => {setMouseOnDrawer(true);}}
      ></div>
      <div 
        className="state-overlay"
      >
        <img src={tuinfeest} className="waiting-icon" alt="waiting" />
      </div>
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
          <Stack spacing={2} direction="row" sx={{ padding: 2 }} alignItems="center">
            <Box sx={{flexGrow: 1}}></Box>
            <FormGroup>
              <FormControlLabel control={
                <Checkbox checked={STREAM_MANAGER.autoStart} onChange={() => {STREAM_MANAGER.autoStart = !STREAM_MANAGER.autoStart;}} />
              } label="Doe maar een streampie. Als het beweegt wil ik het zien." />
            </FormGroup>
          </Stack>
          <Divider />
          <Stack spacing={2} direction="row" sx={{ padding: 2 }} alignItems="center">
            <VolumeDown />
            <Slider sx={{width: '10em'}} aria-label="Volume" value={volume} onChange={(event, newValue, something) => {setVolume(newValue as number);}} />
            <VolumeUp />
            <Box sx={{flexGrow: 1}}></Box>
          </Stack>
        </Box>
      </Drawer>
    </div>
  );
}
