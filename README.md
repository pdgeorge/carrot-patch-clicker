# 🥕🌍 Carrot Patch Clicker

One shared carrot garden for the whole world. Every click by anyone, anywhere,
clicks for everyone — and everyone spends the same global carrot bank on
Window Boxes, Rabbit Union contracts, and eventually the Carrot Singularity.

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

## How the multiplayer works

- **Server-authoritative.** Clients send intents (`clicks`, `buy`, `upgrade`,
  `catch`, `prestige`); `carrot_patch/economy.py` — a Python port of the JS
  core, fed from the same `patch-data.json` — is the only thing that mutates
  state. Snapshots broadcast to every client once per second.
- **Auto-clicker-proof.** Clients batch clicks into one message per second;
  the server clamps to 40 clicks/connection/sec, one batch per 0.75 s, and
  10 messages/sec per connection.
- **The golden rabbit is global** — first gardener on Earth to click it wins
  the frenzy for everyone.
- **Go to Seed prestiges the entire planet.** The confirmation dialog is
  appropriately dramatic. Seeds and ribbons persist forever.
- World state saves every 30 s; if the server is down a while, the garden
  catches up on restart (capped at 24 h).

## Tests — run both before PRing

```bash
node tests/sim.js            # game pacing: auto-plays 4-hour sessions,
                             # asserts the unlock/prestige curve
python tests/test_patch.py   # JS<->Python economy parity + live websocket
                             # protocol tests (needs fastapi installed)
```

The parity suite is what lets the economy live in two languages: if you
change game numbers in `src/data.js`, run `node build.js` (regenerates
`patch-data.json`) and both sides stay identical by construction. If you
change **formulas** in `src/core.js`, you must mirror the change in
`carrot_patch/economy.py` — the parity test will fail until you do.

## Layout

- `src/` — the browser game (vanilla JS + canvas, no dependencies)
- `build.js` — bundles `src/` → `carrot_patch/dist/`
- `carrot_patch/` — the Python world server (FastAPI + WebSocket)
- `carrot_patch/dist/` — built client + game data (committed, so hosts
  don't need node)
- `tests/` — pacing sim (node) and parity/protocol suite (python)

Extracted from the [Carrot-simulator](../Carrot-simulator) project's
`carrot-clicker-simulator` branch, where this game was first grown.
