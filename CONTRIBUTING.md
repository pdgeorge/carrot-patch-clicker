# Contributing to Carrot Patch Clicker 🥕

Everyone on Earth shares one carrot patch — and that includes the code. Contributions are welcome from anyone, and gardeners who grow the garden get their name on the in-game community noticeboard (see [Add yourself to the noticeboard](#add-yourself-to-the-noticeboard)).

**Read [DESIGN.md](DESIGN.md) first.** It is the north star: the vision, the numbered principles (cite them in reviews — "this violates P4"), and the table of every limit and magic number in the game. PRs are checked against it.

## The three rules CI enforces

Every PR runs CI (build check, pacing simulation, economy parity + protocol suite). These are the things that will actually fail your PR, so know them up front:

1. **Never edit `carrot_patch/dist/` by hand.** It is built output. Edit `src/` (or the Python server), run `node build.js`, and commit the rebuilt `dist/` in the same commit. CI rebuilds from source and fails if the committed `dist/` doesn't match.
2. **Changed a number? Update DESIGN.md in the same commit** (principle P3). Every cap, rate, and magic number lives in the Tunables table with its value, location, and reason. A number change without the matching table edit fails review.
3. **The economy has two brains that must agree.** Game math lives in `src/core.js` (JS engine) *and* `carrot_patch/economy.py` (Python server), kept honest by the parity suite. If you change the economy, change both — `tests/test_patch.py` runs the same scripted game in each and fails on any drift.

## How to submit a change

You don't need any permissions — the standard GitHub fork workflow works for everyone:

1. Fork this repo on GitHub.
2. `git clone` your fork and create a branch: `git checkout -b my-feature`.
3. Make your change, run the build and tests (below), commit.
4. `git push -u origin my-feature`, then open a pull request against `main` here.

`main` is protected — everything lands through a PR. First-time contributors will see CI wait for maintainer approval before running; that's a GitHub safety default, not a snub. Keep PRs small and focused: one idea per PR reviews fast.

## Develop locally

```bash
./serve.sh start      # build client + world server at http://localhost:8420 (creates .venv on first run)
./serve.sh restart    # stop (world saves), rebuild, start — your edit-test loop
./serve.sh status     # pid, build id, live /api/state probe
./serve.sh wipe       # fresh local garden
```

Or by hand: `node build.js`, `pip install -r requirements.txt`, `uvicorn carrot_patch.main:app --port 8420`.

Opening `carrot_patch/dist/clicker.html` as a plain `file://` page runs the **dev garden** — a private single-player sandbox for UX work, no server needed. A served page is always the shared world (P6). `?grant=N` in the dev garden gives free carrots for testing.

## Run the tests before pushing

```bash
node build.js                     # dist must be fresh and committed
node tests/sim.js                 # pacing: a greedy bot plays hours, asserts the fun curve
pip install -r requirements.txt httpx
python tests/test_patch.py        # JS↔Python economy parity + live websocket protocol
```

This is exactly what CI runs, so green here means green there.

## Where things live

Full census in [docs/what-lives-where.md](docs/what-lives-where.md); the short version:

| You want to… | Edit |
| --- | --- |
| Add/rebalance buildings, upgrades, ribbons, almanac pages, news lines | `src/data.js` (content — the easiest PRs) |
| Change game rules or math | `src/core.js` **and** `carrot_patch/economy.py` (the parity pair) |
| Change looks, sound, feel, words on screen | `src/page.html`, `src/styles.css`, `src/ui.js` (the skin) |
| Change networking or the server | `src/net.js` ↔ `carrot_patch/main.py` |

The layering law: **the server is the only truth** (P2) — clients send intents, only the server mutates state. **The skin never decides game rules** — if your UI change needs an `if` about how the game works, that logic belongs in the engine pair. And **one world** (P1): features that give one player something others don't are out of scope.

## Add yourself to the noticeboard

Add your name to [`contributors.txt`](contributors.txt) (one name per line) **in the same PR as your contribution**. Gardeners are rendered on the in-game community noticeboard for the whole world to see — it's the closest thing the garden has to a credits screen.

## Questions and ideas

Open an issue. Game-design ideas get weighed against [DESIGN.md](DESIGN.md)'s vision and principles — reading it first makes the conversation much faster; the remaining roadmap lives in [PLANNED_FEATURES.md](PLANNED_FEATURES.md). If the game ever surprises you and DESIGN.md doesn't explain why, that's a bug worth filing on its own.
