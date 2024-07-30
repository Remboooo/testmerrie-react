import './App.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector from './StreamSelector';
import { StreamProtocol, UserInfo } from './BamApi';
import { useSnackbar } from 'notistack';
import { AvailableStreamUpdate, NO_SELECTION, StreamManager, StreamSelection, StreamSelectionRequest } from './StreamManager';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Stack from '@mui/material/Stack';
import { Cast, Fullscreen, FullscreenExit, Help, KeyboardArrowDown, Logout, VolumeDown, VolumeOff, VolumeOffOutlined, VolumeUp } from '@mui/icons-material';
import Slider from '@mui/material/Slider';
import Divider from '@mui/material/Divider';
import tuinfeest from './tuinfeest.svg';
import DiscordAuth from './DiscordAuth';
import Button from '@mui/material/Button';
import { ChromecastSupport, ChromecastButton } from './Chromecast';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import { DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, InputLabel, Link, MenuItem, Select, SelectChangeEvent } from '@mui/material';
import config from './config';

const MOUSE_ON_VIDEO_TIMEOUT = 2000;

const BACKGROUND_AUDIO_RATIO = 0.1;

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
  "llhls": "llhls",
  "webrtc-udp": "webrtc",
  "webrtc-tcp": "webrtc",
}

function streamSelectionToOvenPlayerSourceList(selection: StreamSelection): OvenPlayerSource[] {
  return selection === null ? [] : [{
    type: PROTOCOL_TO_OVENPLAYER_TYPE[selection.protocol],
    file: selection.stream.streams[selection.quality][selection.protocol] as string
  }]
}

type SourcesList = {
  sources: OvenPlayerSource[],
  isPlaceholder: boolean
}

type BackgroundAudio = {
  source: string,
}

// Empty OPUS file. WAV would be shorter, but FF does not support it.
const DUMMY_AUDIO = new Audio("data:audio/ogg;base64,T2dnUwACAAAAAAAAAAAE19sTAAAAALSJfJMBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAATX2xMBAAAAMs4R1AEbT3B1c1RhZ3MLAAAAbGlib3B1cyAxLjQAAAAAT2dnUwAEOAEAAAAAAAAE19sTAgAAAH2fR5UBJ3AL5lPnqHt68t4P2sTcyxW/59HGZ5iOBdcPBxd7RYIrXeCvfBh0AA==");

