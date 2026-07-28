# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

React web frontend ("bam2" / "Testmerrie") that plays multiple simultaneous livestreams served by **OvenMediaEngine (OME)**. It talks to a Python middleware, **testmerrie-api**, which handles Discord auth and hands out per-stream, token-signed playback URLs. UI copy is in Dutch.

Related projects live on this machine (not in this repo):
- Middleware: `/mnt/zfs/opt/testmerrie-api` (Python WSGI; owns `/api/v1/*`, Discord token exchange, stream discovery)
- Media server: `/mnt/zfs/opt/ovenmediaengine` (OME; serves LLHLS + WebRTC)

## Commands

```bash
npm install          # Node 18 toolchain (see @types/node ^18)
npm start            # dev server on 0.0.0.0:3000 with HMR
npm run build        # production build to ./build
npm test             # Jest in watch mode
CI=true npm test     # single non-watch run (use this in automation)
npm test -- StreamManager   # run tests matching a pattern
```

There is **no lint script and no typecheck script**. ESLint runs as a webpack plugin during `start`/`build` (config: `eslint-config-react-app`). To typecheck manually: `npx tsc --noEmit`. TypeScript is in `strict` mode.

## Build system — ejected Create React App

This is an **ejected CRA** app. The real webpack/Babel/Jest config lives in `config/` and `scripts/`, not behind `react-scripts`. `npm start|build|test` run `scripts/start.js|build.js|test.js` directly.

Implications for the planned refactor:
- Dependency bumps can break the hand-held webpack config in `config/webpack.config.js`. There is no `react-scripts` upgrade path — migrating to Vite (or re-adopting a managed toolchain) is the realistic modernization route.
- Node polyfills for browser (`crypto-browserify`, `stream-browserify`, `buffer`, etc.) are pulled in **because `discord-oauth2` is run client-side** (see Auth below). Removing that dependency removes most of these polyfills.
- Jest config lives in `package.json` under `"jest"` plus transforms in `config/jest/`.

## Runtime environment loaded outside the bundle

`public/index.html` loads things the React app depends on at runtime:
- **hls.js** from a CDN (`cdn.jsdelivr.net`) — required by OvenPlayer for LLHLS.
- **Google Cast sender SDK** (`gstatic.com`) — sets `window.__gcastAvailable`, which `Chromecast.tsx` polls for.
- **SVG filter defs** (`crt-sphere`, `glow`, `chromatic-aberration`) — the 📺 CRT and 🎨 chroma toggles are CSS classes (`crtFilter`, `chromaFilter`) that reference these filters; the visual effect is defined here + in `App.css`, not in JS.

## Architecture

The data flow is: **testmerrie-api** → `BamApi` (fetch + auth) → `StreamManager` (polling + selection state) → `App` (React state bridge) → `OvenPlayer` (playback) and `Chromecast` (casting).

### Config (`src/config.tsx`)
Environment config is **hardcoded in source**, branched on `process.env.NODE_ENV`. Note: the dev branch still points `bam.uri` at the **production** API (`https://testmerrie.nl/api`); only the Discord `redirectUri` differs (`localhost:3000`). There is no `.env`-driven config and no dev proxy — the dev server talks to the live API.

### Auth (`BamApi.tsx` + `DiscordAuth.tsx`)
- Discord OAuth2 **authorization-code flow runs in the browser** via the `discord-oauth2` npm package. Token exchange/refresh actually hit the middleware endpoints (`/api/v1/token`, `/refresh-token`), but the OAuth client lib is bundled client-side — this is why the Node polyfills exist.
- Tokens live in `localStorage` under `discord-oauth2`; CSRF `state` under `discord-oauth2-state`. `getHeaders()` attaches `Authorization: Bearer <accessToken>` to API calls.
- `checkAuthentication()` handles the `/authcallback` redirect, refreshes tokens <24h from expiry, and installs a 60s refresh interval. `DiscordAuth` is a gate component: it renders `children` only once both Discord auth **and** the `/api/v1/auth` membership check succeed, otherwise shows login/refusal dialogs.

### Stream state (`StreamManager.ts`)
- **Plain TS class, not a React component.** It polls `getStreams()` every 5s (`UPDATE_INTERVAL`) and pushes updates to React via a listener pattern (`setAvailableStreamListener` / `setSelectedStreamListener`). `App` owns the single instance and wires the listeners to `useState` setters.
- Polling is started/stopped based on drawer visibility (perf on weak machines) — see the `startUpdates`/`stopUpdates` effect in `App.tsx`.
- Owns selection logic: a selection is `{key, stream, quality, protocol}`; `NO_SELECTION` clears it. `autoStart` (persisted to localStorage) auto-selects the first stream when one appears.
- **Stream/quality/protocol model** (defined in `BamApi.tsx`): each stream exposes a `StreamQualityMap` (e.g. `abr`, `1080p`, `720p`) → `StreamProtocolUrlMap` with URLs per protocol: `llhls`, `webrtc-udp`, `webrtc-tcp`. Every playback URL is individually token-signed by the middleware.

### Player (`OvenPlayer.tsx`)
A React wrapper around the **imperative OvenPlayer library**, and the most fragile part of the app. It is full of deliberate workarounds — preserve them and their comments when refactoring:
- Props mirror every OvenPlayer event as an `on*` callback; latest callbacks are held in refs to avoid re-creating the player.
- Source changes load a dummy `mp4` before the real source, and WebRTC needs a manual `loading` state transition (OvenPlayer doesn't emit it).
- The idle/placeholder stream is seeked to a random offset so the looping filler starts at a varied point.
- `App` sets `rebuildOvenPlayer` to fully unmount/remount the player on source change — a workaround for OvenPlayer issue #370. Logout does a full `window.location.reload()` because the player dislikes being destroyed.

### App shell (`App.tsx`)
Single large stateful component (~460 lines) holding almost all UI state: selected/chromecast streams, protocol, volume/mute, drawer open/close, CRT/chroma/placeholder toggles, fullscreen. Many settings persist to `localStorage`. It maps a `StreamSelection` → `OvenPlayerSource[]` and, separately, → a Chromecast selection. The MUI `Drawer` (anchored top) is the control panel; open/close is driven by mouse-idle timers and by "needs" conditions (no stream, casting, error).

### Chromecast (`Chromecast.tsx`)
- Custom receiver app (`config.chromecast.applicationId`) using a **custom message namespace** `urn:x-cast:nl.testmerrie`.
- Handshake: on connect it sends `getSupportedFormats`, and only after the receiver replies does it send `play` with a URL. It **downgrades WebRTC → LLHLS** when the Chromecast generation can't do `H265/1080/60`.
- Exposes `ChromecastSupport` (context provider, wraps the app) and `ChromecastButton` (consumer). When casting, local playback is paused.

## Conventions

- `.tsx` is used even for logic-only modules (`BamApi.tsx`, `config.tsx`); non-component logic that's already plain is `.ts` (`StreamManager.ts`, `FormatUtil.ts`).
- Types for the stream/protocol/quality domain are the source of truth in `BamApi.tsx` and are imported widely — change them there.
- Ambient/library types: `src/ovenplayer.d.ts`, `src/custom.d.ts`, `src/react-app-env.d.ts`.
- Theme is MUI dark mode (`src/theme.ts`); snackbars via `notistack` (`SnackbarProvider` in `index.tsx`).
