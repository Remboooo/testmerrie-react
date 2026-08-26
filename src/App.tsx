import './App.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OvenPlayerComponent, { OvenPlayerQualityLevel, OvenPlayerSource, OvenPlayerSourceType, OvenPlayerState } from './OvenPlayer'
import StreamSelector from './StreamSelector';
import { StreamProtocol, UserInfo } from './BamApi';
import { useSnackbar } from 'notistack';
import { AvailableStreamUpdate, NO_SELECTION, QualityTier, resolveIdleSelection, StreamManager, StreamSelection, StreamSelectionRequest } from './StreamManager';
import { usePlayerRetry } from './usePlayerRetry';
import { usePersistedState } from './usePersistedState';
import StatsHud, { BufferInfo } from './StatsHud';
import { useStreamManager } from './useStreamManager';
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
import { DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, InputLabel, Link, MenuItem, Select, SelectChangeEvent, Typography } from '@mui/material';

const MOUSE_ON_VIDEO_TIMEOUT = 2000;

const BACKGROUND_AUDIO_RATIO = 0.1;

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
  "llhls": "llhls",
  "hls": "hls",
  "webrtc-udp": "webrtc",
  "webrtc-tcp": "webrtc",
}

// Protocol dropdown options, ordered low-latency -> most-resilient, with a short
// note on what each excels at.
const PROTOCOL_OPTIONS: {value: StreamProtocol, label: string, description: string}[] = [
  {value: "webrtc-udp", label: "WebRTC (UDP)", description: "Laagste vertraging, het beste bij een goede verbinding"},
  {value: "webrtc-tcp", label: "WebRTC (TCP)", description: "Lage vertraging, werkt ook door strenge firewalls"},
  {value: "llhls", label: "LLHLS", description: "Lage vertraging, werkt vrijwel overal"},
  {value: "hls", label: "HLS", description: "Hogere vertraging, het meest bestand tegen een slechte of haperende verbinding"},
];

const QUALITY_OPTIONS: {value: QualityTier, label: string, description: string}[] = [
  {value: "auto", label: "Auto", description: "Past zich automatisch aan je verbinding aan (adaptief)"},
  {value: "best", label: "Beste", description: "Hoogste resolutie die de stream biedt"},
  {value: "balanced", label: "Gebalanceerd", description: "Middenweg tussen kwaliteit en bandbreedte"},
  {value: "saver", label: "Databesparing", description: "Laagste resolutie, het zuinigst met data"},
];

// hls.js config used only for the HLS protocol: buffer generously and be patient
// on slow/unstable networks (the defaults abort loads after 10s).
const HLS_RESILIENT_CONFIG = {
  liveSyncDurationCount: 4,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  fragLoadingTimeOut: 30000,
  manifestLoadingTimeOut: 30000,
  levelLoadingTimeOut: 30000,
  fragLoadingMaxRetry: 8,
  manifestLoadingMaxRetry: 6,
  levelLoadingMaxRetry: 6,
};

// The idle loop wants the opposite trade-off from a real HLS stream: nobody's
// relying on it not to stall, so hold back only ~1 segment instead of hls.js's
// default 3 to start playback sooner (segments are 5s, so this is the
// difference between joining after ~5s vs ~15s).
const HLS_IDLE_CONFIG = {
  liveSyncDurationCount: 1,
};

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

// Empty OPUS file. WAV would be shorter, but FF does not support it.
const DUMMY_AUDIO = new Audio("data:audio/ogg;base64,T2dnUwACAAAAAAAAAAAE19sTAAAAALSJfJMBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAATX2xMBAAAAMs4R1AEbT3B1c1RhZ3MLAAAAbGlib3B1cyAxLjQAAAAAT2dnUwAEOAEAAAAAAAAE19sTAgAAAH2fR5UBJ3AL5lPnqHt68t4P2sTcyxW/59HGZ5iOBdcPBxd7RYIrXeCvfBh0AA==");

