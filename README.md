# Testmerrie

## What?
This is a React frontend for streaming media from OvenMediaEngine using [testmerrie-api](https://github.com/Remboooo/testmerrie-api) server-side middleware. Features:
 - Multiple simultaneous streams, choose between multiple transports
 - Discord authentication
 - Chromecast support
 - TRAINS AND PHAT BEATSIES

## Disclaimer
Assume I was drunk throughout building this whole thing. Reasons:
 - I probably was
 - This is My First React App ™
 - It's just for funsies and not for professional use

## Can I use it?
Sure, if you really want to. See [LICENSE.md](LICENSE.md).

## Stack
React 19 + MUI 9 + TypeScript 5, built with Vite 6, tested with Vitest. This started life as an ejected Create React App and has since been fully migrated off that.

## Development

Requires Node 18.

```bash
npm install
npm run dev
```

This starts the Vite dev server on `0.0.0.0:3000`. There's no local copy of the API or media server to develop against by default, so `vite.config.ts` proxies `/api` requests to a remote target (see `VITE_DEV_API_TARGET` below) with cookie-domain rewriting, so the httpOnly session cookie set by the API still works same-origin in dev. Point the proxy at your own backend with:

```bash
VITE_DEV_API_TARGET=http://localhost:8080 npm run dev
```

### Tests / type-checking

```bash
npm run typecheck            # tsc --noEmit
npm test                     # vitest run (single pass)
npm run test:watch           # vitest watch
npm test -- StreamManager    # run tests matching a pattern
npm run check                # typecheck + test — run this before committing
```

There's no separate lint step. Tests are colocated `*.test.ts` files (Vitest + Testing Library, jsdom).

## Building

```bash
npm run build
```

Runs `tsc --noEmit` first, so a type error fails the build, then `vite build` into `./build`. `npm run preview` serves that output locally if you want to sanity-check a production build before deploying.

## Deploying

`npm run build` produces static files in `./build` — deploy them by copying that directory's contents to your web server's document root:

```bash
npm run build
cp -a build/. /path/to/your/webroot/
grep -oE 'assets/index-[^"]+\.js' /path/to/your/webroot/index.html   # confirm the new bundle hash is in place
```

The copy is non-destructive: Vite content-hashes asset filenames, so old and new hashed chunks just accumulate under `assets/`; only `index.html` (which references the current hashes) gets overwritten. That also makes rolling back easy — point `index.html` at a previous build's asset hashes and the old chunks are still there.

A version stamp (`git describe`, plus build time) is shown top-right of the drawer, so you can confirm which build is actually live after deploying.

**Git flow:** work on a feature branch → commit → build & deploy for testing → once confirmed working, fast-forward `master` to it:

```bash
git branch -f master <branch>
git checkout master
git branch -d <branch>
```

Nothing is pushed to a remote; this is a local-only flow.

Note that this frontend build/deploy is independent of the API and media server — updating it doesn't require restarting or reconfiguring either of those.

## Configuration

Build-time config is env-driven via `import.meta.env.VITE_*`, loaded from Vite's `.env` files (`src/config.tsx` reads them into a typed config object):

| File | Purpose |
|---|---|
| `.env` | Shared across all modes |
| `.env.development` | `npm run dev` only |
| `.env.production` | `npm run build` only |

| Variable | Meaning |
|---|---|
| `VITE_API_BASE` | Base URL the frontend calls for the middleware API. Set to a relative path like `/api` when the frontend and API are served same-origin |
| `VITE_DISCORD_CLIENT_ID` | Discord OAuth2 app client ID |
| `VITE_DISCORD_REDIRECT_URI` | OAuth2 callback URL registered with Discord; typically differs per mode, e.g. `http://localhost:3000/authcallback` in dev vs your production origin's `/authcallback` |
| `VITE_CHROMECAST_APP_ID` | Custom Chromecast receiver app ID |
| `VITE_DEV_API_TARGET` | Dev-only, overrides the `/api` proxy target (not in a `.env` file — pass it inline) |

### Things loaded outside the bundle

`index.html` pulls in a few runtime dependencies that aren't part of the Vite build, so they need network access wherever the app is served:
 - **hls.js** from `cdn.jsdelivr.net` — required by the player for LLHLS/HLS playback.
 - **Google Cast sender SDK** from `www.gstatic.com` — enables the Chromecast button.
 - Inline **SVG filter defs** (chromatic aberration, etc.) — backing some of the video display effects.

### Related infrastructure

This repo is just the frontend. It talks to two other components that live outside this repo and aren't deployed from here:
 - **[testmerrie-api](https://github.com/Remboooo/testmerrie-api)** — Python middleware handling Discord auth and stream discovery/token signing.
 - **OvenMediaEngine (OME)** — the actual media server (LLHLS/WebRTC/TS-HLS).
