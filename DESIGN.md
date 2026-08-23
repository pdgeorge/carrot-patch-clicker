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
   dramatic, communal decision. Seeds and ribbons persist forever. Every
   seed also mints one **sprout** — the seed's spendable twin (R13). Seeds
   are never spent; sprouts are spent at the **Potting Shed** on permanent
   perks that survive prestige. The shed catalog is completable by design:
   every item is strictly positive and nothing is exclusive, so *eventually
   every sprout will be purchased — the only communal decision is order*.
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
- Protocol: client → server `{type: clicks|buy|upgrade|catch|prestige|shed, …}`;
  server → client `snapshot` (full state, 1/s), `event` (structured game
  events — ribbon, bumper, upgrade, rabbitCaught, prestige; the client
  turns them into words and sound), `rabbit`. A legacy `toast` (prose)
  accompanies every event for stale pre-F1 tabs until R12 drops it; current
  clients ignore it.
- Clicks apply locally the instant you click (feel), accumulate in a
  counter, and flush as **one message per second**. The next snapshot
  overwrites the local prediction.

## Saving, loading, and sync

| What | Where | When | Format |
| --- | --- | --- | --- |
| **World state** (the real game) | `carrot_patch/patch_state.json`, or the `CARROT_PATCH_STATE` env var (point it at a persistent volume in Docker) | Every 30 s, plus on prestige and on server shutdown; written atomically (tmp file + rename) | JSON via `economy.serialize()` |
| **Dev-garden save** (`file://` only) | Browser `localStorage`, key `carrot-clicker-save` | Every 15 s, on tab hide, on page close | JSON via `core.serialize()` |
| **Tender registry** (names → clicks/buildings, R11) | SQLite, `<state>_tenders.db` beside the world save | Write-through as tallied batches land | `carrot_patch/tenders.py` |

- **Connecting to the patch = loading.** The server sends a full snapshot
  the moment you connect and every second after; your display is always at
  most ~1 s behind the world. If the socket dies silently (laptop sleep,
  dropped Wi-Fi), the client watchdog notices the missing heartbeat within
  ~5 s — or the instant the tab becomes visible again — and redials, which
  re-syncs by design (R1).
