import Crypto from 'crypto';
import OAuth from 'discord-oauth2';
import config from './config';

const API_BASE = config.bam.uri + "/v1";

type DiscordAccess = {
  accessToken: string,
  scope: string,
  tokenType: string,
  expireTime: Date
};

let AUTH: DiscordAccess|undefined = ((v)=>{ 
    return v == null ? undefined : JSON.parse(v) as DiscordAccess
})(localStorage.getItem("discord-oauth2"));

const oauth = new OAuth({
  clientId: config.discord.clientId,
  redirectUri: config.discord.redirectUri,
});

export type VideoStreamParams = {
    width: number,
    height: number,
    codec: string,
    framerate: number,
    bitrate: number,
};

export type AudioStreamParams = {
    channels: number,
    codec: string,
    bitrate: number,
    samplerate: number,
};

export type StreamProtocolUrlMap = {
    "llhls"?: string,
    "webrtc-udp"?: string,
    "webrtc-tcp"?: string,
}

export type StreamProtocol = keyof StreamProtocolUrlMap;

export type StreamQualityMap = {
    main: StreamProtocolUrlMap,
}

export type StreamSpec = {
    name: string,
    streams: {
        main: {
            protocols: StreamProtocolUrlMap
        }
    },
    created: string,
    video: VideoStreamParams,
    audio: AudioStreamParams,
    thumbnail?: string,
};

export type StreamMap = {
    [key: string]: StreamSpec
};

export type StreamResponse = {
    streams: StreamMap,
};

export async function getStreams(): Promise<StreamMap> {
    return (await fetch(API_BASE + "/streams", {headers: getHeaders()})).json().then(j => j.streams);
}

export type UserInfo = {
    user: OAuth.User,
    member_of: Record<string, OAuth.Member>,
};

export async function getUserInfo(): Promise<UserInfo|undefined> {
    return (await fetch(API_BASE + "/auth", {headers: getHeaders()})).json();
}

function getHeaders() {
    if (AUTH !== undefined) {
        const header = {'Authorization': 'Bearer ' + AUTH.accessToken};
        return header;
    } else {
        return {};
    }
}

export function startAuthentication() {
    var state = Crypto.randomBytes(16).toString("hex");
    localStorage.setItem("discord-oauth2-state", state);
    window.location.href = oauth.generateAuthUrl({
        scope: ["identify", "guilds", "guilds.members.read"],
        state: state,
        responseType: "token",
    });
}

function handleAuthCallback(): DiscordAccess|undefined {
    const urlParams = new URLSearchParams(window.location.search || window.location.hash.substring(1));

    const tokenType = urlParams.get("token_type");
    const accessToken = urlParams.get("access_token");
    const expiresIn = urlParams.get("expires_in");
    const scope = urlParams.get("scope");
    const state = urlParams.get("state");
    const error = urlParams.get("error");

    var expectedState = localStorage.getItem("discord-oauth2-state");
    localStorage.removeItem("discord-oauth2-state");
    if (state === expectedState) {
        if (accessToken && expiresIn && tokenType && scope) {
            var expireTime = new Date();
            expireTime.setSeconds(expireTime.getSeconds() + parseInt(expiresIn));
            var auth = { accessToken, expireTime, scope, tokenType };
            localStorage.setItem("discord-oauth2", JSON.stringify(auth));
            return auth;
        }
        else if (error) {
            throw urlParams.get("error_description");
        }
    } else {
        console.error("Stored state and auth callback state mismatch");
    }
    return undefined;
}  

export function checkAuthentication() {
    let expiredTime = (()=>{let d = new Date(); d.setHours(d.getHours() - 1); return d;})();

    if (window.location.pathname == "/authcallback") {
        AUTH = handleAuthCallback();
        window.history.pushState(null, "", "/");
    }

    return !(AUTH === undefined || AUTH.expireTime <= expiredTime);
}

export function discardAuthentication() {
    AUTH = undefined;
    localStorage.removeItem("discord-oauth2");
    localStorage.removeItem("discord-oauth2-state");
}
