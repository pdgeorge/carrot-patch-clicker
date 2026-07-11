# What Lives Where — a census of the codebase

**This is a REPORT, not a LAW.** [DESIGN.md](../DESIGN.md) is the law — it
says where things *should* live. This document says where things *actually*
live, including the places where reality is wrong and needs to move. A ❌
here is not an accusation, it's a work item. Expect this file to go stale;
re-audit it when a layer shifts, and correct it in the same PR that moves
something.

*Audited at build `df51b75` (2026-07-11), by reading every file in `src/`
and `carrot_patch/`. Updated in the same PR as R9 (solo demoted to dev
tool), which resolved the player-facing half of F2; updated again in the
R2+F1 PR, which resolved F1 (structured events).*

## The target (where things SHOULD live)

Three spaces, in the owner's words:

1. **The server is truth — the server does all the thinking.** Game state
   changes happen in exactly one place. Clients express intent and render
   results.
2. **`data.js` is the game logic.** What exists, what it costs, what it
   does, when it appears — content authors move the game forward here.
3. **UX space is the skin** (`page.html`, `styles.css`, `ui.js`): rendering,
   sound, feel, words on screen. It reads state and events; it never
   *decides* anything about the game.

Plus one pragmatic fourth: the **JS engine copy** (`core.js`). It exists
only because solo mode needs a local brain and patch mode wants instant
click feel. It is a *shadow* of the server's thinking, kept honest by the
parity suite — every place solo mode gets its own logic instead of sharing
the engine's is a place the shadow can drift.

## The census

| Subsystem | Lives today | Verdict |
| --- | --- | --- |
| Economy math (CpS, costs, mults, prestige) | `core.js` ↔ `economy.py`, parity-tested; server authoritative in patch mode | ✅ |
| Content (buildings, upgrades, ribbons, news) | `data.js` → `patch-data.json`, both engines read it | ✅ |
| Upgrade unlock gates | `data.js` (`unlock:` vocabulary, R8); interpreter in engine pair | ✅ |
| Upgrade **effects** (what an upgrade does) | Hardcoded shapes in `clickPower()` / `globalMult()` / `buildingMult()`, both engines | ❌ should be data (see F4) |
| Click batching, rate limits, staleness watchdog | `net.js` ↔ `main.py` | ✅ |
| World save / dev-garden save | `main.py` (`patch_state.json`) / `ui.js` (localStorage, `file://` only since R9) | ✅ documented in DESIGN |
| Toast/event **composition** | ✅ resolved by F1: both engines emit identical structured events; `ui.patchEvent()` is the single place they become words + sound (a legacy prose twin ships until R12) | ✅ |
| Sound-effect selection | chosen by `ui.patchEvent()` from the event kind — the emoji sniffing is gone | ✅ |
| Golden rabbit: catch reward | `core.rabbitReward()` ↔ `economy.rabbit_reward()` | ✅ |
| Golden rabbit: spawn scheduling | ⚠ **two brains**: server (`main.py`: first 60–150 s, then 90–240 s) and a separate dev-garden scheduler **in `ui.js`** (first 40–100 s, then 75–180 s) — since R9 the second brain only runs on `file://`, so no player comparison is affected | ⚠ see F2 |
| Golden rabbit: movement, sprite, glow | `ui.js` render/update | ✅ that part is skin |
| Building shop visibility ("???" mystery reveal) | ❌ a game rule (`owned > 0` or lifetime ≥ cost/5) **inside `ui.js updateDOM()`** — not in the engines, not in data, not in DESIGN's tables | ❌ see F3 |
| Upgrade list display (top 12, sort by cost) | `ui.js` | ✅ skin decision |
| News ticker line selection | `ui.js setTicker()` filters `data.js` NEWS by state | ✅ cosmetic, per-client, no world effect |
| Prestige confirmation copy & drama | `ui.js askPrestige()` | ✅ skin |
| Engine numbers **restated as prose** (+8%/seed ×4 places, seed formula inverted in stats panel, "×7 for 30s") | `ui.js` strings | ⚠ see F5 |
| Solo offline earnings (50%, 8 h) / server catch-up (100%, 24 h) | `core.js` / `economy.py` | ✅ deliberate asymmetry, documented |
| Canvas art, particles, squash, audio synth | `ui.js` (`CC.audio`) | ✅ skin |
| Build id | `build.js` → `CC.BUILD` → corner tag | ✅ |
| `?grant=N` URL parameter (free carrots) | `ui.js` bootstrap | ⚠ see F6 |