- On a served page, **localStorage is never read or written for game
  state** — that lives on the server, full stop. The one deliberate
  exception is your noticeboard signature (R11), a display preference that
  must survive a refresh. Before the first-ever snapshot the page
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
| Max clicks per batch | 1000 | `carrot_patch/main.py` `MAX_CLICKS_PER_MSG` | Anti-flood only, never game balance (P4/R2): raised 250→1000 (2026-07, pro-autoclicker call) — it only stops forged clicks-you-never-made packets; the economy, not a cap, makes clicking fade. |
| Min interval between click batches | 0.75 s | `carrot_patch/main.py` `MIN_MSG_INTERVAL` | Tolerates client timer jitter on the 1 s flush without allowing double-rate senders. |
| Max messages/sec per connection | 10 | `carrot_patch/main.py` `MAX_MSGS_PER_SEC` | Pure flood guard across all message types; normal play sends ~1–3/s. |
| Buy volumes | ×1 · ×5 · ×10 · Max | `src/page.html`, `carrot_patch/main.py` | Bulk buying without arithmetic homework (R20); Max resolves SERVER-side against the live shared bank (P2) — the bank moves between click and arrival. |
| Max-buy cap | 5000 per click | `maxAffordable` in both engines | Keeps 1.15^n inside double range; an absurd bank just needs a second click. |
| Max message size | 512 bytes | `carrot_patch/main.py` | No legitimate intent is bigger; drops garbage cheaply. |
| Snapshot broadcast | 1/s | `carrot_patch/main.py` `SNAPSHOT_INTERVAL` | Fast enough to feel live, cheap enough for many clients; also the world tick rate. |
| World autosave | 30 s | `carrot_patch/main.py` `SAVE_INTERVAL` | Bounds loss on a crash to 30 s of a garden that regrows it in 30 s anyway. |
| Server-down catch-up | full CpS, cap 24 h | `carrot_patch/economy.py` | Downtime shouldn't punish the world; the cap stops a year-old save from minting absurdity. |
| Dev-garden autosave | 15 s + on hide/close (`file://` only) | `src/ui.js` | localStorage is cheap; losing more than 15 s feels bad. Never runs on a served page. |
| Dev-garden offline earnings | 50% CpS, cap 8 h (`file://` only) | `src/core.js` | Rewards returning without making leaving optimal. |
| Building cost curve | ×1.15 per owned | `src/core.js` / `economy.py` | Genre-standard geometric ramp (same as Cookie Clicker). |
| Seed formula | ⌊√(lifetime/1e6)⌋ | `src/core.js` / `economy.py` | First seed at 1M lifetime carrots; square root keeps late seeds meaningful but not runaway. |
| Seed bonus | +8%/seed, forever | `src/core.js` / `economy.py` | Big enough that a world prestige feels worth the reset. |
| Sprout mint | 1 per seed, at prestige | `src/core.js` / `economy.py` | The seed's spendable twin (R13): seeds are forever (+8%), sprouts are the shop budget. 1:1 keeps the pair legible — one glance tells you what a prestige is worth in both currencies. |
| Shed catalog & prices | 5 → 625 sprouts, ×5 steps (`CC.SHED`) | `src/data.js` | Pacing knobs, not choices: the catalog is completable — every item strictly positive, nothing exclusive — so prices only control how many prestiges the ladder spans. |
| Retroactive sprouts | sprouts = seeds, on first load of a pre-R13 save | `src/core.js` / `economy.py` `deserialize` | Existing worlds earned their seeds when nothing was spendable; minting the backlog is the fair migration, and it happens exactly once because the save carries `sprouts` from then on. |
| Rabbit spawn gap | 60–150 s first, then 90–240 s | `carrot_patch/main.py` | One shared rabbit; scarce enough to be an event, common enough to matter. |
| Rabbit lifetime | 12 s | `carrot_patch/main.py` | First-click-on-Earth race needs a real window across time zones and reflexes. |
| Frenzy | ×7 for 30 s | `src/core.js` / `economy.py` | The click-renaissance enabler (P4/arc §3). |
| Reconnect retry | every 4 s, forever — served pages never give up and never fall back to solo | `src/net.js` | P6: a served page is always the world game. A restarting server, or a proxy that comes good, reclaims its players; until then the page visibly waits ("reaching the carrot patch…") rather than becoming a different game. |
| Staleness threshold | 5 s without any server message | `src/net.js` `CC.PATCH_STALE_MS` | The server heartbeats a snapshot every 1 s, so 5 s of silence means the socket is dead even if the browser doesn't know it (half-open TCP). Redialing re-syncs (P5). |
| Noticeboard names | 2–20 chars, casefolded contains-check vs `blocklist.txt` | `carrot_patch/tenders.py` | Long enough for a name, short enough for the board; the filter is crude by design (R11). |
| Noticeboard size | top 10 by clicks | `carrot_patch/main.py` `/api/board` | One-click visitors vastly outnumber regulars; recognition, not a ledger. |
| Noticeboard refresh | 60 s poll + on sign | `src/ui.js` | Recognition doesn't need to be live; a minute keeps it cheap at any player count. |
| Watchdog cadence | every 2 s, plus on tab-becomes-visible | `src/net.js` | Frequent enough to catch staleness fast while foregrounded; the visibility hook covers waking from sleep, when background timers were throttled. |
| Honey mint | 1 per rabbit/tin/stall/rain, 10 per spring, 24/day from the Bee Cooperative (`CC.HONEY`) | `src/data.js`; `mintHoney` in both engines | The Fallow Year's calendar currency (R21): minted by DEEDS and the clock, never by cps, so it cannot inflate with the economy — a week of play is worth about the same honey at 1e9 cps as at 1e30. Spent at the Seed Bed (R23); until then it keeps. |
| Many Hands | +1%/tender online (cap 100) +0.5%/distinct name this week (cap 100) (`CC.HANDS`) | `src/data.js`; `hands_bonus` in `main.py` | Presence-boxed, so outside the β-budget: it never compounds with anything bought. Caps keep a bot-net's best case at ×2.5; the name term rewards the board, not the socket count. |
| Market Hour | Sat 09:00–12:00 UTC (Sat evening Melbourne); guests ×4, weather ÷3, prices −20% (`CC.MARKET_HOUR`) | `src/data.js`; `marketHourAt` in both engines | One weekly appointment the whole world can keep; three hours spans bedtimes across a continent. The discount composes multiplicatively with Market Days (0.9 × 0.8). Week starts Sunday 00:00 UTC in both engines — parity-tested at the boundaries. |
| Parish Orders | one a week, 3 tiers, due at the end of Market Hour; rotation `CC.ORDERS`, rewards `CC.ORDER_REWARDS`, failure `CC.ORDER_FAIL` | `src/data.js`; `carrot_patch/parish.py` | A deadline the world can MISS. Targets are relative AND pro-rated to the actual window (a first-boot or post-restart order is due in 1–8 days, not always 7): harvest = 1/2/4 × the **steady** cps (buildings × season — no buffs, no Many Hands, no Trial rule, so the reward just paid, a crowd at the bell or a Hands Only spring can never set the next bar) × seconds to the bell; guests/stalls = a share (10/30/60 %) of the guests expected in the window (one per mean gap, stalls by weight); springs = ½/1/1½ × last week's springs (from the chronicle); grounds = a share of the sprouts held; quilt fill and pages are absolute. Kinds that cannot be won are skipped and logged (`order_skipped`): a full Almanac, a finished quilt, every Trial maxed. Rewards are honey and time-boxed buffs (Bumper Day ×2/24 h, Bumper Week ×3/48 h) — free under β; a miss is a 24 h Embargo and thin weather. A buff by the same name REFRESHES rather than stacks, so three Wider-Orders cards resolving at one bell are one Embargo (never ×0.125) and one Bumper Week (never ×27); honey still adds. Never posts due in under a day; with no Market Hour in the data, due in a week. The rotation keeps its own persisted counter (history is capped at 20). `orders_override.json` beside the save lets a human hold the pen: a known kind and exactly three finite, positive, ascending tiers, else the spec is skipped and logged — a typo never posts an unwinnable order or stops the loop. |
| The Quiet | 6 h without any intent → Welcome Back ×2 for 1 h (`CC.QUIET`) | `src/data.js`; `OrderBook.touch` | The garden must not punish the one who came back to an empty patch; a buff, not a multiplier, so it is time-boxed and survives nothing but its hour. Long Parish buffs carry `keep` and survive a spring — a Bumper Week is the world's, not one run's. |
| Chronicle | append-only `<state>_events.jsonl`; in memory a 20 000-event ring read from the file's last 4 MB at startup; day summaries memoised 60 s; 500-event cap on `/api/chronicle?since=`; `t` is always the epoch (an event's own `t`, e.g. a Trial's elapsed time, is kept as `dur`) | `carrot_patch/parish.py` | The world's day-book: backs "while you were away" (R5, shipped here), the Today's Patch card and the Order baselines. JSONL, not SQLite — it is a record, never a gate: a write failure is swallowed. A GET never touches the file (an unauthenticated endpoint must cost microseconds, not a rescan of a year). Springs are recorded WITHOUT a name: the modal promises "your name will not be recorded" (R11). |
| Presence board | hands today (first 50 by clicks + exact count), streaks (names ≥ 7 days old, top 5, live only if tended yesterday or today), founders (first 5 by first day, then clicks); pre-R21 rows dated 2026-07-17 | `carrot_patch/tenders.py` `presence()` | The board a bot cannot own (R6): a sybil account gains one presence-day each — nothing to farm; the list is bounded so a name-flood cannot fatten every viewer's poll. A streak that ended is a best, not "days running". Legacy tenders predate the presence columns by definition — without the backfill the restart day would make founders of whoever reconnected first. |
| Signature throttle | one accepted `name` per socket per 5 s | `carrot_patch/main.py` `NAME_INTERVAL` | A board row is permanent; ten a second would be a sybil's whole week of Many Hands names in a minute. |
| Away & due cues | away summary after ≥ 1 h since the previous snapshot; last-seen heartbeat 60 s; order due label urgent under 6 h; track marks at 25/50/100 % | `src/ui.js` `CC.AWAY_AFTER`, `CC.DUE_SOON` | Client-side and cosmetic. An hour is the shortest gap the chronicle can say something about; the baseline is the previous snapshot (not page load), so a lid-shut laptop that redials gets its summary too. The `since` sent to the server is skew-corrected with the snapshot's clock. |
| Readable numbers | 🔢 short (`1.23Td`) / long (`1.23 tredecillion`) | `src/core.js` `CC.fmtLong`, `src/ui.js` | A display preference stored beside the day/night toggle; the value never changes, only the unit's name. |
| Trial clock & ladder | 48 h; 5 completions per Trial; goal = max(1e6, best PLAIN spring on record, the plain spring ending now) × the rule's handicap × 2^completions; a spring counts only if plain (no rule) and ≥ 1 h long; the record is a high-water mark, reset at Lie Fallow (`CC.TRIAL.step`, `minSpringSec`, `refClicks`) | `src/data.js`; `trialGoal`/`ruleHandicap`/`plainRun` in both engines | "Get back to where we were" needs no tuning — but the first cut (last five springs × 10) was flushable by six instant springs and unreachable past the second completion (R22 review). A monotone record that only honest hour-long plain springs can raise cannot be lowered by spam; the **handicap** is the rule's share of income measured on the garden being left (Drought a quarter, Short Rows the first six rows' share, Hands Only a 5-click/s reference hand's share; time-costing rules 1), so every rule asks for what it can actually make; doubling per completion stays reachable five times. Going to seed mid-Trial abandons it — announced, on the record, and warned in the modal. Wall-time clock; downtime counts. |
| Trial rules | Late Frost halt 180 s (plots AND the harvest share of clicks; the bare hand never stills) · Short Rows 6 plots (rows past six stand but count for nothing — no output, no synergy, no bumpers) · Drought ×0.25 on every blessing (`CC.TRIALS[].rule`) | `src/data.js`; `haltMult`/`rowExists`/`rowCount`/`rowRoom`/`globalMult` in both engines | Each rule is ONE line in the engine read at one hook, so a rule can never leak into a normal spring: every hook returns neutral when `trial` is null. Drought was an exponent (^0.75) — at 1e29 of blessing that is a ×1.8e7 cut, unwinnable forever; a flat quarter is scale-free (R22 review). Hands Only zeroes the plots but clicks keep their cpsPct share of the raw base — the sanctioned bot spring (P4). |
| Trial rewards | Scarecrow ≤5, start-tier ≤4, resprout +20/≤100, Sprinkler cap +1/≤10 (6 → 11 valves), Long Ears ≤5 (+3 s/level), Click Frenzy ≤5 (×(1+2·lv) during a frenzy), Fog 150 honey (`CC.TRIALS[].reward`) | `applyReward` in both engines | Automation, caps and unlocks, never a production multiplier, so nothing here changes the growth exponent (β). Honest footnote: the sprinkler valves and the tier starts DO raise a clicker's steady income by a constant factor (11 valves = +5.5 % of cps per click; a 10-click/s bot gains ×1.55) — constants, not compounding terms, and they are the point of the ladder. Every ladder is clamped in `applyReward` AND in the save sanitizer (perks are read BEFORE the shed clamp, so a raised cap survives a reload). |
| Scarecrow | every 60 s, one unit of the cheapest affordable building among the first 2·lv rows, only if ≤ 1% of the bank; rests during Late Frost | `tick` in both engines | A patient hand for humans who aren't running the bot; the 1% rule means it can never out-spend a person's plan or starve a Max buy. Deterministic, so both engines stay in step. Silent on the wire — the snapshot shows it. |
| The Seed Bed | 4×4 plots; bed tick 300 s; trowel 60 s per ADDRESS and no address may hold more than a quarter of the plots immature; basket 15 s per address; soil cooldown 600 s (world); sacrifice 100 honey after a 6 h cancellable wait, then a 10 min rest after a cancel (`CC.BED`) | `src/data.js`; `bedTick`/`bedPlant`/`bedHarvest` in both engines; `carrot_patch/main.py` intents | The first verb where the world MAKES something, on a clock cps cannot inflate. Five minutes is slow enough that a bot gains nothing by polling and fast enough that a session sees growth. No uproot exists (P1): plants die of age only — but with a per-socket trowel one loop could hold every plot immature forever (R24 review), so the trowel is per address AND capped at a quarter of the bed; the worst grief is now a quarter of the bed tied up for a few ticks. The sacrifice is the one irreversible act on the log: six hours crosses every waking window (the bell's own reasoning) and the rest stops cancel/fire ping-pong. A refused seed is answered, so the trowel never locks for nothing. One seeded 32-bit LCG per bed, mirrored bit-for-bit. The bed keeps ticking through downtime (server: the 24 h catch-up; dev garden: 8 h). |
| Seed prices | tier-1 seeds: 1–5 minutes of the STEADY cps (floor 10/s); found crosses: 10/30/80/200/400 honey by tier (`CC.PLANTS[].cost`, `CC.BED.honeyTierCost`) | `bedPrice` in both engines | Minutes of harvest mean the same thing at 1e3 and 1e47 cps; honey is the bed's sink and the reason discoveries matter (a found cross can be re-planted — for honey). At these prices the full log costs ~1000–1600 honey, about a week of the world's honey — the brake the recipe design needs (a simulated attentive gardener closes the log in ~7–10 days; at half these prices it was 4). Weeds are never for sale. |
| Species & recipes | 24 species in 6 tiers (`CC.PLANTS`): 4 buyable, 2 wild (0.4 % and 0.15 % per empty plot per tick), 18 crosses at 0.5–10 % per empty plot per tick when both parents stand mature and adjacent (8-neighbour); Wood Chips ×3 mutation; Clay ages every 3rd tick at ×1.25 effect | `src/data.js`; `bedTick` | Dependency depth 5 with ~24 species was the proposal's starting point: too easy and the log closes in a week, too hard and the bed is a lawn. Recipes are in the data file on purpose (P7) and hidden in play — the wiki is half the fun. The tree has no loops (tested). The shortest pick window is 6 ticks (Glass Flower: 30 min on Dirt, 90 on Clay), so an hourly tender still catches most of them and polling buys a bot little. Honey on harvest rounds half UP in both engines (Python's banker's rounding would have diverged on Clay). |
| Bed effects | per mature plant: mult ×1.01–1.05, guests ×1.05–1.5, rain ×1.1–2, honey 1–10 on harvest, payout 2–60 cps-minutes; aggregates capped at ×2.2 production (16 × 1.05 = ×2.18), guests ×4, rain ×3; payouts capped at 5 % of the bank + a minute | `bedMult`/`bedRabbit`/`bedWeather` in both engines | Live effects are bounded by plot count — a constant, so zero β; they multiply cps (and clicks) beside the buffs, never inside globalMult (which feeds seeds). Payouts are bank-capped like rabbit bundles so a fresh world cannot be catapulted. |
| Seed log pages | 8 Almanac pages: one per tier found (6), the full log, the sacrifice (`{logTier}`, `{logFull}`, `{sacrifices}`) | `src/data.js` | Per TIER, not per species — 24 species pages would have been ×1.6 of permanent production from one feature; eight is ×1.17, in line with the other chapters. The species themselves are recognised in the seed log panel, not the book. |
| Loam mint | ⌊(log₁₀ seeds)²⌋ at Lie Fallow; the bell needs ≥ 400 pending (seeds ≥ 1e20) (`CC.FALLOW`) | `loamPending` in both engines | The live world's first Fallow pays 496; regrowing to 1e20 pays 400, to 1e24 pays 576 — every cycle is worth about the same, so "one more Fallow" never stales, and the currency is human-sized (hundreds, not Vg). |
| What Fallow resets / keeps | resets bank, plots, upgrades, lifetime (so ribbons), seeds, sprouts, shed LADDERS, the run log, a running Trial; keeps the Almanac, world counters, shed one-shots, honey, the seed log and bed, the Trials' ledger and perks, the Cellar, the chronicle; frames and clears the quilt | `fallow()` in both engines; `bell_tick` in `parish.py` | tm's call (2026-08-23): one-shots survive — a constant ×3.6 and ×16 mint that makes the regrow a different game from the first climb, while the ladders (compost 1045, heirlooms 110) are exactly the part that could only be retired, never tuned. Resetting lifetime also retires the float64 hazard structurally. |
| The bell | 4 rings, 2 h apart (6 h from ring to Fallow); anyone rings; silencing takes HALF the addresses online (at least one) each speaking once; after a silence the bell rests 10 min; the world's FIRST bell is a rehearsal that rings out and resets nothing (`CC.FALLOW.rings/ringGap/ringRest`, `rehearsed`) | `carrot_patch/parish.py` `ring/silence/bell_tick` | tm's call: four rings two hours apart, and a rehearsal first — a reset of the whole world deserves a dry run, and six hours spans every time zone's evening once. "Anyone can silence it" alone let one tab keep the world un-fallowed forever and ring/silence at 5 Hz (R24 review): a half-of-those-present vote keeps the veto communal, the rest keeps it from being a siren, and the client confirms before a voice is cast. An outage rings straight through on the next tick. On a Fallow the world save lands first, then the quilt is framed, then the parish file — three files that can never disagree; a running Trial is abandoned on the record, every live Order (baselined on the old world) is wiped without effect, and the board stays empty until the cycle's first Go to Seed — an Order posted against a bare world would be won in minutes. The snapshot carries the silence votes as a count, never the voters' addresses. |
| Tilth | +5 % sprouts per seed per Fallow, cap 25 (computed in integer percent) | `tilthPct` in both engines | At the cap (×2.25) it moves the compost ladder ~21 levels (ln 2.25 / ln 1.04) — ×1.23 production, the same at every scale — not a β change; capped so it is a bonus, not a growth term. Integer percent, so gain × mint × tilth is exact before the floor. |
| The Root Cellar | level n costs 8·n loam (triangular, `CC.FALLOW.cellarStep`); a full cellar is 744 loam ≈ one and a half Fallows; Quick Spring ≤5 (`per` 10 plots/level), Scarecrow Pace ≤5 (`per` −10 s/level, floor 10 s), Open Gate ≤8 (`per` +5 % guests/level), Deeper Beds ≤2 (+1 row & column, +25 resprout), Wider Orders ≤2 (+1 order on the board), Seed Memory ≤6 (cycles start at 10^lv seeds' lifetime) (`CC.CELLAR`, every `per` read by both engines) | `src/data.js`; `buyCellar` in both engines | Every perk is automation, a cap or a head start — never a production multiplier (Deep Roots, the one β-touching perk in the proposal, was cut). Triangular prices at 8 loam a step mean the first Fallow (496) buys about two-thirds of the cellar and the second finishes it; after that loam waits for the perks content adds (at 1 a step the whole cellar cost 93 and loam had no sink after Fallow I — R24 review). Seed Memory sets the lifetime that would have earned the seeds, so no phantom pending seeds exist. |
| The Quilt | 48×48, 16 colours, one stitch per ADDRESS per 30 s, costing 1 s of cps (`CC.QUILT`) | `src/data.js`; `carrot_patch/parish.py` `Quilt`; `main.py` `_paint_at` | 2304 cells at 2/min is a multi-day project for a handful of people — an artifact, not a minigame. The price is nominal by design (a second of harvest), so the quilt is never an economy sink; the cooldown is keyed by client address (`x-forwarded-for` behind the proxy), because sockets are free and a per-socket needle could blank the cloth in seconds (R22 review) — bots still paint at human pace (Knights of the Button: welcome). Diffs ride as `paint` events; `quiltV` in the snapshot is the version whose diffs have already been broadcast, so a client refetches `/api/quilt` only after a real gap. Survives Go to Seed; framed and cleared at Lie Fallow (R24). A quilt Order asks for a share of the BARE cloth at posting and is skipped only when the quilt is finished. |

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
| `{ shed: 'id' }` | Potting Shed item already bought (R13) — the valve for gating future content behind the world's sprout spending |

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

Numbered for reference. R7 and R14 are the active priorities.

- **R1 — Staleness detection & re-sync. ✅ Shipped.** If the WebSocket dies
  *silently* (laptop sleep, dropped Wi-Fi — TCP half-open, so `onclose`
  never fires), the client used to believe it was connected and display
  frozen state indefinitely, violating P5. Now a watchdog redials whenever
  no server message arrives for 5 s (checked every 2 s and on
  `visibilitychange → visible`), and the patch line shows "re-syncing…"
  while disconnected instead of pretending to be solo. (R1 originally also
  added a solo-fallback toast for never-connected clients; R9 removed the
  fallback itself.)
- **R2 — Retire the 40-click cap. ✅ Shipped.** `MAX_CLICKS_PER_MSG` is now
  250 — an anti-flood ceiling, not game balance, per P4. Fast clickers'
  clicks land; the economy is what makes them fade.
- **R3 — Unmissable connection indicator.** The wordmark + status line
  exist but are subtle. Make connection state (connected / re-syncing /
  reaching) explicit in the UI. (R9 removed the worst case — a served page
  can no longer *be* solo — but "how live is what I'm seeing" should still
  be one glance.)
- **R4 — Rules visible in-game.** A "how the patch works" panel (batching,
  what's shared, where saves live, the click curve) so players don't need
  the repo to understand the game. This document is the source; the panel
  summarizes it.
- **R5 — "While you were away" for the patch. ✅ Shipped (R21).** The
  chronicle remembers; a tab that was away an hour or more is told what the
  world did meanwhile (springs, pages, guests, orders met or missed).
- **R6 — Presence & contribution flavor. ✅ Shipped (R21).** The presence
  board (hands today, streaks, founders) and Many Hands — recognition and a
  presence-boxed bonus, never resources (P1).
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
- **R11 — The community noticeboard: Tenders & Gardeners. ✅ Shipped.** A
  board under the carrot, spanning the left and middle columns (the shop
  column runs long beside it), skinned with `src/community_board.png`
  (inlined as a data URI at build time — the game stays one self-contained
  file; the image's frame and centre post delineate the halves). Left half
  **Tenders**: sign with a name and your clicks + buildings-bought tallies
  join the world's top 10, refreshed each minute from `GET /api/board`.
  Right half **Gardeners**: `contributors.txt` at the repo root, one name
  per line — add yourself in the PR where you contribute. As built:
  - **Recognition, never resources (P1):** names and tallies have zero
    gameplay effect. **Seeds are never tracked or shown** — going to seed
    stays anonymous, so the prestige modal's "Your name will not be
    recorded. Your deed will be felt" remains literally true.
  - **Top 10 by clicks only** — drive-by one-click visitors vastly
    outnumber regulars; no infinite ledger. A runaway #1 (e^99 vs. 100) is
    a known possibility, deliberately deferred until it actually happens.
  - **Names:** opt-in, 2–20 chars, whitespace-collapsed, validated
    server-side by a casefolded contains-check against
    `carrot_patch/blocklist.txt` (crude by design — shiitake casualties
    accepted as good enough for the internet). Rejections reply only to
    the sender; tallies survive prestige, like the world's click stat.
  - **Storage: SQLite** (`<state>_tenders.db`, beside the world save — see
    the save table), so the unbounded registry can never bloat or endanger
    the 30-second atomic world save.
  - **Your signature is a localStorage *preference*** — the one deliberate
    exception to "served pages never touch localStorage", which governs
    *game state*. A signature must survive refresh; it's re-sent silently
    on every reconnect so tallies keep landing.
  - **Vocabulary migrated:** players are now "tenders" in the patch line
    and rabbit announcements; "gardeners" means the plaque.
- **R12 — Drop the legacy toast prose.** F1 made the server broadcast
  structured `event` messages; a prose `toast` twin still accompanies each
  one so stale pre-F1 browser tabs (which reconnect via the R1 watchdog
  without reloading the page) keep seeing announcements. Once a post-F1
  build has been deployed for a week or two, delete `legacy_text()` and the
  `announce()` twin in `carrot_patch/main.py` — the server stops composing
  English forever.
- **R13 — The Potting Shed: seeds & sprouts. ✅ Shipped (bare minimum).**
  Two players without autoclickers effectively cleared the game in two
  days; the shed is the keystone of the fix. Going to seed now mints two
  currencies: **seeds** (infinite, +8% each, never spent — unchanged) and
  **sprouts**, the spendable twin, minted 1:1 alongside them. Sprouts are
  spent at the Potting Shed — a full-screen overlay opened from a button
  under Go to Seed that glows when something is affordable; the sprout
  balance always sits on the main screen beside the seed count. Purchases
  survive prestige. Founding rule: **the catalog is completable** — *"no
  matter what happens, eventually every sprout will be purchased; it just
  might not be the most optimal way."* Every item is strictly positive and
  nothing is exclusive, so the only communal decision is ordering — no
  governance machinery needed, and a lone spender can at worst delay the
  optimum. Prices are pure pacing knobs (see Tunables). Pre-R13 saves mint
  retroactive sprouts = seeds (they were earned when nothing was
  spendable). Bare minimum ships four flat production perks and the
  `{ shed: 'id' }` unlock condition; the intended destination is shed items
  that **unlock new top-end buildings** — the endgame content valve — which
  waits on R14. When the catalog runs dry, idle sprouts are the signal that
  content owes the shed new entries.
- **R14 — Id-keyed world state (planned).** Buildings are referenced by
  array index in the world save, the dev-garden save, and synergy upgrades
  (`target`/`per`), so content cannot insert or reorder buildings without
  corrupting live worlds. One-time migration: give buildings stable string
  ids, serialize counts as a dict keyed by id, point synergies at ids —
  after which `data.js` ordering is display-only forever. Prerequisite for
  shed-unlocked buildings and for new buildings before the Singularity
  (both wanted per R13/the pacing fix).

- **R21 — The Parish wakes. ✅ Shipped (2026-08).** First slice of *The
  Fallow Year* — the expansion that answers a consumed world with decisions
  and clocks rather than bigger numbers. Five systems, no ladder: **Honey**,
  a calendar currency minted by deeds and the Bee Cooperative (never cps);
  **Many Hands**, a presence bonus for bodies online and names on the board;
  the **Market Hour**, Saturday evening Melbourne, when guests crowd in and
  the stalls discount; **Parish Orders**, one weekly three-tier deadline the
  world can miss, due at the end of Market Hour, authored by a rotating
  table or a human with `orders_override.json`; and **the Quiet**, a
  welcome-back for whoever returns to an empty garden. Around them: the
  chronicle (`_events.jsonl`), the presence board, a readable-numbers
  toggle, an all-buffs bar, and the Today's Patch share card. Engine pair
  learns only honey, `handsBonus` and `marketHour` (parity-tested at the
  week boundaries); everything else is server business in `parish.py`.
  Next: R22 Trials & the Quilt, R23 the Seed Bed (honey's sink), R24 Lie
  Fallow (the second prestige).
- **R22 — Trials & the Quilt. ✅ Shipped (2026-08).** Second slice of The
  Fallow Year. **Trials:** the Go to Seed modal gains "which spring?" — a
  plain one, or one of seven data-defined rules (`CC.TRIALS`) for the whole
  world's next spring: Late Frost (purchases still the garden), Crop
  Rotation (no plot may outnumber the one before), Short Rows (six plots),
  Hands Only (plots sleep; clicks, guests, rain count), Drought (every
  blessing ^0.75), Fog (numbers hidden), Quiet Hedge (no guests). The goal
  is "get back to where we were" within 48 h; the spring carries on either
  way. Each completion pays a perk — Scarecrow, upgrade-tier starts, deeper
  resprouts, a sprinkler cap, Long Ears, Click Frenzy, honey — automation
  and caps only, five times per Trial, with nine Almanac pages for the
  chapter. The engine pair learns `trial`, `trialsDone`, `trialBest`,
  `runLog`, `perks`, `haltT`; every rule is one hook that returns neutral
  when no Trial runs (parity-tested per rule). One Trial for the planet: a
  griefer's worst case is a constrained spring for 48 h (P1). The
  autogardener waits for the thaw under Late Frost. **The Quilt:** a 48×48
  canvas on the noticeboard wall, painted one stitch per connection per
  30 s for a second of harvest; copy-as-image for the share. Two new Order
  kinds (quilt fill, trials won). Next: R23 the Seed Bed.
- **R23 — The Seed Bed. ✅ Shipped (2026-08).** Third slice of The Fallow
  Year, and honey's sink. A shared 4×4 bed under the carrot, ticked by the
  server every 300 s. Four tier-1 seeds are bought with minutes of the
  steady cps; everything else must be FOUND: two mature parents touching
  an empty plot roll a hidden recipe each tick (24 species, six tiers,
  weeds that blow in on their own, soils that change the clock and the
  odds). Mature plants bless the world while they stand (production,
  guests, rain, honey on harvest, a bank-capped payout) and die of age —
  there is no uproot (P1). The first harvest of a species writes the
  **seed log**, world state that will survive Go to Seed and Lie Fallow; a
  complete log can be sacrificed for 100 honey after a cancellable
  countdown, and the bed begins again. The engine pair learns one
  sub-economy primitive (`bed`, `bedTick` with a mirrored 32-bit LCG —
  parity-tested event-for-event from a seed). Server intents: plant,
  harvest, soil, sacrifice, cancelSacrifice; bed crosses and firsts go to
  the chronicle. UI: a bed canvas with a planting menu and plot tooltips,
  a soil bar, the seed log panel with ??? chips per tier. Eight Almanac
  pages. Next: R24 Lie Fallow.
- **R24 — Lie Fallow. ✅ Shipped (2026-08).** The Fallow Year's last slice
  and the dimension itself: a second prestige above Go to Seed. Seeds
  retire into **loam** (⌊(log₁₀ seeds)²⌋ — 496 for the live world); bank,
  plots, upgrades, lifetime, ribbons, seeds, sprouts and the shed's ladders
  return to the ground, while the Almanac, counters, one-shots, honey, the
  seed log, the Trials' ledger and the Root Cellar stay. The **bell** rings
  four times, two hours apart; anyone rings it, anyone silences it, and the
  world's first bell is a rehearsal. When it rings out, the quilt is
  framed into the chronicle and cleared, and a full-screen ceremony plays.
  **Tilth** sweetens the sprout mint per Fallow (cap 25). Loam is spent in
  the **Root Cellar** (a tab in the shed) on six rule changes with
  triangular prices and hard caps: Quick Spring, Scarecrow Pace, Open Gate,
  Deeper Beds (the Seed Bed grows to 6×6), Wider Orders (up to three Parish
  Orders at once), Seed Memory. Six Almanac pages. Engine pair:
  `fallow()`, `loam`, `cellar`, `fallows`, `rehearsed`, `springStart()`
  shared by both prestiges, a bed that resizes by (x, y); parity-tested.
  Server: `ring`/`silence`/`cellar` intents, the bell in `_parish.json`,
  `OrderBook` grown to a list of live orders. The Fallow Year is complete;
  what follows is content by data.

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
