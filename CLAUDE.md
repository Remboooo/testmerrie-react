# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

React web frontend ("Testmerrie" / historically "bam2") that plays multiple simultaneous livestreams served by **OvenMediaEngine (OME)**. It talks to a Python middleware, **testmerrie-api**, which handles Discord auth and hands out per-stream, token-signed playback URLs. UI copy is in Dutch.

Related projects live on this machine (not in this repo):
- Middleware: `/mnt/zfs/opt/testmerrie-api` (Python WSGI on the homemade **sprong** framework; owns `/api/v1/*`, Discord token exchange, server-side sessions, stream discovery). Session store: `auth/sessionstore.py` (sqlite).
- Media server: `/mnt/zfs/opt/ovenmediaengine` (OME; serves LLHLS + WebRTC + TS-HLS). Logs: `/var/log/ovenmediaengine/ovenmediaengine.log` (world-readable).
- Idle/placeholder loop: a `_filler` OME app (Schedule provider, `BypassTranscoder`, zero live transcoding) loops local files under `ovenmediaengine/media/` on a fixed real-time schedule (`_filler.sch`). 720p/480p tiers are pre-baked once offline via `ovenmediaengine/media/scripts/make_idle_renditions.sh` (nvenc) and registered as sibling schedules (`_filler_720.sch`, `_filler_480.sch`); testmerrie-api's `idleStream` config (`config.yaml`) maps quality name → OME stream name. This app shape silently ignores `Server.xml`'s declared `<Playlist>` Name/FileName (OME serves its own auto-generated filename instead, e.g. `playlist` not the configured `hls`) — testmerrie-api reads the actual served filename back from the running stream rather than trusting the config echo. OME positions Schedule playback as `(now - scheduled_start) mod total_loop_duration`, so every quality tier's total duration must match the original *exactly* or they silently drift apart (imperceptible per loop, but `scheduled_start` is a fixed distant timestamp, so tiny differences compound over the loop's whole lifetime) — the rendition script retimes each output via a lossless `-itsscale` remux so this can't happen, restarting OME does *not* fix a duration mismatch (only re-encoding/retiming the files does).

## Commands

```bash
npm install          # Node 18 toolchain
npm run dev          # Vite dev server on 0.0.0.0:3000 (proxies /api -> prod, see below)
npm run build        # tsc --noEmit && vite build  ->  ./build
npm run check        # tsc --noEmit && vitest run   (the gate to run before committing)
npm test             # vitest run (single pass)
npm run test:watch   # vitest watch
npm run typecheck    # tsc --noEmit
npm test -- StreamManager   # run tests matching a pattern
```

TypeScript is in `strict` mode. `npm run build` **type-checks first**, so a type error fails the build. There is no separate lint step.

## Deploy workflow

The user tests against **live prod** (`https://testmerrie.nl`) — there is no staging. Deploy each change so it can be tried:

```bash
npm run build
cp -a build/. /var/www/testmerrie/     # non-destructive: hashed assets accumulate, only index.html is overwritten
grep -oE 'assets/index-[^"]+\.js' /var/www/testmerrie/index.html   # confirm the new bundle hash is live
curl -s -o /dev/null -w '%{http_code}\n' https://testmerrie.nl/
```

`/var/www/testmerrie` is writable (rem owns the files); its parent `/var/www` is **not**, so you can't write a sibling backup there. Reverting = point `index.html` back at a prior `assets/index-*.js` (old hashed chunks remain). A build version stamp (`__APP_VERSION__` = `git describe`, `__BUILD_TIME__`, injected via Vite `define`) shows top-right of the drawer so you can tell which build is live.

**Git flow:** feature branch → commit → build/deploy for the user to test → once confirmed, fast-forward master (`git branch -f master <branch>; git checkout master; git branch -d <branch>`). Nothing is pushed to origin. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Environment constraints (important)

**No sudo.** You cannot restart `testmerrie-api` (uwsgi), OME, or nginx, nor edit root-owned files (OME `Server.xml`, `nginx.conf`, possibly `.env`). When a change needs one of those, make the edit if you can and **ask the user to apply/restart** it. The user runs OME/API/nginx restarts.

## Build system — Vite (migrated off ejected CRA)

This was an ejected Create React App; it is now **Vite 6 + Vitest + TypeScript 5**. Real config is `vite.config.ts` (there is no `config/`/`scripts/` CRA machinery, no `react-scripts`).

