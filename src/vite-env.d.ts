/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_DISCORD_CLIENT_ID: string;
  readonly VITE_DISCORD_REDIRECT_URI: string;
  readonly VITE_CHROMECAST_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