## Findings, ranked

### F1 — The server does the *talking*, not just the thinking ✅ RESOLVED
The server used to compose finished English sentences and broadcast them,
and `net.js` chose sound effects by checking which emoji a sentence started
with. Now both engines emit identical structured events (`{type:'ribbon',
i}`, `{type:'bumper', b, at}`, plus server-side `upgrade`, `rabbitCaught`,
`prestige`), the wire carries `{type:'event', ev}`, and `ui.patchEvent()`
is the single place — for the dev garden and the world alike — where events
become words, sound, and pixels. Toast wording is now a UX-space edit.
Residue: a legacy prose `toast` twin accompanies each event for stale
pre-F1 tabs; deleting it is R12. The event log and "while you were away"
(R5) are now buildable — events can be summarized, prose can't.

### F2 — The rabbit has two brains (stakes lowered by R9)
Server rabbits: first spawn 60–150 s, then 90–240 s (`main.py`). Dev-garden
rabbits: first 40–100 s, then 75–180 s — scheduled by **the skin**
(`ui.js update()`/`catchRabbit()`), not even by `core.js`. Since R9 the
second brain runs only on `file://`, so the original P3 sting — solo
players getting measurably more rabbits than the world they compare seeds
with — is gone. What remains is a layering debt: any rabbit rework must be
done in two places, one of which is the wrong file. **Move (someday):**
rabbit lifecycle into the engine pair (numbers into `data.js` eventually);
the skin keeps only hop, sprite, and glow.

### F3 — A progression rule is hiding in `updateDOM()`
Which buildings show as "???" vs hidden is decided by
`owned > 0 || totalAllTime >= cost / 5` — inline in the DOM-update loop.
That's exactly the kind of rule R8 just moved to data for upgrades, but for
buildings it's engine logic living in UX space: invisible to DESIGN,
unavailable to the server (a future server-rendered or alternate client
would invent its own rule), and unusable by content authors. **Move:** a
`buildingVisible(i)` in the engine pair, defaults matching today, unlock
vocabulary optional on buildings later.

### F4 — Effects are the un-R8'd half of content
`unlock:` made *when an upgrade appears* data. *What it does* is still four
hardcoded shapes across both engines. Until an effects vocabulary exists
(`effects: [{ buildingMult: … }, { globalMult: … }]`-style), every genuinely
new upgrade idea is a two-language engine PR. Known and discussed; the
biggest remaining step toward "content PRs are `data.js` PRs."

### F5 — The skin restates engine numbers as prose
"+8% forever" appears in four UI strings; the stats panel re-derives the
seed formula inverse (`(n+1)² × 1e6`); frenzy's "×7 for 30 seconds" is
inside an engine-generated string. If the engine numbers ever change, the
skin lies until someone greps. Minor today; becomes a real trap the day
seeds get rebalanced. **Move:** skin reads numbers from the engine/data it
already has access to, never hardcodes them.

### F6 — `?grant=N` is an undocumented rule
The bootstrap grants free carrots from a URL parameter. Harmless in patch
mode (the server overwrites the prediction within a second) and useful for
development — but it's a gameplay-affecting switch in solo mode that no
document mentions, which is the exact shape of surprise P3 exists to
prevent. **Move:** document it (probably here + DESIGN) or gate it out of
production builds.

## Reading this report

The pattern across F1–F3 was the same: **solo mode grew its own brain in
the skin.** Solo needs local thinking, but it should be *the engine's*
thinking (`core.js`), fed through the same structured-event shape the
server uses — then the skin genuinely is just a skin, and the Potato Test
(could you reskin this to Potato Patch Clicker touching only `data.js` +
`styles.css` + art?) starts passing. F1 (the enabling fix) is now done;
F3 has a natural home waiting in the engine pair, and F2's remaining half
is a same-shaped move.
