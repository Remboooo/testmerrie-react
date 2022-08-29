import { Cast, CastConnected } from "@mui/icons-material";
import { StepContext } from "@mui/material";
import Checkbox from "@mui/material/Checkbox";
import { SnackbarKey, useSnackbar, VariantType } from "notistack";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StreamProtocol } from "./BamApi";
import config from "./config";
import { OvenPlayerSourceType } from "./OvenPlayer";
import { StreamSelection } from "./StreamManager";

declare global {
    interface Window { __gcastAvailable: boolean; }
};

// Set in index.html when loading the cc sender lib
const ccAvailable = window.__gcastAvailable;

const applicationId = config.chromecast.applicationId;

const PROTOCOL_TO_CONTENT_TYPE: {[key in StreamProtocol]: string} = {
    "hls": "application/x-mpegurl",
    "llhls": "application/x-mpegurl",
    "webrtc-udp": "application/webrtc",
    "webrtc-tcp": "application/webrtc",
}

const PROTOCOL_TO_OVENPLAYER_TYPE: {[key in StreamProtocol]: OvenPlayerSourceType} = {
    "hls": "hls",
    "llhls": "llhls",
    "webrtc-udp": "webrtc",
    "webrtc-tcp": "webrtc",
}

type CustomCcMessage = {
    "query": string,
}

type CustomCcRequest = CustomCcMessage;

type CustomCcResponse = CustomCcMessage & {
    "status": string,
};

type SupportedFormatsResponse = CustomCcResponse & {
    "query": "getSupportedFormats",
    "H265/2160/60": boolean,
    "H265/2160/30": boolean,
    "H264/2160/30": boolean,
    "H264/1080/60": boolean,
    "H264/1080/30": boolean,
    "H264/720/60": boolean,
};

type PlayRequest = CustomCcRequest & {
    "query": "play",
    "url": string,
    "protocol": string,
};

export type CastContextProps = {
    streamSelection: StreamSelection;
    children?: React.ReactNode;
};

type ContextValue = {
    ccAvailable: boolean|undefined,
    ccConnected: boolean|undefined,
    toggleConnect: () => void,
};

const ChromecastContext = createContext<ContextValue>({ccAvailable: false, ccConnected: false, toggleConnect: () => {}});