- Dev has no local API; `vite.config.ts` **proxies `/api` to `https://testmerrie.nl`** (override with `VITE_DEV_API_TARGET`) with `cookieDomainRewrite` so the httpOnly session cookie is accepted same-origin in dev.
- **Chunking (`build.rollupOptions.output.manualChunks`):** only `ovenplayer` (a large, self-contained ~550 kB lib) is split into its own chunk. **React/MUI/Emotion must stay together in one `vendor` chunk** — splitting that interdependent graph apart causes a cross-chunk init cycle ("can't access property exports of undefined"). App code is a tiny `index` chunk (~13 kB gz) so app-only deploys barely re-download anything.
- Fonts: `@fontsource/roboto`, latin weights 300/400/500/700 only (imported in `index.tsx`). Do not reintroduce the deprecated `typeface-roboto`.

## Runtime environment loaded outside the bundle

`public/index.html` loads things the app depends on at runtime:
- **hls.js** from a CDN — required by OvenPlayer for LLHLS/HLS (NOT bundled).
- **Google Cast sender SDK** — sets `window.__gcastAvailable`, which `Chromecast.tsx` polls for.
- **SVG filter defs** (`crt-sphere`, `glow`, `chromatic-aberration`) — the 📺 CRT and 🎨 chroma toggles are CSS classes referencing these filters; the visual effect lives here + in `App.css`, not in JS.

## Architecture

Data flow: **testmerrie-api** → `BamApi` (fetch + cookie auth) → `StreamManager` (polling + selection store) → `useStreamManager` (React bridge) → `App` → `OvenPlayer` (playback) / `Chromecast` (casting) / `StatsHud` (telemetry).

### Config (`src/config.tsx`)
Env-driven via `import.meta.env.VITE_*` (`VITE_API_BASE`, `VITE_DISCORD_CLIENT_ID`, `VITE_DISCORD_REDIRECT_URI`, `VITE_CHROMECAST_APP_ID`), set through Vite `.env` files. (The old hardcoded `NODE_ENV`-branched config is gone.)

### Auth — server-side httpOnly cookie sessions (`BamApi.tsx` + `DiscordAuth.tsx`)
Discord OAuth2 **authorization-code flow, exchanged server-side**. The old client-side `discord-oauth2` package (and its Node polyfills) were removed.
- `startAuthentication()` builds the Discord authorize URL with a Web-Crypto CSRF `state`; the `/authcallback` redirect calls `createSession()` → `POST /api/v1/session` (`credentials: 'include'`), and the middleware sets an **httpOnly session cookie** backed by a sqlite session store.
- `getUserInfo()` / `getStreams()` use `credentials: 'include'`; `discardAuthentication()` → `DELETE /api/v1/session`. There are no tokens in `localStorage`.
- `DiscordAuth` is a gate component: renders `children` only once the session **and** the `/api/v1/auth` membership check succeed, else shows login/refusal dialogs.

### Stream state (`StreamManager.ts` + `useStreamManager.ts`)
- **Plain TS class used as an external store.** `subscribe(listener) → unsubscribe` + `notify()`; snapshots via `getAvailableStreams()` / `getSelectedStream()` / `getEndedSelection()` / `qualityTier`. `useStreamManager` wires it to React with `useSyncExternalStore`; `App` owns the instance. Polls `getStreams()` every 5 s; polling starts/stops with drawer visibility.
- **Selection** = `{key, stream, quality, protocol}` (`NO_SELECTION` clears). `requestStreamSelection` / `requestProtocolChange` / `requestQualityChange`.
- **Quality is a global intent tier**, not a per-stream pick: `auto | best | balanced | saver` (persisted `qualityTier`). `resolveQualityTier(streams, tier)` maps intent → whatever rendition a given stream actually offers (adaptive `abr` special-cased; concrete renditions ordered by resolution parsed from the name; `full`/`source` = top). Stream cards are single-click; there is a Quality dropdown next to Protocol in the drawer.
- **Sticky "ended" streams:** `reconcileSelection()` runs each poll — if the playing stream vanishes it's kept as `endedSelection` (shown greyed in the selector, playback stops) and auto-resumed with the same quality/protocol when it reappears.
- **Stream/quality/protocol types are the source of truth in `BamApi.tsx`** (`StreamMap` → `StreamQualityMap` → `StreamProtocolUrlMap`; protocols `llhls`, `hls`, `webrtc-udp`, `webrtc-tcp`). Every playback URL is individually token-signed by the middleware. `StreamSpec` also carries source `video`/`audio` metadata (res, fps, codec, bitrate, channels, samplerate) used by the stats HUD.
- **Idle/placeholder stream** (`availableStreams.idleStream`) is a `StreamSpec` like any other — `resolveIdleSelection(idleStream, qualityTier)` runs it through the same `resolveQualityTier` as real streams and picks whichever protocol the server listed first (server prefers `hls` over `llhls` when both exist, for lower idle-viewer request volume). Returns `null` when unconfigured or no tier exists yet; the 🚂 drawer checkbox is hidden entirely in that case.

