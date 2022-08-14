import { Cast, CastConnected } from "@mui/icons-material";
import { StepContext } from "@mui/material";
import Checkbox from "@mui/material/Checkbox";
import { useSnackbar } from "notistack";
import { Fragment, useCallback, useEffect, useState } from "react";
import { StreamProtocol } from "./BamApi";
import config from "./config";
import { StreamSelection } from "./StreamManager";

declare global {
    interface Window { __gcastAvailable: boolean; }
};

// Set in index.html when loading the cc sender lib
const ccAvailable = window.__gcastAvailable;

const applicationId = config.chromecast.applicationId;

const PROTOCOL_TO_CONTENT_TYPE: {[key in StreamProtocol]: string} = {
    "llhls": "application/x-mpegurl",
    "webrtc-udp": "application/webrtc",
    "webrtc-tcp": "application/webrtc",
}

export type CastButtonProps = {
    streamSelection: StreamSelection;
};

export default function CastButton(props: CastButtonProps) {
    const { streamSelection } = props;

    const { enqueueSnackbar, } = useSnackbar();

    const [ccContext, setCcContext] = useState<cast.framework.CastContext>();
    const [ccConnected, setCcConnected] = useState<boolean>();
    const [ccAvailable, setCcAvailable] = useState<boolean>();
    const [player, setPlayer] = useState<cast.framework.RemotePlayer>();
    const [controller, setController] = useState<cast.framework.RemotePlayerController>();
    const castSession = cast.framework.CastContext.getInstance().getCurrentSession();

    function testCcAvailable() {
        const available = window.__gcastAvailable;
        if (available === undefined) {
            setTimeout(testCcAvailable, 100);
        } else {
            setCcAvailable(available);
        }
    }

    function streamSelectionToMediaInfo(selection: StreamSelection): chrome.cast.media.MediaInfo|undefined {
        if (selection === null) {
            return undefined;
        }
        const mediaInfo = new chrome.cast.media.MediaInfo(
            selection.stream.streams.main.protocols[selection.protocol] as string,
            PROTOCOL_TO_CONTENT_TYPE[selection.protocol]
        );
        mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
        mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
        mediaInfo.metadata.title = selection.stream.name;
        return mediaInfo;
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

    useEffect(() => {
        if (!ccConnected || !ccContext) return;
        const session = ccContext.getCurrentSession();
        const state = session?.getSessionState();
        if (session == null || state !== cast.framework.SessionState.SESSION_STARTED && state !== cast.framework.SessionState.SESSION_RESUMED) return;
        const mediaInfo = streamSelectionToMediaInfo(streamSelection);
        if (mediaInfo === undefined) return;
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        session.loadMedia(request)
            .then(() => enqueueSnackbar("Casten is gestart", {variant: "success"}))
            .catch((error) => enqueueSnackbar("Casten lukt niet, error: " + error, {variant: "error"}));
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

    if (ccAvailable) {
        return <Checkbox icon={<Cast />} checkedIcon={<CastConnected />} onClick={toggleConnect} checked={!!ccConnected} />
    } else {
        return <Fragment />
    }
}
