import config from './config';

const API_BASE = config.bam.uri + "/v1";

const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
const OAUTH_SCOPES = ["identify", "guilds", "guilds.members.read"];
const STATE_STORAGE_KEY = "discord-oauth2-state";

/*
 {
    "streams": {
        "bam/rem": {
            "name": "rem",
            "streams": {
                "abr": {
                    "llhls": "https://testmerrie.nl/ome/bam/rem/abr.m3u8?token=xxx",
                    "webrtc-udp": "wss://testmerrie.nl/ome/bam/rem/abr?token=xxx",
                    "webrtc-tcp": "wss://testmerrie.nl/ome/bam/rem/abr?transport=tcp&token=xxx"
                },
                "1080p": {
                    "llhls": "https://testmerrie.nl/ome/bam/rem/original.m3u8?token=xxx",
                    "webrtc-udp": "wss://testmerrie.nl/ome/bam/rem/original?token=xxx",
                    "webrtc-tcp": "wss://testmerrie.nl/ome/bam/rem/original?transport=tcp&token=xxx"
                },
                "720p": {
                    "llhls": "https://testmerrie.nl/ome/bam/rem/720.m3u8?token=xxx",
                    "webrtc-udp": "wss://testmerrie.nl/ome/bam/rem/720?token=xxx",
                    "webrtc-tcp": "wss://testmerrie.nl/ome/bam/rem/720?transport=tcp&token=xxx"
                },
                "480p": {
                    "llhls": "https://testmerrie.nl/ome/bam/rem/480.m3u8?token=xxx",
                    "webrtc-udp": "wss://testmerrie.nl/ome/bam/rem/480?token=xxx",
                    "webrtc-tcp": "wss://testmerrie.nl/ome/bam/rem/480?transport=tcp&token=xxx"
                }
            },
            "created": "2023-10-27T23:01:44.366+02:00",
            "video": {
                "width": 1920,
                "height": 1080,
                "codec": "H264",
                "bitrate": "8000000",
                "framerate": 60.0
            },
            "audio": {
                "bitrate": "160000",
                "codec": "AAC",
                "channels": null,
                "samplerate": 48000
            },
            "thumbnail": "https://testmerrie.nl/ome/bam/rem/thumb.png?token=xxx"
        }
    },
    "dbg": []
}
 */


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
    "hls"?: string,
    "webrtc-udp"?: string,
    "webrtc-tcp"?: string,
}

export type StreamProtocol = keyof StreamProtocolUrlMap;

export type StreamQualityMap = {
    [key: string]: StreamProtocolUrlMap,
}

export type StreamQuality = keyof StreamQualityMap;

export type StreamSpec = {
    name: string,
    streams: StreamQualityMap,
    created?: string,
    video?: VideoStreamParams,
    audio?: AudioStreamParams,
    thumbnail?: string,
};

export type StreamMap = {
    [key: string]: StreamSpec
};

export type IdleStreamSpec = {
    "url": string,
}

export type StreamResponse = {
    streams: StreamMap,
    idleStream?: IdleStreamSpec,
};

export async function getStreams(): Promise<StreamResponse> {
    return (await fetch(API_BASE + "/streams", {credentials: "include"})).json();
}

export type DiscordUser = {
    id: string,
    username: string,
    global_name?: string | null,
    discriminator?: string,
    avatar?: string | null,
    [key: string]: unknown,
};

export type DiscordMember = {
    roles: string[],
    nick?: string | null,
    [key: string]: unknown,
};

export type UserInfo = {
    user: DiscordUser,
    member_of: Record<string, DiscordMember>,
};

export async function getUserInfo(): Promise<UserInfo> {
    const response = await fetch(API_BASE + "/auth", {credentials: "include"});
    if (!response.ok) {
        throw new Error((await response.json())["message"]);
    }
    return response.json();
}

function randomState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function startAuthentication() {
    const state = randomState();
    localStorage.setItem(STATE_STORAGE_KEY, state);
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPES.join(" "),
        state,
        prompt: "none",
    });
    window.location.href = `${DISCORD_AUTHORIZE_URL}?${params}`;
}

// Exchange the OAuth code for a server-side session. The API sets an httpOnly
// cookie; no token is stored client-side.
async function createSession(code: string): Promise<void> {
    const params = new URLSearchParams({code, redirect_uri: config.discord.redirectUri});
    const response = await fetch(`${API_BASE}/session?${params}`, {
        method: "POST",
        credentials: "include",
    });
    if (!response.ok) {
        let message = response.statusText;
        try {
            message = (await response.json())["message"] ?? message;
        } catch { /* non-JSON error body */ }
        throw new Error(message);
    }
}

async function handleAuthCallback(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search || window.location.hash.substring(1));
    const code = urlParams.get("code");
    const state = urlParams.get("state");
    const error = urlParams.get("error");

    const expectedState = localStorage.getItem(STATE_STORAGE_KEY);
    localStorage.removeItem(STATE_STORAGE_KEY);

    if (error) {
        throw urlParams.get("error_description") || error;
    }
    if (code === null) {
        return;
    }
    if (state !== expectedState) {
        throw new Error("Authentication state mismatch; please try logging in again");
    }
    await createSession(code);
}

// Memoize the callback handling so duplicate callers within one page load (React
// StrictMode double-invokes the mount effect; an accidental double-mount would
// too) share a single execution. handleAuthCallback consumes one-shot values —
// the CSRF state and the OAuth code — so a second run would find the state
// already removed and throw a spurious "state mismatch". getUserInfo below is an
// idempotent GET, so it's fine to leave unmemoized. A real reload re-initializes
// the module, resetting the guard.
let authCallbackPromise: Promise<void> | undefined;

export async function checkAuthentication(): Promise<boolean> {
    if (window.location.pathname === "/authcallback") {
        try {
            if (!authCallbackPromise) {
                authCallbackPromise = handleAuthCallback();
            }
            await authCallbackPromise;
        } finally {
            window.history.pushState(null, "", "/");
        }
    }

    // The session lives in an httpOnly cookie; the only way to know it's valid
    // is to ask the server. Token refresh is handled server-side.
    try {
        await getUserInfo();
        return true;
    } catch {
        return false;
    }
}

export async function discardAuthentication(): Promise<void> {
    try {
        await fetch(`${API_BASE}/session`, {method: "DELETE", credentials: "include"});
    } catch { /* best-effort logout; ignore network errors */ }
    localStorage.removeItem(STATE_STORAGE_KEY);
}
