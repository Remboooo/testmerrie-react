export type DiscordConfig = {
    clientId: string,
    redirectUri: string,
};

export type BamApiConfig = {
    uri: string,
    idleVideo: string|null,
    idleAudio: string|null,
};

export type ChromecastConfig = {
    applicationId: string,
}

export type BamConfig = {
    discord: DiscordConfig,
    bam: BamApiConfig,
    chromecast: ChromecastConfig,
};



let config: BamConfig = (process.env.NODE_ENV == 'development') ? 
// DEVELOPMENT
{
    discord: {
        clientId: "1000107540442513568",
        redirectUri: "http://localhost:3000/authcallback",
    },
    bam: {
        uri: "https://testmerrie.nl/api",
        idleVideo: "https://testmerrie.nl/treinen-mute.webm",
        idleAudio: "https://testmerrie.nl/beatsies.webm",
    },
    chromecast: {
        applicationId: "64EAC1AE"
    },
} : 
// PRODUCTION
{
    discord: {
        clientId: "1000107540442513568",
        redirectUri: "https://testmerrie.nl/authcallback",
    },
    bam: {
        uri: "https://testmerrie.nl/api",
        idleVideo: "https://testmerrie.nl/treinen-mute.webm",
        idleAudio: "https://testmerrie.nl/beatsies.webm",
    },
    chromecast: {
        applicationId: "64EAC1AE"
    },
};

export default config;