# Carrot Patch Clicker — Design Document

This is the north star. When a change is proposed, it gets checked against this
document; when a rule or number in the game changes, this document changes in
the same commit. If the game surprises a player and the surprise isn't
explained here, that's a bug in this document.

## Vision

**Everyone on Earth shares one carrot patch.** There is a single global
garden: one carrot bank, one set of buildings, one prestige count. Every
click by anyone clicks for everyone. When someone buys a Greenhouse, the
whole world owns that Greenhouse. When someone sends the garden to seed,
the whole planet prestiges and everyone keeps the seeds. There are no
per-player resources — the fun is watching the garden grow *because* of
strangers, and doing your part.

## Principles

Numbered so they can be cited in reviews ("this violates P4").

- **P1 — One world.** All game state is global and shared. No per-player
  banks, buildings, or seeds. A feature that gives one player something the
  others don't have is out of scope.
- **P2 — The server is the only truth.** Clients send *intents* (clicks,
  buy, upgrade, catch, prestige); only the server mutates state. Anything a
  client computes locally is a prediction for feel, and gets overwritten by
  the next server snapshot.
- **P3 — No hidden rules.** Every limit, cap, rate, and magic number lives
  in the [Tunables](#tunables--limits) table below with its value, its
  location in code, and its reason. A player who wonders "why did X happen?"
  must be able to find the answer here. Changing a number without updating
  this table fails review.
- **P4 — Auto-clickers are gardeners too.** We do not fight fast clickers
  with punitive caps — in a shared garden, a fast clicker helps everyone.
  Instead, the *economy* makes raw clicking fade: click power grows roughly
  linearly while building CpS grows exponentially, so past the early game a
  click is a rounding error. Clicking comes back only through deliberate
  combos (CpS-percentage click upgrades × Rabbit Frenzy), which is a reward
  for engaging with the systems, not for clicking hard. The only click limits
  the server keeps are anti-flood protections generous enough that no human
  or reasonable auto-clicker ever hits them.
- **P5 — Open the page, see the world.** The moment a client connects (or
  reconnects, or wakes from sleep), it must show current world state. A
  browser displaying stale state while believing it's connected is a bug,
  full stop. Staleness must be detected and resolved by re-syncing, and the
  connection status must always be visible to the player.
- **P6 — Solo mode is a fallback, never a surprise.** Opening the page
  without a reachable server runs a private single-player garden
  (localStorage). The UI must make unmissable which mode you're in — two
  players comparing numbers should immediately see if one of them is
  actually alone.

## How the game plays (intended arc)

1. **Early game (minutes):** clicking dominates. Base click = 1 carrot;
   Window Boxes cost 15. Every clicker matters to the world total.
2. **Mid game (hours):** buildings take over. CpS grows exponentially with
   the 1.15× cost curve and doubling tiers; a click without upgrades is
   worth a fraction of a second of passive income. This is the P4 point
   where "clicking means nothing."
3. **Click renaissance (deliberate):** the `cpsPct` click upgrades
   (Grandma's Trowel +1% CpS/click, Green Thumbs +2%) tie click power back
   to CpS, and Rabbit Frenzy (×7, 30s) multiplies it. Stacking these is the
   sanctioned "auto-clicker returns" combo, Cookie Clicker style.
4. **Prestige:** seeds = ⌊√(lifetime harvest / 1e6)⌋, each +8% production
   forever. **Going to seed resets the whole world's run** — it's a global,
   dramatic, communal decision. Seeds and ribbons persist forever.
5. **The golden rabbit is global:** one rabbit for the whole planet, first
   click on Earth catches it, everyone gets the reward.

## Architecture

```
src/ (vanilla JS, no deps)          carrot_patch/ (FastAPI)
┌──────────────────────────┐        ┌────────────────────────────┐
│ core.js   game economy   │  intents (ws) │ main.py  connections, loop │
│ ui.js     canvas + DOM   │ ─────────────►│ economy.py  Python port of │
│ net.js    patch client   │ ◄───────────— │             core.js        │
│ data.js   all content    │  snapshot 1/s └────────────────────────────┘
└──────────────────────────┘                        │
        build.js bundles src/ → carrot_patch/dist/  ▼
        (data.js → patch-data.json, shared by both) patch_state.json
```

- The economy exists twice (JS for solo/prediction, Python for the world).
  Both read the same `patch-data.json`; `tests/test_patch.py` asserts the
  two implementations stay numerically identical.
- Protocol: client → server `{type: clicks|buy|upgrade|catch|prestige, …}`;
  server → client `snapshot` (full state, 1/s), `toast`, `rabbit`.
- Clicks apply locally the instant you click (feel), accumulate in a
  counter, and flush as **one message per second**. The next snapshot
  overwrites the local prediction.

## Saving, loading, and sync

| What | Where | When | Format |
| --- | --- | --- | --- |
| **World state** (the real game) | `carrot_patch/patch_state.json`, or the `CARROT_PATCH_STATE` env var (point it at a persistent volume in Docker) | Every 30 s, plus on prestige and on server shutdown; written atomically (tmp file + rename) | JSON via `economy.serialize()` |
| **Solo save** (fallback mode only) | Browser `localStorage`, key `carrot-clicker-save` | Every 15 s, on tab hide, on page close | JSON via `core.serialize()` |

- **Connecting to the patch = loading.** The server sends a full snapshot
  the moment you connect and every second after; your display is always at
  most ~1 s behind the world. If the socket dies silently (laptop sleep,
  dropped Wi-Fi), the client watchdog notices the missing heartbeat within
  ~5 s — or the instant the tab becomes visible again — and redials, which
  re-syncs by design (R1).
- Once a client has connected to the patch, it **stops writing localStorage**
  so world state never overwrites your private solo save. The two gardens
  are separate; there is deliberately no merging of solo progress into the
  world.
- **Server downtime ≠ lost growth:** on restart the server simulates the
  time it was down at full CpS, capped at 24 h.
- **Solo offline earnings:** solo mode earns at half CpS while closed,
  capped at 8 h. (Patch mode needs no offline earnings — the world keeps
  running on the server whether you're there or not.)

## Tunables & limits

Every deliberately chosen number, per P3. "Why" is the design reason, not a
restatement of the value.

| Name | Value | Where | Why |
| --- | --- | --- | --- |
| Click batch flush | 1 msg/s | `src/net.js` | An auto-clicker costs the same bandwidth as a patient human; the server never sees individual clicks. |
| Max clicks per batch | **40** ⚠ | `carrot_patch/main.py` `MAX_CLICKS_PER_MSG` | **Deprecated by P4** — this is a gameplay cap masquerading as flood protection, and it silently ate fast clickers' clicks. Slated to become a pure anti-flood ceiling of **250 clicks/batch** (~250 cps — far above any human, high enough that auto-clickers work as intended; see R2). |
| Min interval between click batches | 0.75 s | `carrot_patch/main.py` `MIN_MSG_INTERVAL` | Tolerates client timer jitter on the 1 s flush without allowing double-rate senders. |
| Max messages/sec per connection | 10 | `carrot_patch/main.py` `MAX_MSGS_PER_SEC` | Pure flood guard across all message types; normal play sends ~1–3/s. |
| Max message size | 512 bytes | `carrot_patch/main.py` | No legitimate intent is bigger; drops garbage cheaply. |
| Snapshot broadcast | 1/s | `carrot_patch/main.py` `SNAPSHOT_INTERVAL` | Fast enough to feel live, cheap enough for many clients; also the world tick rate. |
| World autosave | 30 s | `carrot_patch/main.py` `SAVE_INTERVAL` | Bounds loss on a crash to 30 s of a garden that regrows it in 30 s anyway. |
| Server-down catch-up | full CpS, cap 24 h | `carrot_patch/economy.py` | Downtime shouldn't punish the world; the cap stops a year-old save from minting absurdity. |
| Solo autosave | 15 s + on hide/close | `src/ui.js` | localStorage is cheap; losing more than 15 s feels bad. |
| Solo offline earnings | 50% CpS, cap 8 h | `src/core.js` | Rewards returning without making leaving optimal. Solo only. |
| Building cost curve | ×1.15 per owned | `src/core.js` / `economy.py` | Genre-standard geometric ramp (same as Cookie Clicker). |
| Seed formula | ⌊√(lifetime/1e6)⌋ | `src/core.js` / `economy.py` | First seed at 1M lifetime carrots; square root keeps late seeds meaningful but not runaway. |
| Seed bonus | +8%/seed, forever | `src/core.js` / `economy.py` | Big enough that a world prestige feels worth the reset. |
| Rabbit spawn gap | 60–150 s first, then 90–240 s | `carrot_patch/main.py` | One shared rabbit; scarce enough to be an event, common enough to matter. |
| Rabbit lifetime | 12 s | `carrot_patch/main.py` | First-click-on-Earth race needs a real window across time zones and reflexes. |
| Frenzy | ×7 for 30 s | `src/core.js` / `economy.py` | The click-renaissance enabler (P4/arc §3). |
| Reconnect retry | every 4 s (forever, once ever connected); 3 tries then solo toast (never connected) | `src/net.js` | A restarting server should reclaim its players; plain static hosting shouldn't poll forever — and going solo is announced, never silent (P6). |
| Staleness threshold | 5 s without any server message | `src/net.js` `CC.PATCH_STALE_MS` | The server heartbeats a snapshot every 1 s, so 5 s of silence means the socket is dead even if the browser doesn't know it (half-open TCP). Redialing re-syncs (P5). |
| Watchdog cadence | every 2 s, plus on tab-becomes-visible | `src/net.js` | Frequent enough to catch staleness fast while foregrounded; the visibility hook covers waking from sleep, when background timers were throttled. |

## Known gaps & roadmap

Numbered for reference. R2 and R7 are the active priorities.

- **R1 — Staleness detection & re-sync. ✅ Shipped.** If the WebSocket dies
  *silently* (laptop sleep, dropped Wi-Fi — TCP half-open, so `onclose`
  never fires), the client used to believe it was connected and display
  frozen state indefinitely, violating P5. Now a watchdog redials whenever
  no server message arrives for 5 s (checked every 2 s and on
  `visibilitychange → visible`), the patch line shows "re-syncing…" while
  disconnected instead of pretending to be solo, and a client that never
  finds a server announces solo mode with a toast (P6).
- **R2 — Retire the 40-click cap.** Replace `MAX_CLICKS_PER_MSG = 40` with
  an anti-flood-only ceiling of 250, per P4. Mirror the new number in this
  table and in the in-game help (R4).
- **R3 — Unmissable mode indicator.** PATCH vs CLICKER wordmark + a status
  line exist but are subtle. Make connection state (connected / re-syncing /
  solo) explicit in the UI, so nobody plays solo for a week thinking
  they're behind the world.
- **R4 — Rules visible in-game.** A "how the patch works" panel (batching,
  what's shared, where saves live, the click curve) so players don't need
  the repo to understand the game. This document is the source; the panel
  summarizes it.
- **R5 — "While you were away" for the patch.** On reconnect, show what the
  world did since your last snapshot ("the garden grew 4.2M carrots and
  someone bought Free-Range Carrots"). Needs the client to remember its
  last-seen state; cosmetic, but makes P5 feel good instead of just correct.
- **R6 — Presence & contribution flavor.** Optional, P1-compatible only:
  ephemeral per-session stats ("you clicked 312 times this visit") and
  richer "someone bought…" attribution. No persistent per-player state.
- **R7 — Guard against split-brain worlds.** The world lives in the memory
  of one server process. If a host runs multiple workers (`uvicorn
  --workers N`, gunicorn), each worker silently grows its *own* garden and
  they take turns clobbering the same save file — two players can both be
  "connected" yet see completely different worlds (e.g. 4 seeds vs 69).
  This violates P1 and is invisible to players. Deploys must run a single
  worker (now documented in the README); the guard to add: the server
  writes a random world-instance id into the save and refuses to start (or
  loudly warns) when it detects another live process owning the same state
  file, plus the instance id in `/api/state` so a mismatch is diagnosable.

## Process for changing the game

1. Numbers/content: edit `src/data.js`, run `node build.js` (regenerates
   `patch-data.json` — both languages pick it up by construction).
2. Formulas: edit `src/core.js` **and** mirror in `carrot_patch/economy.py`
   — `python tests/test_patch.py` (parity suite) fails until they match.
3. Server behavior/limits: edit the constants at the top of
   `carrot_patch/main.py`.
4. **Update the Tunables table and, if principles are affected, this whole
   document — in the same commit.** (P3.)
5. Run both suites: `node tests/sim.js` (pacing: asserts the unlock/prestige
   curve over simulated 4-hour sessions) and `python tests/test_patch.py`
   (parity + live websocket protocol).

### The build id

Every build embeds a 7-character content hash of all deployable sources
(`src/*`, `carrot_patch/*.py`, `build.js`). `node build.js` prints it, and
the page shows it bottom-right — its whole job is answering "did the
deploy land?" at a glance: after the host pulls and restarts, refresh and
see the tag change. Determinism constraint: **nothing time- or
git-dependent may ever go into `dist/`** — CI rebuilds dist and requires a
byte-identical match with the commit, so the id must be a pure function of
the sources.
