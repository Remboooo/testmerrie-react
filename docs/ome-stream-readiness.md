# Stream readiness handling

## The problem

A stream appears in `GET /api/v1/streams` (and therefore in the stream selector,
with all its qualities/protocols) as soon as OME knows the ingest exists — but the
playback URLs **404 for a short window** afterwards, until OME has produced the
first full segment.

- **Fresh start:** a few seconds (measured ~1s locally with a trivial source;
  longer for real encoders / higher `Preset` / bigger GOP).
- **Reconnect (stop → restart the same stream):** materially worse. This is a
  confirmed-but-unfixed OME bug, [AirenSoft/OvenMediaEngine#969](https://github.com/AirenSoft/OvenMediaEngine/issues/969),
  where the playlist can 404 for up to ~a minute after a restart.

Playing during that window → the player errors → the app used to show the terminal
"something went wrong" overlay immediately (and possibly white-screen on
end→restart→reselect).

Note: the URLs are never *missing* — the middleware lists every quality/protocol
from OME's static config, so the strings are always present; they just 404 until
ready. So this is a **readiness** problem, not a bad-fallback / undefined-URL
problem.

## Current solution: client-side retry (+ error boundary)

- **Retry** (`src/usePlayerRetry.ts`): a player error on a *real* selection is
  treated as transient — the player is reloaded on the **same quality/protocol**
  (never substituted), shown as *loading*, for a budget (~16s). Only after the
  budget is exhausted do we show the terminal error. This is the only approach
  robust to the #969 reconnect window, and needs no OME/middleware changes.
- **Error boundary** (`src/ErrorBoundary.tsx`): a top-level boundary so that *any*
  render/lifecycle throw (e.g. a player edge case) degrades to a graceful,
  reloadable fallback instead of a white screen.

Key invariant: **never silently change the user's quality or protocol to get
something playing sooner.** Their choice is sticky; we retry it.

## Deferred / future improvement: OME Alert readiness gate

The cleaner-in-theory option, deliberately deferred as too thorny/brittle for now.

OME's **Alert module** can push HTTP notifications on stream lifecycle events. Our
OME **0.20.0 build has these compiled in** (verified via `strings` on the binary):
`EGRESS_STREAM_CREATED`, `EGRESS_STREAM_PREPARED`, **`EGRESS_LLHLS_READY`**,
**`EGRESS_HLS_READY`**, `EGRESS_STREAM_DELETED`, and various failure states. The
`*_READY` events are almost certainly the "playlist is now servable" signal.

A readiness gate would look like:
1. `Server.xml`: add an `<Alert>` block (`<Url>` pointing at the middleware,
   `<SecretKey>`, Egress readiness rules) — requires an OME restart.
2. Middleware: a new endpoint that receives Alert POSTs and tracks per-stream
   readiness (`LLHLS_READY` / `HLS_READY` / `DELETED`) in memory.
3. Middleware: only list a stream (or a protocol) in `/v1/streams` once it's READY.

Result: streams would appear already-playable and the readiness window would be
invisible to users.

**Why deferred:**
- It's **push-only** (no queryable "is it ready" REST field in 0.20.0 — the
  `codecStatus` field newer docs mention is not in this build, and even that
  reflects codec readiness, not segment/playlist readiness).
- It makes the middleware a **stateful notification receiver** — more moving
  parts, more failure modes, and cross-repo + OME-restart coordination.
- A retry is needed **anyway** as a safety net for the #969 reconnect window.

If revisited, keep the retry as the floor and layer the Alert gate on top.

Refs: [Alert module](https://ovenmedia.com/docs/ome/alert) ·
[HLS first-segment behavior](https://docs.ovenmediaengine.com/streaming/hls) ·
[#969 (404 after reconnect)](https://github.com/AirenSoft/OvenMediaEngine/issues/969)
