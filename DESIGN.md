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

Numbered so they can be cited in reviews (EG: "this violates P4").

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
- **P6 — Solo is a dev tool, never a player state.** A served page
  (http/https) is *always* the world game: connected, re-syncing, or
  visibly reaching for the server — it never falls back to a private
  garden, no matter how long the server is unreachable. The private
  single-player garden (localStorage) exists only on `file://`, for
  development and for trying the repo without running the server. There is
  no legitimate scenario where a player *falls into* solo play; the
  one imaginable want — "keep playing my own branch while offline" — is a
  deliberate one-way fork a player would have to choose (R10, unscheduled),
  never a state they land in by accident.
- **P7 — Content is data; the engine is stable.** Moving the game forward
  (new upgrades, gates, buildings, flavor) happens in `src/data.js` alone;
  look-and-feel happens in `src/page.html` / `src/styles.css` / `src/ui.js`.
  The paired engines change rarely, and only to add *primitives* that
  content then combines declaratively (see [Unlock
  conditions](#unlock-conditions)). If adding one piece of content requires
  an engine edit, the engine is missing a primitive — add the primitive
  (mirrored in both languages, parity-tested), never a special case. And a
  boundary on P3: its transparency duty covers *system* rules (caps, rates,
  sync); content unlocks are allowed to be mysterious in-game — discovery
  is the fun, and `data.js` is public anyway.

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

The layers, and when each is allowed to change (P7):

| Layer | Files | Changes when |
| --- | --- | --- |
| **Content** | `src/data.js` | Any game-design change: buildings, upgrades, unlock gates, ribbons, news. Most PRs should live here. |
| **UX** | `src/page.html`, `src/styles.css`, `src/ui.js` | Look, feel, layout, juice. Never game rules. |
| **Engine** (paired) | `src/core.js` ↔ `carrot_patch/economy.py` | Rarely: a new mechanic or condition primitive. Every change is mirrored; the parity suite fails until both sides agree. |
| **Protocol** (paired) | `src/net.js` ↔ `carrot_patch/main.py` | Rarely: wire format, sync, limits. |

This table is the law; reality doesn't fully comply yet.
[docs/what-lives-where.md](docs/what-lives-where.md) is the standing
audit — a **report, not a law** — of where every subsystem actually lives
today, with the known violations ranked. Consult it before moving code
between layers, and update it in the same PR when you do.

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
| **Dev-garden save** (`file://` only) | Browser `localStorage`, key `carrot-clicker-save` | Every 15 s, on tab hide, on page close | JSON via `core.serialize()` |

- **Connecting to the patch = loading.** The server sends a full snapshot
  the moment you connect and every second after; your display is always at
  most ~1 s behind the world. If the socket dies silently (laptop sleep,
  dropped Wi-Fi), the client watchdog notices the missing heartbeat within
  ~5 s — or the instant the tab becomes visible again — and redials, which
  re-syncs by design (R1).
- On a served page, **localStorage is never read or written** — world state
  lives on the server, full stop. Before the first-ever snapshot the page
  shows "🌍 Reaching the carrot patch…" and ignores input (there is nothing
  real to act on yet); after that, disconnections keep the garden ticking
  as a labeled prediction until re-sync. The dev garden's localStorage save
  is untouched by world play, and there is deliberately no merging of dev
  progress into the world (P2 — it would be a cheat vector).
- **Server downtime ≠ lost growth:** on restart the server simulates the
  time it was down at full CpS, capped at 24 h.
- **Dev-garden offline earnings:** the `file://` garden earns at half CpS
  while closed, capped at 8 h. (The world needs no offline earnings — it
  keeps running on the server whether anyone's there or not.)

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
| Dev-garden autosave | 15 s + on hide/close (`file://` only) | `src/ui.js` | localStorage is cheap; losing more than 15 s feels bad. Never runs on a served page. |
| Dev-garden offline earnings | 50% CpS, cap 8 h (`file://` only) | `src/core.js` | Rewards returning without making leaving optimal. |
| Building cost curve | ×1.15 per owned | `src/core.js` / `economy.py` | Genre-standard geometric ramp (same as Cookie Clicker). |
| Seed formula | ⌊√(lifetime/1e6)⌋ | `src/core.js` / `economy.py` | First seed at 1M lifetime carrots; square root keeps late seeds meaningful but not runaway. |
| Seed bonus | +8%/seed, forever | `src/core.js` / `economy.py` | Big enough that a world prestige feels worth the reset. |
| Rabbit spawn gap | 60–150 s first, then 90–240 s | `carrot_patch/main.py` | One shared rabbit; scarce enough to be an event, common enough to matter. |
| Rabbit lifetime | 12 s | `carrot_patch/main.py` | First-click-on-Earth race needs a real window across time zones and reflexes. |
| Frenzy | ×7 for 30 s | `src/core.js` / `economy.py` | The click-renaissance enabler (P4/arc §3). |
| Reconnect retry | every 4 s, forever — served pages never give up and never fall back to solo | `src/net.js` | P6: a served page is always the world game. A restarting server, or a proxy that comes good, reclaims its players; until then the page visibly waits ("reaching the carrot patch…") rather than becoming a different game. |
| Staleness threshold | 5 s without any server message | `src/net.js` `CC.PATCH_STALE_MS` | The server heartbeats a snapshot every 1 s, so 5 s of silence means the socket is dead even if the browser doesn't know it (half-open TCP). Redialing re-syncs (P5). |
| Watchdog cadence | every 2 s, plus on tab-becomes-visible | `src/net.js` | Frequent enough to catch staleness fast while foregrounded; the visibility hook covers waking from sleep, when background timers were throttled. |

## Unlock conditions

The content-author's gating vocabulary (R8). Any data-defined upgrade
(click / global / synergy) may carry `unlock: [ ... ]` — a list of
conditions that **replaces** the type's default visibility rule; the
upgrade appears only when *every* condition holds:

| Condition | Meaning |
| --- | --- |
| `{ owned: i, n: N }` | own ≥ N of building index `i` (0 = Window Box, 1 = Garden Plot, …) |
| `{ lifetime: N }` | lifetime harvest ≥ N carrots |
| `{ seeds: N }` | seeds ≥ N |
| `{ clicks: N }` | lifetime clicks ≥ N (clicks survive prestige) |
| `{ bought: 'id' }` | another upgrade already bought |

Without `unlock`, defaults apply: click/global upgrades show at lifetime ≥
cost ÷ 4; synergy at `needTarget`/`needPer`; generated building tiers at
their owned-count. Unknown condition types **fail closed** (the upgrade
stays hidden), so a typo can't accidentally open a gate — and old servers
meeting future conditions hide rather than misbehave.

Keep this vocabulary small and boring: every primitive is implemented
twice (`condMet` in `core.js`, `cond_met` in `economy.py`) and
parity-tested. A handful of primitives combined in data covers enormous
design space; a bespoke primitive per upgrade would recreate hardcoding
with extra steps. New primitives are engine changes — mirror them, extend
the parity test, and add a row here in the same commit.

## Known gaps & roadmap

Numbered for reference. R2 and R7 are the active priorities.

- **R1 — Staleness detection & re-sync. ✅ Shipped.** If the WebSocket dies
  *silently* (laptop sleep, dropped Wi-Fi — TCP half-open, so `onclose`
  never fires), the client used to believe it was connected and display
  frozen state indefinitely, violating P5. Now a watchdog redials whenever
  no server message arrives for 5 s (checked every 2 s and on
  `visibilitychange → visible`), and the patch line shows "re-syncing…"
  while disconnected instead of pretending to be solo. (R1 originally also
  added a solo-fallback toast for never-connected clients; R9 removed the
  fallback itself.)
- **R2 — Retire the 40-click cap.** Replace `MAX_CLICKS_PER_MSG = 40` with
  an anti-flood-only ceiling of 250, per P4. Mirror the new number in this
  table and in the in-game help (R4).
- **R3 — Unmissable connection indicator.** The wordmark + status line
  exist but are subtle. Make connection state (connected / re-syncing /
  reaching) explicit in the UI. (R9 removed the worst case — a served page
  can no longer *be* solo — but "how live is what I'm seeing" should still
  be one glance.)
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
- **R8 — Declarative unlock conditions. ✅ Shipped.** Upgrades can be gated
  on anything (building counts, lifetime harvest, seeds, clicks, other
  upgrades) straight from `data.js` — see [Unlock
  conditions](#unlock-conditions). This is the enabling change for P7:
  content PRs combine primitives; nobody touches the engines. No existing
  upgrade's gate changed.
- **R9 — Solo demoted to dev tool. ✅ Shipped.** Served pages no longer
  fall back to a private garden under any circumstances: they redial
  forever, show "reaching the carrot patch…" (and ignore input) until the
  first snapshot, and never touch localStorage. The solo game survives only
  on `file://` as the dev garden. This rewrote P6 and made the
  which-game-am-I-playing class of incidents structurally impossible; it
  also defused the player-facing half of the census's F2 (the dev garden's
  divergent rabbit timing no longer affects anyone's comparison with the
  world).
- **R10 — Fork the garden (unscheduled, maybe never).** The one legitimate
  "solo" want: deliberately branching the world into a private offline
  sandbox. If ever built it must be an explicit choice with an explicit
  warning that the fork is **one-way** — private progress can never merge
  back into the world (P2: that's a cheat vector, not a feature).
- **R11 — The community noticeboard: Tenders & Gardeners.** A billboard in
  the UI, styled as a community noticeboard: left half **Tenders** — the
  people tending the garden, shown as `<name> <clicks>`, to encourage
  clicking and give regulars recognition; right half **Gardeners** — the
  people who grew the garden itself (contributors, from a credits list in
  `data.js`). Left/right because the Tenders board is alive and about its
  readers; the Gardeners half is a plaque. Design constraints settled up
  front:
  - **Recognition, never resources.** This is the first persistent
    per-player state, so the P1 boundary must hold: a name and a click
    tally confer zero gameplay effect. (Extends R6, which allowed only
    ephemeral stats.)
  - **Identity is opt-in.** Anonymous by default; a self-chosen display
    name (length-capped, server-validated) attached to click batches, with
    a moderation stance decided before shipping — names are visible to the
    whole world.
  - **Vocabulary migration:** the UI currently calls players "gardeners"
    ("N gardeners tending", rabbit toasts). Adopting Tenders/Gardeners
    means renaming that copy in the same PR, and revisiting the prestige
    modal's "Your name will not be recorded" flavor line, which this
    feature contradicts.
  - Needs a world-save format addition (per-name tallies) — additive field,
    old saves must load unchanged.

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