export default function App() {
  const [availableStreams, setAvailableStreams] = useState<AvailableStreamUpdate>({streamMap: {}, idleStream: undefined, refreshTimestamp: 0});
  const [idleStreamUrl, setIdleStreamUrl] = useState<string|undefined>();
  const [selectedStream, setSelectedStream] = useState<StreamSelection>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<StreamProtocol>(() => {const v = localStorage.getItem("protocol"); return v === null ? "webrtc-udp" : v as StreamProtocol;});
  const [sourcesList, setSourcesList] = useState<SourcesList>({sources: [], isPlaceholder: false});
  const [mouseOnDrawer, setMouseOnDrawer] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [playerState, setPlayerState] = useState<OvenPlayerState>("idle");
  const [muted, setMuted] = useState<boolean>(() => {const v = localStorage.getItem("muted"); return v === "true";});
  const [volume, setVolume] = useState<number>(() => {const v = localStorage.getItem("volume"); return v === null ? 100 : parseInt(v);});
  const [streamManager, setStreamManager] = useState<StreamManager|undefined>();
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [ccConnected, setCcConnected] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [streamEnded, setStreamEnded] = useState<boolean>(false);
  const [rebuildOvenPlayer, setRebuildOvenPlayer] = useState<boolean>(false);
  const [usePlaceholderVideo, setUsePlaceholderVideo] = useState<boolean>(() => {const v = localStorage.getItem("placeholderVideo"); return v !== "false";});
  const [canPlayAudio, setCanPlayAudio] = useState<boolean>(false);
  const [clickCount, setClickCount] = useState<number>(0);

  const playerWasUsedRef = useRef<boolean>(false);

  const [logout, setLogout] = useState<() => void>();

  const mouseOnDrawerOpenerTimeout = useRef<ReturnType<typeof setTimeout>|undefined>();
  const [mouseActiveOnDrawerOpener, setMouseActiveOnDrawerOpener] = useState<boolean>(false);

  const mouseMovingTimeout = useRef<ReturnType<typeof setTimeout>|undefined>();
  const [mouseVisibleOnVideo, setMouseVisibleOnVideo] = useState<boolean>(false);

  const [userInfo, setUserInfo] = useState<UserInfo>();
  const { enqueueSnackbar, } = useSnackbar();

  useEffect(() => {
    if (!canPlayAudio) {
      DUMMY_AUDIO.currentTime = 0;
      DUMMY_AUDIO.play().then(() => {
        setCanPlayAudio(true);
        console.log("audio playing unblocked");
      }).catch(() => {
        console.log("audio playing is blocked");
      });
    }
  }, [volume, muted, selectedStream, setCanPlayAudio, canPlayAudio, clickCount]);

  useEffect(() => {if (authenticated && !streamManager) {setStreamManager(new StreamManager())}}, [authenticated]);

  useEffect(() => {setImmediate(() => {setDrawerOpen(true);});}, []);

  useEffect(() => {localStorage.setItem("muted", '' + muted);}, [muted]);

  useEffect(() => {localStorage.setItem("volume", '' + volume);}, [volume]);

  useEffect(() => {localStorage.setItem("protocol", '' + selectedProtocol);}, [selectedProtocol]);
  
  useEffect(() => {localStorage.setItem("placeholderVideo", '' + usePlaceholderVideo);}, [usePlaceholderVideo]);

  useEffect(() => {streamManager?.requestProtocolChange(selectedProtocol)}, [selectedProtocol]);

  useEffect(() => {
    streamManager?.setAvailableStreamListener(setAvailableStreams);
  }, [streamManager, setAvailableStreams]);

  useEffect(() => {
    streamManager?.setSelectedStreamListener(setSelectedStream);
  }, [streamManager, setSelectedStream]);

  useEffect(() => {
    setIdleStreamUrl(availableStreams.idleStream?.url);
  }, [setIdleStreamUrl, availableStreams])

  useEffect(() => {
    let newSourcesList: SourcesList;

    if (selectedStream !== null) {
      console.log("selected stream", selectedStream);
      setStreamEnded(false);
      newSourcesList = {
        sources: streamSelectionToOvenPlayerSourceList(selectedStream),
        isPlaceholder: false
      };
    } else {
      console.log("no stream selected");
      if (idleStreamUrl === undefined || !usePlaceholderVideo) {
        newSourcesList = {sources: [], isPlaceholder: true};
      } else {
        newSourcesList = {
          sources: [{
            type: "llhls",
            file: idleStreamUrl
          }], 
          isPlaceholder: true
        };
      }
    }
    
    let same = (
      sourcesList.isPlaceholder == newSourcesList.isPlaceholder 
      && sourcesList.sources.length == newSourcesList.sources.length 
      && sourcesList.sources.every((v, i) => v.type == newSourcesList.sources[i].type && v.file == newSourcesList.sources[i].file)
    );
    

    if (playerWasUsedRef.current && !same) {
      // Workaround for https://github.com/AirenSoft/OvenPlayer/issues/370
      setRebuildOvenPlayer(true);
    }
    setSourcesList(newSourcesList);
  }, [selectedStream, idleStreamUrl, setSourcesList, setRebuildOvenPlayer, usePlaceholderVideo]);


  /* Drawer open/close logic */

  let clearMouseOnVideoTimeout = useCallback(() => {
    if (mouseOnDrawerOpenerTimeout.current !== undefined) {
      clearTimeout(mouseOnDrawerOpenerTimeout.current);
      mouseOnDrawerOpenerTimeout.current = undefined;
    }
  }, [mouseOnDrawerOpenerTimeout]);

  let mouseOnVideoAction = useCallback(() => {
    if (mouseMovingTimeout.current) {
      clearTimeout(mouseMovingTimeout.current);
    }
    mouseMovingTimeout.current = setTimeout(() => {
      mouseMovingTimeout.current = undefined;
      setMouseVisibleOnVideo(false);
    }, MOUSE_ON_VIDEO_TIMEOUT);
    setMouseVisibleOnVideo(true);
  }, [mouseMovingTimeout]);
  
  let mouseDrawerOpenerAction = useCallback(() => {
    clearMouseOnVideoTimeout();
    setMouseActiveOnDrawerOpener(true);
    setDrawerOpen(true);
    mouseOnDrawerOpenerTimeout.current = setTimeout(() => setMouseActiveOnDrawerOpener(false), MOUSE_ON_VIDEO_TIMEOUT);
  }, [clearMouseOnVideoTimeout, mouseOnDrawerOpenerTimeout]);

  let openDrawerWithoutTimeout = useCallback(() => {
    clearMouseOnVideoTimeout();
    setDrawerOpen(true);
  }, [clearMouseOnVideoTimeout]);

  const userWantsDrawer = mouseOnDrawer || mouseActiveOnDrawerOpener;
  const userNeedsDrawer = (!sourcesList.sources.length) || ccConnected || playerState === "error";

  useEffect(() => {
    setDrawerOpen(userWantsDrawer || userNeedsDrawer);
  }, [mouseActiveOnDrawerOpener, mouseOnDrawer, selectedStream, ccConnected, playerState])

  /* Fullscreen toggle logic */

  let toggleFullscreen = useCallback(() => {
    if (window.document.fullscreenElement) {
      window.document.exitFullscreen();
    } else {
      window.document.getElementsByTagName("body")[0].requestFullscreen();
    }
  }, []);

  useEffect(() => {
    if (selectedStream?.key && !availableStreams.streamMap.hasOwnProperty(selectedStream.key)) {
      console.log("stream ended");
      setStreamEnded(true);
      streamManager?.requestStreamSelection(NO_SELECTION);
    }
  }, [selectedStream, availableStreams, streamManager]);

  // Only enable stream updates when drawer is open; causes lag when updating on my garbage machine
  useEffect(() => {
    if (drawerOpen || selectedStream === null) {
      streamManager?.startUpdates();
    } else {
      streamManager?.stopUpdates();
    }
  }, [streamManager, drawerOpen, selectedStream]);

  // Issue a warning for broken ABR implementations
  useEffect(() => {
    if (['abr', 'auto'].some(v => selectedStream?.quality === v) && !!window.chrome) {
        enqueueSnackbar(<>
            ABR werkt slecht in Chrome, zie&nbsp;<Link target="_blank" href="https://github.com/AirenSoft/OvenMediaEngine/discussions/1066#discussioncomment-7902333">dit issue</Link>
        </>, {persist: false, variant: 'warning'});
    }
  }, [selectedStream]);

  useEffect(() => {
    if (rebuildOvenPlayer) {
      setPlayerState("idle");
    }
  }, [rebuildOvenPlayer])

  if (rebuildOvenPlayer) {
    playerWasUsedRef.current = false;
    setTimeout(() => setRebuildOvenPlayer(false));
  }

  if (!rebuildOvenPlayer && sourcesList.sources.length > 0) {
    playerWasUsedRef.current = true;
  }

  let effectivelyMuted = muted || !canPlayAudio;
  let effectiveVolume = sourcesList.isPlaceholder ? BACKGROUND_AUDIO_RATIO * volume : volume;

  return (
    <div className={"App " + playerState + (ccConnected ? " casting" : "") + (sourcesList.isPlaceholder ? " placeholder-video" : "")}>
      <DiscordAuth
        setUserInfo={setUserInfo}
        setAuthenticated={setAuthenticated}
        /* We have to wrap the logout function in another lambda because setLogout() produced by useState() treats any lambda as a lazy getter */
        setLogout={(logout) => setLogout(() => logout)}
      >
        <ChromecastSupport streamSelection={selectedStream} onConnect={setCcConnected}>
          {rebuildOvenPlayer ? <></> : <OvenPlayerComponent
            onClicked={() => {}}
            onStateChanged={({prevstate, newstate}) => {setPlayerState(newstate);}}
            sources={sourcesList.sources}
            playerOptions={{autoStart: true, controls: false, loop: true}}
            volume={effectivelyMuted ? 0 : effectiveVolume}
            muted={effectivelyMuted}
            paused={ccConnected}
            startAtRandomOffset={sourcesList.isPlaceholder}
            onQualityLevelChanged={(event) => {console.log("Quality level changed to " + event.currentQuality.index + ": " + event.currentQuality.width + "×" + event.currentQuality.height + "@" + event.currentQuality.bitrate + "bps: '" + event.currentQuality.label + "'");}}
          />}
          <div 
            className={"invisible-click-catcher" + (mouseVisibleOnVideo ? " mousing" : "")}
            onMouseMove={() => {mouseOnVideoAction()}}
            onPointerDown={(event) => {
              if (event.detail == 1 && event.pointerType != "mouse") { 
                openDrawerWithoutTimeout();
              }
            }}
            onClick={(event) => {
              if (event.detail == 2) {
                toggleFullscreen();
              }
            }}
          ></div>
          <div 
            className={"invisible-menu-opener" + (mouseVisibleOnVideo && !drawerOpen ? " mousing" : "")}
            style={{cursor: "none"}}
            onMouseMove={() => {mouseDrawerOpenerAction()}}
            onClick={(event) => {
              if (event.detail == 1) { 
                openDrawerWithoutTimeout();
              } else if (event.detail == 2) {
                toggleFullscreen();
              }
            }}
          ><KeyboardArrowDown sx={{ fontSize: "3rem" }} /></div>
          <div 
            className="cast-overlay"
          >
            <Cast sx={{fontSize: "min(50vw, 50vh)"}} />
          </div>
          <div 
            className="state-overlay"
          >
            <img src={tuinfeest} className="loading-icon" alt="loading" />
          </div>
          <div 
            className="error-overlay"
          >
            Er gaat iets niet goed 😞<br />
            Probeer het nog eens?
          </div>
          <Drawer
            className="drawer"
            open={drawerOpen}
            onClose={() => {setMouseOnDrawer(false);}}
            onClick={(event) => {if (event.detail == 2) toggleFullscreen();}}
            ModalProps={{ onBackdropClick: () => {if (!userNeedsDrawer) setDrawerOpen(false);} }}
            anchor="top"
          >
            <Box
                onMouseOver={() => {setMouseOnDrawer(true);}}
                onMouseOut={() => {setMouseOnDrawer(false);}}
            >
              <Box className="stream-selector-and-selection-options">
                <StreamSelector 
                  onStreamRequested={(selection: StreamSelectionRequest) => {
                    selection.protocol = selectedProtocol;
                    streamManager?.requestStreamSelection(selection)
                  }}
                  streams={availableStreams.streamMap}
                  screenshotTimestamp={availableStreams.refreshTimestamp}
                  currentStream={selectedStream}
                  streamEnded={streamEnded}
                />
                {!availableStreams.streamMap || Object.entries(availableStreams.streamMap).length == 0 ? <FormGroup sx={{margin: "0 1em"}}>
                  <FormControlLabel control={
                    <Checkbox checked={!!streamManager?.autoStart} onChange={() => {if (streamManager) {streamManager.autoStart = !streamManager.autoStart;}}} />
                  } label="Doe maar een streampie. Als er iemand iets aanslingert ben ik er als de 🐔🐔 🐝" />
                </FormGroup> : <></>}
              </Box>
              <Divider />
              <Box sx={{display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap-reverse', alignItems: 'center'}}>
                <Box sx={{display: 'flex', justifyContent: 'flex-start', flexWrap: 'wrap', alignItems: 'left'}}>
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex' }} alignItems="center">
                    <Checkbox
                      onClick={() => {setMuted(!effectivelyMuted); setClickCount(clickCount+1);}}
                      checked={effectivelyMuted}
                      icon={<VolumeOffOutlined />}
                      checkedIcon={<VolumeOff />}
                    />
                    <VolumeDown />
                    <Slider sx={{width: '10em', color: (effectivelyMuted ? 'grey.400' : 'primary.main')}} aria-label="Volume" value={volume} onClick={() => {setMuted(false); setClickCount(clickCount+1);}} onChange={(event, newValue) => {setVolume(newValue as number); setMuted(false); setClickCount(clickCount+1);}} />
                    <VolumeUp />
                  </Stack>
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex' }} alignItems="center">
                    <FormControl size="small">
                      <InputLabel id="demo-select-small-label">Protocol</InputLabel>
                      <Select
                        labelId="demo-simple-select-label"
                        id="demo-simple-select"
                        value={selectedProtocol}
                        label="Protocol"
                        sx={{width: '10em'}}
                        onChange={(event: SelectChangeEvent) => {
                          setSelectedProtocol(event.target.value as StreamProtocol);
                        }}
                      >
                        <MenuItem value="llhls">LLHLS</MenuItem>
                        <MenuItem value="webrtc-udp">WebRTC (UDP)</MenuItem>
                        <MenuItem value="webrtc-tcp">WebRTC (TCP)</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                  <FormControlLabel sx={{ padding: 2 }} control={
                    <Checkbox checked={usePlaceholderVideo} onChange={(event, checked) => {setClickCount(clickCount+1); setUsePlaceholderVideo(checked);}} />
                  } label="CHOO CHOO 🚂" />
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex' }} alignItems="center">
                    <Checkbox 
                      onClick={() => toggleFullscreen()}
                      checked={!!window.document.fullscreenElement}
                      icon={<Fullscreen />} 
                      checkedIcon={<FullscreenExit />}
                    />
                    <ChromecastButton />
                  </Stack>
                  
                </Box>
                <Box sx={{margin: "1em", display: 'inline-flex', justifyContent: 'center', alignItems: 'center'}}>
                  <Box sx={{flexGrow: 1}}>
                    {userInfo ? (
                      <div>{userInfo?.user?.username}</div>
                    ) : ''}
                  </Box>
                  <IconButton onClick={logout}><Logout /></IconButton>
                  <IconButton onClick={() => {setHelpOpen(true);}}><Help /></IconButton>
                </Box>
              </Box>
            </Box>
          </Drawer>
        </ChromecastSupport>
        <Dialog open={helpOpen}>
            <DialogTitle>
                Halp
            </DialogTitle>
            <DialogContent>
                <DialogContentText variant='h5'>Michael wat is dit?</DialogContentText>
                <DialogContentText>Als je het weet, weet je het.</DialogContentText>
                <DialogContentText sx={{padding: "1em 0 0 0"}} variant='h5'>Ik heb een klacht</DialogContentText>
                <DialogContentText>Fix het zelf maar, <Link href="https://github.com/Remboooo/testmerrie-react" target="_blank" rel="noopener">hier is de sauce</Link>.</DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => {setHelpOpen(false);}} autoFocus>
                    OK dan
                </Button>
            </DialogActions>
        </Dialog>
      </DiscordAuth>
    </div>
  );
}