### Player (`OvenPlayer.tsx`)
React wrapper around the imperative OvenPlayer library — the most fragile part; preserve its workarounds and comments.
- Props mirror OvenPlayer events as `on*` callbacks, held in refs so the player isn't re-created.
- Source changes load a dummy `mp4` then the real source; WebRTC needs a manual `loading` transition. Idle/placeholder (`startAtLiveEdge`) seeks to the live edge (`player.getDuration()`, the seekable range's end) once playing — since the source is genuinely live (OME schedule/DVR), that lands every viewer on the same real moment, looking arbitrary only because it depends on when they tuned in. (Previously seeked to `Date.now() % duration`, which never actually synced anyone: `getDuration()` on a live source is the DVR window size, not a fixed content length, so it drifts per client/per-poll.)
- **Rebuild-on-source-change is now a React `key`** (`sourceKey` in `App`), not the old `rebuildOvenPlayer` state. `reloadNonce` triggers an in-place source reload for retries **without** unmounting the player (avoids a video blink) — driven by `usePlayerRetry` during OME's readiness window.
- Exposes `onHlsPrepared` (hls.js object → bandwidth estimate) and `onPeerConnectionPrepared`/`onPeerConnectionDestroyed` (raw `RTCPeerConnection` → `getStats()`), consumed by the stats HUD.
- Logout does a full `window.location.reload()` (the player dislikes being torn down).

### App shell (`App.tsx`)
Still the main stateful component but decomposed: state persistence via `usePersistedState`, stream store via `useStreamManager`, readiness retry via `usePlayerRetry`, crash isolation via `ErrorBoundary`. Derived state (`sourcesList`, `chromecastStream`) via `useMemo`. The MUI `Drawer` (anchored top) is the control panel — Protocol + Quality dropdowns, 🚂/📺/🎨/📊 toggles, volume; open/close driven by mouse-idle timers and "needs" conditions (no stream, casting, error).

### Stats HUD (`StatsHud.tsx`)
📊 toggle → bottom-left on-video overlay, two columns: **Bron** (source, from `StreamSpec.video`/`audio` metadata) vs **Nu** (live). Live numbers are captured into refs (quality/buffer via OvenPlayer events; hls.js object; `RTCPeerConnection`) and **polled at 1 Hz inside the HUD** so telemetry never re-renders `App`. WebRTC live bitrate/fps/resolution come from `pc.getStats()` (inbound-rtp; resolution falls back to the `<video>` element for Firefox). No `backdrop-filter` — it forced the video off the hardware-overlay path and dimmed the whole frame.

### Chromecast (`Chromecast.tsx`)
Custom receiver app + custom message namespace `urn:x-cast:nl.testmerrie`. Handshake sends `getSupportedFormats`, then `play`; downgrades WebRTC → LLHLS when the Chromecast can't do `H265/1080/60`. `ChromecastSupport` (provider) wraps the app; `ChromecastButton` consumes it. Local playback pauses while casting.

## Conventions

- `.tsx` even for logic-only modules that started as components (`BamApi.tsx`, `config.tsx`); plain logic is `.ts` (`StreamManager.ts`, `FormatUtil.ts`, the hooks).
- Domain types (stream/protocol/quality) live in `BamApi.tsx` and are imported widely — change them there.
- Ambient/library types: `src/ovenplayer.d.ts` is the **authoritative** OvenPlayer module declaration (`@types/ovenplayer` was removed — it conflicts under TS 5). Also `src/vite-env.d.ts`.
- Theme is MUI dark mode (`src/theme.ts`); snackbars via `notistack`.
- Tests are colocated `*.test.ts` (vitest + Testing Library, jsdom): `StreamManager`, `BamApi`, `usePersistedState`, `usePlayerRetry`, `FormatUtil`. Add tests for new store/hook logic and keep `npm run check` green.

## Refactor status (for context)

The phased modernization is **complete**: **Phase 1** server-side cookie auth · **Phase 2** ejected-CRA → Vite/TS5 · **Phase 3** React 18→19 + MUI 5→9 + notistack 2→3 (done 2026-08-19) · **Phase 4** App decomposed into hooks + StreamManager store · **Phase 5** player rebuild de-tangled (React key). Plus features: HLS protocol option, readiness retry + ErrorBoundary, sticky-ended streams, global quality tiers, stats HUD, nginx gzip, vendor-chunk split, idle-loop quality tiers + HLS (lower idle request volume) + live-edge sync.

**StrictMode is intentionally off.** It's dev-only (no prod effect); it was trialled during Phase 3 and caught a real auth-callback idempotency bug (now fixed in `BamApi`), but the imperative OvenPlayer wrapper doesn't survive its double-mount (create→destroy→create with preserved state → black video). Don't re-enable `<StrictMode>` without first making `OvenPlayer.tsx`'s destroy/recreate path survive a same-instance remount.

Deeper future idea: a slim custom OvenPlayer build (it's ~half the JS).