export default function App() {
  const [selectedProtocol, setSelectedProtocol] = usePersistedState<StreamProtocol>("protocol", "webrtc-udp", (v) => v as StreamProtocol);
  const [mouseOnDrawer, setMouseOnDrawer] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [playerState, setPlayerState] = useState<OvenPlayerState>("idle");
  const [muted, setMuted] = usePersistedState<boolean>("muted", false, (v) => v === "true");
  const [volume, setVolume] = usePersistedState<number>("volume", 100, (v) => parseInt(v));
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const { manager: streamManager, availableStreams, selectedStream, endedSelection, qualityTier } = useStreamManager(authenticated);
  const [ccConnected, setCcConnected] = useState<boolean>(false);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [usePlaceholderVideo, setUsePlaceholderVideo] = usePersistedState<boolean>("placeholderVideo", true, (v) => v !== "false");
  const [useCrtFilter, setUseCrtFilter] = usePersistedState<boolean>("crtFilter", false, (v) => v === "true");
  const [useChromaFilter, setUseChromaFilter] = usePersistedState<boolean>("chromaFilter", false, (v) => v === "true");
  const [useStatsHud, setUseStatsHud] = usePersistedState<boolean>("statsHud", false, (v) => v === "true");
  // Live player telemetry for the stats HUD, held in refs so the frequent
  // buffer/quality updates don't re-render App; the HUD polls them at 1 Hz.
  const liveQualityRef = useRef<OvenPlayerQualityLevel | null>(null);
  const bufferRef = useRef<BufferInfo | null>(null);
  const hlsRef = useRef<any>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  useEffect(() => { liveQualityRef.current = null; bufferRef.current = null; pcRef.current = null; }, [selectedStream]);
  const [canPlayAudio, setCanPlayAudio] = useState<boolean>(false);
  const [clickCount, setClickCount] = useState<number>(0);

  // Idle loop resolved through the same quality tier as real streams; null when
  // no idle stream is configured server-side (or none of its qualities exist yet).
  const idleSelection: StreamSelection = useMemo(
    () => resolveIdleSelection(availableStreams.idleStream, qualityTier),
    [availableStreams.idleStream, qualityTier]
  );

  // What to hand Chromecast: the selected stream, the idle loop when nothing is
  // selected (and the placeholder is on), or nothing.
  const chromecastStream: StreamSelection = useMemo(() => {
    if (selectedStream !== null) {
      return selectedStream;
    }
    if (idleSelection === null || !usePlaceholderVideo) {
      return null;
    }
    return idleSelection;
  }, [selectedStream, idleSelection, usePlaceholderVideo]);

  const [logout, setLogout] = useState<() => void>();

  const mouseOnDrawerOpenerTimeout = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [mouseActiveOnDrawerOpener, setMouseActiveOnDrawerOpener] = useState<boolean>(false);

  const mouseMovingTimeout = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [mouseVisibleOnVideo, setMouseVisibleOnVideo] = useState<boolean>(false);

  const [userInfo, setUserInfo] = useState<UserInfo>();
  const { enqueueSnackbar, } = useSnackbar();

  // Ride out OME's readiness window: on a playback error for a real stream, retry
  // the same source (shown as loading) rather than failing immediately. See
  // docs/ome-stream-readiness.md.
  const retrying = usePlayerRetry(playerState, selectedStream, useCallback(() => setReloadNonce(n => n + 1), []));

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

  useEffect(() => {setImmediate(() => {setDrawerOpen(true);});}, []);

  useEffect(() => {streamManager?.requestProtocolChange(selectedProtocol)}, [selectedProtocol]);

  // Sources to hand the player: the selected stream, the idle loop, or nothing.
  const sourcesList: SourcesList = useMemo(() => {
    if (selectedStream !== null) {
      return { sources: streamSelectionToOvenPlayerSourceList(selectedStream), isPlaceholder: false };
    }
    if (idleSelection === null || !usePlaceholderVideo) {
      return { sources: [], isPlaceholder: true };
    }
    return { sources: streamSelectionToOvenPlayerSourceList(idleSelection), isPlaceholder: true };
  }, [selectedStream, idleSelection, usePlaceholderVideo]);

  // Key the player by its source so a source change remounts it — the workaround
  // for OvenPlayer issue #370 (it doesn't switch sources cleanly), done
  // declaratively instead of via a manual rebuild flag + setTimeout dance.
  const sourceKey = sourcesList.sources.map(s => s.type + "|" + s.file).join("||");



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
  // While retrying we're really in a loading state, so don't let the transient
  // "error" force the drawer open on every retry cycle — only the terminal error
  // (once retries are exhausted) should.
  const userNeedsDrawer = (!sourcesList.sources.length) || ccConnected || (!retrying && playerState === "error");

  useEffect(() => {
    setDrawerOpen(userWantsDrawer || userNeedsDrawer);
  }, [mouseActiveOnDrawerOpener, mouseOnDrawer, selectedStream, ccConnected, playerState, retrying])

  /* Fullscreen toggle logic */

  let toggleFullscreen = useCallback(() => {
    if (window.document.fullscreenElement) {
      window.document.exitFullscreen();
    } else {
      window.document.getElementsByTagName("body")[0].requestFullscreen();
    }
  }, []);


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

  let effectivelyMuted = muted || !canPlayAudio;
  let effectiveVolume = sourcesList.isPlaceholder ? BACKGROUND_AUDIO_RATIO * volume : volume;

  return (
    <div className={"App " + (retrying ? "loading" : playerState) + (ccConnected ? " casting" : "") + (sourcesList.isPlaceholder ? " placeholder-video" : "")}>
      <DiscordAuth
        setUserInfo={setUserInfo}
        setAuthenticated={setAuthenticated}
        /* We have to wrap the logout function in another lambda because setLogout() produced by useState() treats any lambda as a lazy getter */
        setLogout={(logout) => setLogout(() => logout)}
      >
        <ChromecastSupport streamSelection={chromecastStream} onConnect={setCcConnected}>
          <div className={"mainVideoContainer" + (useCrtFilter ? " crtFilter" : "") + (useChromaFilter ? " chromaFilter" : "")}>
            <OvenPlayerComponent
              key={sourceKey}
              onClicked={() => {}}
              onStateChanged={({prevstate, newstate}) => {setPlayerState(newstate);}}
              sources={sourcesList.sources}
              playerOptions={{autoStart: true, controls: false, loop: true, hlsConfig:
                selectedStream?.protocol === "hls" ? HLS_RESILIENT_CONFIG :
                (sourcesList.isPlaceholder && idleSelection?.protocol === "hls") ? HLS_IDLE_CONFIG :
                undefined}}
              volume={effectivelyMuted ? 0 : effectiveVolume}
              muted={effectivelyMuted}
              paused={ccConnected}
              startAtLiveEdge={sourcesList.isPlaceholder}
              reloadNonce={reloadNonce}
              onQualityLevelChanged={(event) => {liveQualityRef.current = event.currentQuality;}}
              onBufferChanged={(event) => {bufferRef.current = {buffer: event.buffer, position: event.position};}}
              onHlsPrepared={(hls) => {hlsRef.current = hls;}}
              onHlsDestroyed={() => {hlsRef.current = null;}}
              onPeerConnectionPrepared={(pc) => {pcRef.current = pc;}}
              onPeerConnectionDestroyed={() => {pcRef.current = null;}}
            />
            <div className="crtOverlay" />
          </div>
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
          {useStatsHud && selectedStream && (
            <StatsHud
              playerState={playerState}
              selection={selectedStream}
              qualityTier={qualityTier}
              liveQualityRef={liveQualityRef}
              bufferRef={bufferRef}
              hlsRef={hlsRef}
              pcRef={pcRef}
            />
          )}
          <Drawer
            className="drawer"
            open={drawerOpen}
            onClose={(event, reason) => {setMouseOnDrawer(false); if (reason === 'backdropClick' && !userNeedsDrawer) setDrawerOpen(false);}}
            onClick={(event) => {if (event.detail == 2) toggleFullscreen();}}
            anchor="top"
          >
            <Box
                sx={{position: 'relative'}}
                onMouseOver={() => {setMouseOnDrawer(true);}}
                onMouseOut={() => {setMouseOnDrawer(false);}}
            >
              {/* Build version, overlaid top-right of the stream area; thumbnails cover it when full. */}
              <Typography
                variant="caption"
                color="text.secondary"
                title={"Gebouwd op " + __BUILD_TIME__}
                sx={{position: 'absolute', top: 2, right: 8, pointerEvents: 'none', opacity: 0.6}}
              >
                {__APP_VERSION__} · {__BUILD_TIME__}
              </Typography>
              <Box className="stream-selector-and-selection-options">
                <StreamSelector 
                  onStreamRequested={(selection: StreamSelectionRequest) => {
                    selection.protocol = selectedProtocol;
                    streamManager?.requestStreamSelection(selection)
                  }}
                  streams={availableStreams.streamMap}
                  screenshotTimestamp={availableStreams.refreshTimestamp}
                  currentStream={selectedStream}
                  endedStream={endedSelection}
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
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex', alignItems: 'center' }}>
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
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex', alignItems: 'center' }}>
                    <FormControl size="small">
                      <InputLabel id="demo-select-small-label">Protocol</InputLabel>
                      <Select
                        labelId="demo-simple-select-label"
                        id="demo-simple-select"
                        value={selectedProtocol}
                        label="Protocol"
                        sx={{width: '10em'}}
                        renderValue={(value) => PROTOCOL_OPTIONS.find(o => o.value === value)?.label ?? value}
                        onChange={(event: SelectChangeEvent) => {
                          setSelectedProtocol(event.target.value as StreamProtocol);
                        }}
                      >
                        {PROTOCOL_OPTIONS.map(({value, label, description}) => (
                          <MenuItem key={value} value={value} sx={{display: 'block', whiteSpace: 'normal', maxWidth: '22em'}}>
                            <Typography variant="body2">{label}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{display: 'block'}}>{description}</Typography>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small">
                      <InputLabel id="quality-select-label">Kwaliteit</InputLabel>
                      <Select
                        labelId="quality-select-label"
                        id="quality-select"
                        value={qualityTier}
                        label="Kwaliteit"
                        sx={{width: '11em'}}
                        renderValue={(value) => QUALITY_OPTIONS.find(o => o.value === value)?.label ?? value}
                        onChange={(event: SelectChangeEvent) => {
                          streamManager?.requestQualityChange(event.target.value as QualityTier);
                        }}
                      >
                        {QUALITY_OPTIONS.map(({value, label, description}) => (
                          <MenuItem key={value} value={value} sx={{display: 'block', whiteSpace: 'normal', maxWidth: '22em'}}>
                            <Typography variant="body2">{label}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{display: 'block'}}>{description}</Typography>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                  {availableStreams.idleStream ? <FormControlLabel control={
                    <Checkbox checked={usePlaceholderVideo} onChange={(event, checked) => {setClickCount(clickCount+1); setUsePlaceholderVideo(checked);}} />
                  } label="🚂" /> : <></>}
                  <FormControlLabel control={
                    <Checkbox checked={useCrtFilter} onChange={(event, checked) => {setClickCount(clickCount+1); setUseCrtFilter(checked);}} />
                  } label="📺" />
                  <FormControlLabel control={
                    <Checkbox checked={useChromaFilter} onChange={(event, checked) => {setClickCount(clickCount+1); setUseChromaFilter(checked);}} />
                  } label="🎨" />
                  <FormControlLabel control={
                    <Checkbox checked={useStatsHud} onChange={(event, checked) => {setUseStatsHud(checked);}} />
                  } label="📊" />
                  <Stack spacing={2} direction="row" sx={{ padding: 2, display: 'inline-flex', alignItems: 'center' }}>
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
