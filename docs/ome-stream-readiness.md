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

## Current solution: `starting` flag + client hold-off (+ retry safety net)

### Middleware (`starting`)

`StreamsController` probes the first advertised LLHLS/HLS playlist on the local
OME origin (`originPublishUrl`, default `http://127.0.0.1:3333` — bypasses nginx
auth). While that probe is non-200, the stream is listed with:

- `starting: true`
- no `thumbnail` URL (thumbnail encode lags the playlist; advertising it only
  produces a broken card image)

Once the playlist returns 200, `starting` flips to `false` and the thumbnail is
advertised. Probe failures (timeout / connection) **fail open** (`starting:
false`) so a briefly unreachable origin doesn't freeze every card.

### Frontend

- **Hold off playback** while `starting`: keep the idle/placeholder playing (and
  show the global loading overlay); switch to the real source on the poll where
  `starting` becomes false. Auto-start can select the stream immediately without
  hitting the 404 window.
- **Stream card**: loading placeholder ("Wordt klaargemaakt…") instead of a
  thumbnail while starting.
- **Retry** (`src/usePlayerRetry.ts`): safety net if we still error after
  `starting` flips (race, #969 edge). Reloads the **same** quality/protocol with
  backoff (2s → 10s), for as long as the stream stays selected. Natural exits:
  playback recovers, user picks something else, or the stream vanishes
  (`reconcileSelection` → idle/placeholder).
- **Error boundary** (`src/ErrorBoundary.tsx`): any render/lifecycle throw
  degrades to a reloadable fallback instead of a white screen.

Key invariant: **never silently change the user's quality or protocol to get
something playing sooner.** Their choice is sticky; we wait/retry it.

## Deferred: OME Alert readiness gate

Push-based alternative (no per-poll HEAD). OME's Alert module is **documented
only for Ingress rules**; the binary also contains `EGRESS_LLHLS_READY` /
`EGRESS_HLS_READY` strings, but those aren't a supported Alert rule surface in
current docs — so playlist probing is the reliable gate we ship. If a future OME
exposes a queryable ready flag or a documented egress Alert, swap the probe for
that and keep client retry as the floor.

Refs: [Alert module](https://ovenmedia.com/docs/ome/alert) ·
[HLS first-segment behavior](https://docs.ovenmediaengine.com/streaming/hls) ·
[#969 (404 after reconnect)](https://github.com/AirenSoft/OvenMediaEngine/issues/969)
