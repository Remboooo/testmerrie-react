export type DiscordConfig = {
    clientId: string,
    redirectUri: string,
};

export type BamApiConfig = {
    uri: string,
};

export type BamConfig = {
    discord: DiscordConfig,
    bam: BamApiConfig,
};


export default (process.env.NODE_ENV == 'development') ? 
// DEVELOPMENT
{
    discord: {
        clientId: "1000107540442513568",
        redirectUri: "http://localhost:3000/authcallback",
    },
    bam: {
        uri: "http://localhost:8080"
    }
} : 
// PRODUCTION
{
    discord: {
        clientId: "1000107540442513568",
        redirectUri: "https://testmerrie.nl/authcallback",
    },
    bam: {
        uri: "https://testmerrie.nl/api"
    }
};
