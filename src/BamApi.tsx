import Crypto from 'crypto';
import OAuth from 'discord-oauth2';
import config from './config';

const API_BASE = config.bam.uri + "/v1";

type DiscordToken = {
    accessToken: string,
    tokenType: string,  
    expireTime: Date,
    scope: string,
    refreshToken: string,
}

type DiscordAccess = {
  code: string,
  token: DiscordToken|undefined,
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
    "hls"?: string,
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
    return fetch(API_BASE + "/auth", {headers: getHeaders()}).then(async response => {
        if (!response.ok) {
            throw new Error((await response.json())["message"]);
        }
        else {
            return response.json();
        }
    });
}

function getHeaders() {
    if (AUTH !== undefined) {
        const header = {'Authorization': 'Bearer ' + AUTH.token?.accessToken};
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
        responseType: "code",
        prompt: "none"
    });
}

async function getTokenFromCode(code: string): Promise<DiscordToken> {
    return (await fetch(API_BASE + "/token?" + new URLSearchParams({code, "redirect_uri": config.discord.redirectUri}))).json().then(r => {
        if (r["error_description"]) {
            throw r["error_description"];
        }
        var expireTime = new Date();
        expireTime.setSeconds(expireTime.getSeconds() + parseInt(r["expires_in"]))
        return {
            accessToken: r["access_token"],
            tokenType: r["token_type"],
            expireTime,
            scope: r["scope"],
            refreshToken: r["refresh_token"],
        };
    });
}

async function getTokenFromRefreshToken(refreshToken: string): Promise<DiscordToken> {
    return (await fetch(API_BASE + "/refresh-token?" + new URLSearchParams({"refresh_token": refreshToken}))).json().then(r => {
        if (r["error_description"]) {
            throw r["error_description"];
        }
        var expireTime = new Date();
        expireTime.setSeconds(expireTime.getSeconds() + parseInt(r["expires_in"]))
        return {
            accessToken: r["access_token"],
            tokenType: r["token_type"],
            expireTime,
            scope: r["scope"],
            refreshToken: r["refresh_token"],
        };
    });
}

async function handleAuthCallback(): Promise<DiscordAccess|undefined> {
    const urlParams = new URLSearchParams(window.location.search || window.location.hash.substring(1));

    const code = urlParams.get("code");
    const state = urlParams.get("state");
    const error = urlParams.get("error");

    var expectedState = localStorage.getItem("discord-oauth2-state");
    localStorage.removeItem("discord-oauth2-state");
    if (state === expectedState) {
        if (code !== null) {
            var auth: DiscordAccess = { code, token: undefined };
            localStorage.setItem("discord-oauth2", JSON.stringify(auth));
            
            auth.token = await getTokenFromCode(code);
            if (auth.token.accessToken && auth.token.expireTime && auth.token.tokenType && auth.token.scope) {
                localStorage.setItem("discord-oauth2", JSON.stringify(auth));
                return auth;
            }
        }
        else if (error) {
            throw urlParams.get("error_description");
        }
    } else {
        console.error("Stored state and auth callback state mismatch");
    }
    return undefined;
}

async function tryRefreshToken() {
    if (AUTH?.token?.refreshToken) {
        // Less than 24h until expiry ⇒ refresh
        if (new Date(AUTH?.token?.expireTime).getTime() - new Date().getTime() < 1000 * 60 * 60 * 24) {
            AUTH.token = await getTokenFromRefreshToken(AUTH.token.refreshToken);
        }
    }
}

export async function checkAuthentication() {
    let expiredTime = (()=>{let d = new Date(); d.setHours(d.getHours() - 1); return d;})();

    if (window.location.pathname == "/authcallback") {
        AUTH = await handleAuthCallback();
        window.history.pushState(null, "", "/");
    } else {
        await tryRefreshToken();
        // Make sure token is refreshed whenever it is about to expire if the page stays open for a long time
        setInterval(tryRefreshToken, 60 * 1000);
    }

    return !(AUTH === undefined || AUTH.token?.expireTime === undefined || AUTH.token?.expireTime <= expiredTime);
}

export function discardAuthentication() {
    AUTH = undefined;
    localStorage.removeItem("discord-oauth2");
    localStorage.removeItem("discord-oauth2-state");
}
