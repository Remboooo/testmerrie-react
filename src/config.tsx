export type DiscordConfig = {
    clientId: string,
    redirectUri: string,
};

export type BamApiConfig = {
    uri: string,
};

export type ChromecastConfig = {
    applicationId: string,
}

export type BamConfig = {
    discord: DiscordConfig,
    bam: BamApiConfig,
    chromecast: ChromecastConfig,
};



const config: BamConfig = {
    discord: {
        clientId: import.meta.env.VITE_DISCORD_CLIENT_ID,
        redirectUri: import.meta.env.VITE_DISCORD_REDIRECT_URI,
    },
    bam: {
        uri: import.meta.env.VITE_API_BASE,
    },
    chromecast: {
        applicationId: import.meta.env.VITE_CHROMECAST_APP_ID,
    },
};

export default config;