export function ChromecastSupport(props: CastContextProps) {
    const { streamSelection } = props;

    const { enqueueSnackbar, closeSnackbar } = useSnackbar();

    const [ccContext, setCcContext] = useState<cast.framework.CastContext>();
    const [ccConnected, setCcConnected] = useState<boolean>();
    const [ccAvailable, setCcAvailable] = useState<boolean>();
    const [player, setPlayer] = useState<cast.framework.RemotePlayer>();
    const [controller, setController] = useState<cast.framework.RemotePlayerController>();
    const ccSession = useRef<cast.framework.CastSession>();
    const statusSnackbar = useRef<SnackbarKey>();

    const querySentForStream = useRef<StreamSelection>();

    function closeWarning() {
        emitWarning(undefined);
    }

    function emitWarning(warning: string|undefined, variant: VariantType = 'warning') {
        console.warn("Chromecast: ", warning);
        if (statusSnackbar.current !== undefined) {
            closeSnackbar(statusSnackbar.current);
        }
        if (warning !== undefined) {
            statusSnackbar.current = enqueueSnackbar(warning, {persist: true, variant});
        } else {
            statusSnackbar.current = undefined;
        }
    }

    function testCcAvailable() {
        const available = window.__gcastAvailable;
        if (available === undefined) {
            setTimeout(testCcAvailable, 100);
        } else {
            setCcAvailable(available);
        }
    }

    function streamSelectionToPlayRequest(selection: StreamSelection, supportedFormats: SupportedFormatsResponse): PlayRequest|undefined {
        if (selection === null) {
            return undefined;
        }
        let stream = selection.stream;
        let streamVariant = selection.stream.streams.main;
        let protocol = selection.protocol;

        if (["hls"].indexOf(protocol) > -1) {
            emitWarning("HLS heeft hoge latency, hou er rekening mee dat je wat achter loopt", 'info');
        }

        if (!supportedFormats["H265/2160/30"] && ["webrtc-tcp", "webrtc-udp"].indexOf(protocol) > -1) {
            emitWarning("WebRTC gaat niet werken op jouw generatie Chromecast; we gaan voor HLS met helaas ietwat hoge latency");
            protocol = "hls";
        }

        if (!supportedFormats["H264/1080/60"] && ["llhls"].indexOf(protocol) > -1) {
            emitWarning("Geen idee of LLHLS gaat werken op jouw Chromecast, maar we gaan het proberen. Als het ruk is, probeer HLS.");
        }

        if (!supportedFormats["H264/1080/60"] && stream.video.width > 1280 && stream.video.framerate > 30) {
            emitWarning("Je Chromecast geeft aan geen 1080p60 te supporten, mogelijk gaat shit haperen");
        }
        
        return {query: "play", url: streamVariant.protocols[protocol] as string, protocol: PROTOCOL_TO_OVENPLAYER_TYPE[protocol]};
    }

    useEffect(testCcAvailable, []);

    useEffect(() => {
        if (ccAvailable) {
            const context = cast.framework.CastContext.getInstance();
            context.setOptions({
                receiverApplicationId: applicationId,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });
            const player = new cast.framework.RemotePlayer();
            const controller = new cast.framework.RemotePlayerController(player);
            controller.addEventListener(
                cast.framework.RemotePlayerEventType.ANY_CHANGE, (event) => console.log(event)
            );
            controller.addEventListener(
                cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
                (event) => setCcConnected(player.isConnected)
            )
            setCcConnected(player.isConnected);
            setCcContext(context);
            setPlayer(player);
            setController(controller);
        }

    }, [ccAvailable]);

    function sendRequest(request: CustomCcRequest) {
        console.log("Chromecast send request", request);
        if (!ccSession.current) {
            console.error("No session to send request", request);
        } else {
            ccSession.current.sendMessage('urn:x-cast:nl.testmerrie', request).catch(
                (error) => {
                    emitWarning("Kon geen bericht naar de Chromecast sturen: " + error, 'error');
                }
            );
        }
    }

    const startStream = useCallback((supportedFormats: SupportedFormatsResponse) => {
        const streamSelection = querySentForStream.current;
        if (!streamSelection) return;
        const playRequest = streamSelectionToPlayRequest(streamSelection, supportedFormats);
        if (playRequest) {
            // Cannot call sendRequest from inside a message callback
            sendRequest(playRequest);
        }
    }, [streamSelection]);

    const messageListener = useCallback((namespace: string, messageString: string) => {
        console.log("Chromecast receive reply", messageString);
        const message = JSON.parse(messageString) as CustomCcResponse;
        const query = message["query"];
        switch (query) {
            case "getSupportedFormats":
                startStream(message as SupportedFormatsResponse);
                break;
            case "play":
                break;
            default:
                emitWarning("Antwoord van Chromecast slaat nergens op: " + messageString, 'error');
        }
    }, [startStream]);

    useEffect(() => {
        if (!ccConnected || !ccContext) {
            closeWarning();
            ccSession.current = undefined;
            return;
        }

        const session = ccContext.getCurrentSession();
        const state = session?.getSessionState();
        if (session === null || session === undefined || state !== cast.framework.SessionState.SESSION_STARTED && state !== cast.framework.SessionState.SESSION_RESUMED) return;
        
        ccSession.current = session;

        session.addMessageListener('urn:x-cast:nl.testmerrie', messageListener);
    }, [ccConnected, ccContext]);

    useEffect(() => {
        closeWarning();
    }, [streamSelection]);

    useEffect(() => {
        if (!ccSession.current) return;
        querySentForStream.current = streamSelection;
        sendRequest({"query": "getSupportedFormats"});
    }, [ccConnected, ccContext, streamSelection]);

    function toggleConnect() {
        if (!ccContext) {
            return;
        }
        if (ccConnected) {
            ccContext.endCurrentSession(true);
        } else {
            ccContext.requestSession();
        }
    }    

    return <ChromecastContext.Provider value={{ ccAvailable, ccConnected, toggleConnect }}>{props.children}</ChromecastContext.Provider>
}

export function ChromecastButton() {
    const { ccAvailable, ccConnected, toggleConnect } = useContext(ChromecastContext);
    if (ccAvailable) {
        return <Checkbox icon={<Cast />} checkedIcon={<CastConnected />} onClick={toggleConnect} checked={!!ccConnected} />
    } else {
        return <Fragment />
    }
}

