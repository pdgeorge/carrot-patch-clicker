# 🥕🌍 Carrot Patch Clicker

One shared carrot garden for the whole world. Every click by anyone, anywhere,
clicks for everyone — and everyone spends the same global carrot bank on
Window Boxes, Rabbit Union contracts, and eventually the Carrot Singularity.
Buildings, upgrades, golden-rabbit rewards, and prestige are all global: if
someone buys it or wins it, the whole planet has it.

**[DESIGN.md](DESIGN.md) is the north star** — the vision, the principles,
and (per principle P3) a table of **every limit and magic number in the
game**, with its value, location, and reason. If a rule surprised you
("why does that player have so many carrots?"), the answer must be findable
there; if it isn't, that's a bug — file it.

This repo is fully self-contained: the browser game, the authoritative
FastAPI world server, the build script, and the test suites. It is designed
to be **cloned into a host website as a plugin** — the host just checks the
folder exists and mounts it. Contributors can change everything about the
game without ever touching the host site.

## Play / develop locally

```bash
node build.js                              # src/ → carrot_patch/dist/
pip install -r requirements.txt
uvicorn carrot_patch.main:app --port 8420  # world server at http://localhost:8420
```

Opening `carrot_patch/dist/clicker.html` as a plain file also works — the
game detects there's no server and runs single-player (localStorage saves).

`node build.js` prints a 7-char **build id** (a content hash of all game
sources) and the page shows the same id bottom-right. To confirm a deploy
landed: merge, `git pull` + restart on the host, refresh — the tag changes.

## Embedding in a host FastAPI site

```python
# host app.py — plugin discovery: mounted only if the clone exists
carrot = Path(__file__).parent / "carrot-patch-clicker"
if (carrot / "carrot_patch" / "main.py").exists():
    import sys
    sys.path.insert(0, str(carrot))
    from carrot_patch.main import create_app as create_carrot_patch
    app.mount("/carrot-patch", create_carrot_patch())
```

Docker hosts should volume-mount the clone (updates = `git pull` + container
restart, no rebuild) and point world-state at a persistent volume:

```yaml
volumes:
  - ./carrot-patch-clicker:/app/carrot-patch-clicker:ro
environment:
  CARROT_PATCH_STATE: /data/carrot_patch.json
```

Env vars: `CARROT_PATCH_STATE` (world save file), `CARROT_PATCH_DIST`
(client dir; auto-detected by default).

> ⚠ **Run a single worker.** The world lives in the memory of one process.
> With `uvicorn --workers N` (or gunicorn multi-worker), each worker grows
> its **own separate garden** and they clobber each other's saves — players
> land on different workers and see different worlds while all believing
> they're "connected". Also make sure your reverse proxy forwards WebSocket
> upgrades (nginx: `proxy_set_header Upgrade/Connection`), or every player
> silently ends up in single-player. See [DESIGN R7](DESIGN.md#known-gaps--roadmap).

## How the multiplayer works

- **Server-authoritative.** Clients send intents (`clicks`, `buy`, `upgrade`,
  `catch`, `prestige`); `carrot_patch/economy.py` — a Python port of the JS
  core, fed from the same `patch-data.json` — is the only thing that mutates
  state. Snapshots broadcast to every client once per second, including a
  full one the moment you connect — connecting **is** loading.
- **Auto-clickers are welcome** (DESIGN principle P4). Clients batch clicks
  into one message per second, so fast clicking costs no extra bandwidth.
  The economy — not a cap — is what makes raw clicking fade in the mid game
  (and come back via the CpS-click-upgrade + frenzy combo). ⚠ The server
  currently still clamps at 40 clicks/connection/sec; that cap is deprecated
  and slated to become a 250/s anti-flood ceiling (DESIGN R2).
- **The golden rabbit is global** — first gardener on Earth to click it wins
  the frenzy for everyone.
- **Go to Seed prestiges the entire planet.** The confirmation dialog is
  appropriately dramatic. Seeds and ribbons persist forever.

All rate limits and game numbers are documented in the
[Tunables table in DESIGN.md](DESIGN.md#tunables--limits).

## Where the game is saved

- **World state** lives on the server in `carrot_patch/patch_state.json`
  (override with `CARROT_PATCH_STATE`, e.g. a Docker volume). Autosaves
  every 30 s (atomic write), plus on prestige and shutdown. If the server
  is down a while, the garden catches up on restart (capped at 24 h).
- **Solo mode** (no server reachable) saves to browser localStorage
  (`carrot-clicker-save`) every 15 s and on tab close/hide, with offline
  earnings at half rate capped at 8 h. Once you've connected to the patch,
  the client stops touching localStorage so your solo garden is preserved —
  the two gardens never merge.
- **Silent disconnects self-heal** (DESIGN R1): the server heartbeats a
  snapshot every second, so if nothing arrives for 5 s — or the tab wakes
  from sleep — the client redials and re-syncs automatically, showing
  "re-syncing…" in the patch line meanwhile. A client that never finds a
  server says so with a toast before settling into solo mode.

## Tests — run both before PRing

```bash
node tests/sim.js            # game pacing: auto-plays 4-hour sessions,
                             # asserts the unlock/prestige curve
python tests/test_patch.py   # JS<->Python economy parity + live websocket
                             # protocol tests (needs fastapi installed)
```

The parity suite is what lets the economy live in two languages: if you
change game numbers in `src/data.js`, run `node build.js` (regenerates
`patch-data.json`) and both sides stay identical by construction. That
includes gating: upgrades take a declarative `unlock: [...]` list (own N
of a building, lifetime harvest, seeds, clicks, other upgrades — see
[Unlock conditions in DESIGN.md](DESIGN.md#unlock-conditions)), so new
content — however it's gated — is a `data.js`-only change. If you
change **formulas** in `src/core.js`, you must mirror the change in
`carrot_patch/economy.py` — the parity test will fail until you do.

## Layout

- `src/` — the browser game (vanilla JS + canvas, no dependencies)
- `build.js` — bundles `src/` → `carrot_patch/dist/`
- `carrot_patch/` — the Python world server (FastAPI + WebSocket)
- `carrot_patch/dist/` — built client + game data (committed, so hosts
  don't need node)
- `tests/` — pacing sim (node) and parity/protocol suite (python)
- `docs/` — reports and audits, e.g. [what-lives-where.md](docs/what-lives-where.md)
  (where each subsystem *actually* lives vs. where DESIGN.md says it should)

Extracted from the [Carrot-simulator](../Carrot-simulator) project's
`carrot-clicker-simulator` branch, where this game was first grown.
