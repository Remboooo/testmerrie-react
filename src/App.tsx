import './App.css';

import { useEffect, useRef, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector from './StreamSelector';
import { getUserInfo, StreamProtocol, UserInfo } from './BamApi';
import { useSnackbar } from 'notistack';
import { AvailableStreamUpdate, StreamManager, StreamSelection } from './StreamManager';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import { VolumeDown, VolumeOff, VolumeOffOutlined, VolumeUp } from '@mui/icons-material';
import Slider from '@mui/material/Slider';
import Divider from '@mui/material/Divider';
import tuinfeest from './tuinfeest.svg';
import DiscordAuth from './DiscordAuth';
import Button from '@mui/material/Button';

const MOUSE_ON_VIDEO_TIMEOUT = 1000;

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
  "llhls": "llhls",
  "webrtc-udp": "webrtc",
  "webrtc-tcp": "webrtc",
}

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
  const [muted, setMuted] = useState<boolean>(() => {const v = localStorage.getItem("muted"); return v === "true";});
  const [volume, setVolume] = useState<number>(() => {const v = localStorage.getItem("volume"); return v === null ? 100 : parseInt(v);});
  const [streamManager, setStreamManager] = useState<StreamManager|undefined>();
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [logout, setLogout] = useState<() => void>();

  const [mouseActiveOnVideo, setMouseActiveOnVideo] = useState<boolean>(false);
  const [mouseOnVideoTimeout, setMouseOnVideoTimeout] = useState<ReturnType<typeof setTimeout>|undefined>();

  const [userInfo, setUserInfo] = useState<UserInfo>();
  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => {if (authenticated && !streamManager) {setStreamManager(new StreamManager())}}, [authenticated]);

  useEffect(() => {setImmediate(() => {setDrawerOpen(true);});}, []);

  useEffect(() => {localStorage.setItem("muted", '' + muted);}, [muted]);

  useEffect(() => {localStorage.setItem("volume", '' + volume);}, [volume]);

  useEffect(() => {
    streamManager?.setAvailableStreamListener(setAvailableStreamUpdate);
  }, [streamManager, setAvailableStreamUpdate]);

  useEffect(() => {
    streamManager?.setSelectedStreamListener(setSelectedStream);
  }, [streamManager, setSelectedStream]);

  useEffect(() => {
    setSourcesList(streamSelectionToOvenPlayerSourceList(selectedStream));
  }, [selectedStream, setSourcesList]);

  useEffect(() => {
    if (authenticated) {
      getUserInfo().then((userInfo) => {if (userInfo) {setUserInfo(userInfo)}}).catch((reason) => {
        console.log(reason);
        enqueueSnackbar("Kon je niet aanmelden bij de server.. probably doet niks het. F5? Probeer anders even uit te loggen en opnieuw in te loggen.", {variant: 'error', preventDuplicate: true, persist: true});
      });
    }
  }, [authenticated]);

  function mouseOnVideoAction() {
    if (mouseOnVideoTimeout !== undefined) {
      clearTimeout(mouseOnVideoTimeout);
    }
    setMouseActiveOnVideo(true);
    setMouseOnVideoTimeout(setTimeout(() => setMouseActiveOnVideo(false), MOUSE_ON_VIDEO_TIMEOUT));
  }

  function toggleFullscreen() {
    if (window.document.fullscreenElement) {
      window.document.exitFullscreen();
    } else {
      console.log("go fullscreen");
      window.document.getElementsByTagName("body")[0].requestFullscreen();
    }
  }

  function tryRestartAfterError() {
    // TODO
  }

  useEffect(() => {
    const userWantsDrawer = mouseOnDrawer || mouseActiveOnVideo;
    const userNeedsDrawer = selectedStream === null;
    setDrawerOpen(userWantsDrawer || userNeedsDrawer);
  }, [mouseActiveOnVideo, mouseOnDrawer, selectedStream])

  useEffect(() => {
    console.log("new state", playerState);

    if (playerState === "error") {
      setTimeout(tryRestartAfterError, 1000);
    }
  }, [playerState]);

  useEffect(() => {console.log("drawer", drawerOpen)}, [drawerOpen]);

  return (
    <div className={"App " + playerState}>
      <DiscordAuth
        setAuthenticated={(authenticated) => setAuthenticated(authenticated)}
        /* We have to wrap the logout function in another lambda because setLogout() produced by useState() treats any lambda as a lazy getter */
        setLogout={(logout) => setLogout(() => logout)}
      >
        <OvenPlayerComponent
          onClicked={() => {}}
          onStateChanged={({prevstate, newstate}) => {setPlayerState(newstate);}}
          sources={sourcesList}
          playerOptions={{autoStart: true, controls: false}}
          volume={volume}
          muted={muted}
        />
        <div 
          className="invisible-menu-opener"
          onMouseMove={() => {mouseOnVideoAction()}}
          onClick={(event) => {
            if (event.detail == 1) { 
              setDrawerOpen(true);
            } else if (event.detail == 2) {
              toggleFullscreen();
            }
          }}
        ></div>
        <div 
          className="state-overlay"
        >
          <img src={tuinfeest} className="waiting-icon" alt="waiting" />
        </div>
        <div 
          className="error-overlay"
        >
          Er gaat iets niet goed 😞<br />
          Misschien is de stream gestopt, misschien gaat er gewoon iets mis.<br />
          Probeer anders eens een ander protocol?
        </div>
        <Drawer
          className="drawer"
          open={drawerOpen}
          onClose={() => {setMouseOnDrawer(false);}}
          onMouseMove={() => {mouseOnVideoAction()}}
          onClick={(event) => {if (event.detail == 2) toggleFullscreen();}}
          anchor="top"
        >
          <Box
              onMouseOver={() => {setMouseOnDrawer(true);}}
              onMouseOut={() => {setMouseOnDrawer(false);}}
          >
            <StreamSelector 
              onStreamRequested={(selection) => streamManager?.requestStreamSelection(selection)}
              streams={availableStreamUpdate.streamMap}
              screenshotTimestamp={availableStreamUpdate.refreshTimestamp}
              currentStream={selectedStream}
            />
            <Stack spacing={2} direction="row" sx={{ padding: 2 }} alignItems="center">
              {userInfo ? (
                <div>Hello {userInfo?.user.username} 👋</div>
              ) : ''}
              <Button onClick={logout}>Uitloggen</Button>
              <Box sx={{flexGrow: 1}}></Box>
              <FormGroup>
                <FormControlLabel control={
                  <Checkbox checked={!!streamManager?.autoStart} onChange={() => {if (streamManager) {streamManager.autoStart = !streamManager.autoStart;}}} />
                } label="Doe maar een streampie. Als er iemand iets aanslingert ben ik er als de 🐔🐔 🐝" />
              </FormGroup>
            </Stack>
            <Divider />
            <Stack spacing={2} direction="row" sx={{ padding: 2 }} alignItems="center">
              <Checkbox
                onClick={() => setMuted(!muted)}
                checked={muted}
                icon={<VolumeOffOutlined />}
                checkedIcon={<VolumeOff />}
              />
              <VolumeDown />
              <Slider sx={{width: '10em', color: (muted ? 'grey.400' : 'primary.main')}} aria-label="Volume" value={volume} onClick={() => setMuted(false)} onChange={(event, newValue, something) => {setVolume(newValue as number); setMuted(false);}} />
              <VolumeUp />
              <Box sx={{flexGrow: 1}}></Box>
            </Stack>
          </Box>
        </Drawer>
      </DiscordAuth>
    </div>
  );
}
