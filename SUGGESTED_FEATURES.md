# Suggested Features

A comparison of Carrot Patch Clicker against the genre standards — Cookie Clicker, Clicker Heroes, AdVenture Capitalist, Realm Grinder, Egg Inc., Antimatter Dimensions, Universal Paperclips — followed by a list of features we're missing, ranked roughly by value-for-effort. Everything here was filtered against [DESIGN.md](DESIGN.md): a genre staple that violates P1 (one world, no per-player resources) or P4 (no punitive click caps) is either adapted to fit or flagged as deliberately out of scope. Per P7, each entry notes whether it's content-only (`data.js`), needs a new engine primitive (mirrored JS + Python), or is a bigger system.

## What we already have (and its genre equivalent)

| Ours | Genre equivalent |
| --- | --- |
| 10 buildings, ×1.15 cost curve | Cookie Clicker's building ladder (same curve, but CC has 20 buildings) |
| Tier upgrades at 10/25/50/100 owned | Cookie Clicker's building upgrade tiers |
| Click upgrades incl. `cpsPct` (+% of CpS per click) | Cookie Clicker's "plastic/steel mouse" line |
| Global multipliers, synergy upgrades, bumper-crop milestones | Cookie Clicker global upgrades + synergies |
| Golden rabbit (frenzy ×7 / lucky bundle) | Golden cookie — but CC has ~9 effect types, we have 2 |
| Ribbons (lifetime milestones, permanent mult) | A slice of achievements + a slice of milk |
| Prestige (seeds, +8% each, √ formula) | Ascension / angel investors — but ours is a flat bonus with no spend decision |
| News ticker, tooltips, sound, mute, buy-amount selector, floats | Standard genre QoL |
| Noticeboard (Tenders top-10) | Leaderboards / Clicker Heroes clan roster |
| Server-side always-on world | Better than offline earnings — the garden literally never stops |

## Roadmap items that are already genre staples

| Roadmap | Genre equivalent |
| --- | --- |
| R4 — rules visible in-game | Cookie Clicker's Info screen |
| R5 — "while you were away" | AdVenture Capitalist / Egg Inc. welcome-back earnings report |
| R6 — presence & contribution flavor | Session stats, clan activity feeds |

The features below don't duplicate roadmap items; where one strengthens a roadmap item, it says so.

---

## Tier 1 — biggest wins, mostly content-layer

### 1. Golden rabbit effect variety

**TL;DR:** The golden rabbit currently rolls one of two effects: Frenzy (×7 for 30 s) or a Lucky carrot bundle. Cookie Clicker's golden cookie has ~nine outcomes — Frenzy, Lucky, Click Frenzy (×777 clicks for 13 s), Building Special (one building type ×N for 30 s), Cookie Chain, Cookie Storm, and joke "Blab" messages — weighted so the rare ones feel like events. Adding even three more effects (Click Frenzy, Building Special, a rare Rabbit Stampede that spawns several rabbits at once) multiplies the excitement of every spawn.

**Why:** The rabbit is our only random event and the whole planet shares each one, so variance here is the cheapest fun we can buy — a rare effect landing is a world-wide moment. Click Frenzy in particular deepens P4's click renaissance: it gives fast clickers a sanctioned, shared stage. Effects are data + one engine primitive per new effect kind (mirrored, parity-tested).

**Games that have it:** Cookie Clicker (golden cookies), Clicker Heroes (clickable fish/presents), Realm Grinder (faction event clickables).

### 2. Rabbit-boosting upgrades

**TL;DR:** Purchasable upgrades that make golden rabbits spawn more often, linger longer, or pay out more — Cookie Clicker's Lucky Day / Serendipity / Get Lucky line, which halves spawn gaps and doubles effect duration. Ours would be world upgrades: the whole planet buys "Rabbit Feeding Station" and everyone's rabbit odds improve.

**Why:** It turns the rabbit from a fixed background event into something the world invests in, and it creates a natural upgrade sink for the late-mid game. Spawn timing lives in `main.py` (Tunables table), so this needs the server to read rabbit tunables from bought upgrades — a small protocol-adjacent change, then it's data forever after.

**Games that have it:** Cookie Clicker (Lucky Day line + heavenly golden-cookie upgrades), Clicker Heroes (Dogcog/Fortuna ancients), Realm Grinder (Faceless/Fairy faction perks).

### 3. Achievements ("the trophy shed") with a milk-style bonus

**TL;DR:** A proper achievement system — Cookie Clicker has 622 covering buildings owned, CpS reached, clicks, golden cookies, oddities — where each earned achievement raises a global "milk" percentage, and "kitten" upgrades convert milk into a production multiplier. Ours would be **world achievements**: the planet collectively earns "Own 100 Greenhouses" and the shared bonus rises, displayed as a trophy shed next to the ribbons.

**Why:** Ribbons already prove the pattern works (milestone → permanent mult) but there are only six of them on one axis (lifetime harvest); achievements give dozens of goals across every axis and are the genre's strongest long-session driver. World-scoped achievements are perfectly P1: everyone earns them together, and they give the news ticker real events to announce. Almost entirely data-layer once a `condition → permanent flag` primitive exists (the R8 unlock vocabulary is most of it).

**Games that have it:** Cookie Clicker (achievements + milk + kittens), Clicker Heroes, AdVenture Capitalist (goals), Egg Inc. (trophies), nearly every idle game since 2014.

### 4. A visible buff bar with stacking buffs

**TL;DR:** When any buff is active (Frenzy, future Building Specials, event boosts), show an icon row with countdown timers; when several are active they stack multiplicatively, which is where Cookie Clicker's legendary combo play comes from. Right now Frenzy is our only buff and its remaining time is invisible unless you know where to look.

**Why:** Stacked buffs are the skill ceiling of the genre — Frenzy × Click Frenzy is the moment players screenshot — and a shared world makes them cooperative: one tender's caught rabbit sets up another tender's combo. The timer display is also groundwork for R3's "how live is what I'm seeing" glance (server-driven timers visibly ticking = visibly connected). UI-layer plus an engine notion of concurrent timed buffs.

**Games that have it:** Cookie Clicker (buff stacking is the endgame meta), Clicker Heroes (skill combos), Realm Grinder (spell stacking).

### 5. Daily world goal — the whole planet is one clan

**TL;DR:** Clicker Heroes' clans unite up to 10 players once a day against a shared Immortal, and Egg Inc. runs co-op contracts with a collective target and deadline. We already have exactly one clan — Earth — so this is a daily/weekly world goal ("harvest 50M carrots today", "buy 200 buildings this week") with a shared reward like a temporary multiplier or a bonus rabbit hour.

**Why:** This is the single most on-theme feature the genre offers us: cooperative targets are usually bolted onto solo games, but our game is *already* communal, so a world goal gives strangers a reason to show up on the same day and a shared win to celebrate in the ticker. It's the "habit phase" retention hook (day-scale check-ins) that we currently lack entirely. Needs a small server-side goal scheduler; goal definitions are data.

**Games that have it:** Clicker Heroes (clan Immortals), Egg Inc. (co-op contracts), most mobile idlers (daily missions).

## Tier 2 — deepens the mid/late game

### 6. Prestige shop — spend seeds instead of just holding them ⭐ priority

**TL;DR:** In Cookie Clicker, ascension earns heavenly chips that you *spend* in a permanent upgrade tree (permaslots, golden-cookie luck, starting bonuses); Clicker Heroes has ancients, AdCap has angel upgrades. Our seeds are a flat +8% each with no decisions attached. A seed shop lets the world spend seeds on permanent structural perks — and, most importantly, acts as the **endgame content valve**: shop purchases unlock whole new top-tier buildings and upgrade tiers that don't exist otherwise, so prestiging is how the world extends its own ladder.

**Why:** Prestige currencies you can't spend are the genre's most-cited missed opportunity — the spend decision is what makes resetting feel like progress instead of loss, and it gives "going to seed" a purpose beyond the multiplier. In our world it becomes a communal strategy debate (what should the planet buy?), which is exactly the P1 fun. Design decisions to lock down first: **(a) split the currency** — lifetime seeds never decrease and keep paying +8% (Cookie Clicker's prestige level), while a separate spendable balance funds the shop, so buying never feels like losing production; working name: **sprouts** (earned 1:1 with seeds; each seed also sprouts, and the world trains sprouts into things), spent at **the Potting Shed**; **(b) the catalog is completable** — every item is strictly positive and nothing is exclusive, so *"no matter what happens, eventually every sprout will be purchased — it just might not be the most optimal way."* The only communal decision is ordering, which makes governance machinery (votes, vetoes) unnecessary and turns prices into pure pacing knobs (P3 tunables); when the catalog runs dry, idle sprouts are the signal that the content pipeline owes the shop new entries (optionally capped with one infinitely-repeatable sink); **(c) buildings need an `unlock` gate primitive** — today only upgrades can be gated (R8), buildings are always visible, so "seed shop unlocks a building" is one new mirrored engine primitive plus a `{ boughtSeed: 'id' }`-style condition. This is a real engine + protocol feature (a spend intent, mirrored economy support), so it should be designed once, carefully — but it's the biggest depth-per-feature in the genre.

**Games that have it:** Cookie Clicker (heavenly upgrades), Clicker Heroes (ancients + outsiders), AdVenture Capitalist (angel upgrades), Realm Grinder (reincarnation perks), Egg Inc. (epic research).

### 7. Kitten-analog: upgrades that scale with ribbons/achievements

**TL;DR:** Cookie Clicker's kitten upgrades multiply production by a factor of your milk (achievement count), so trophies retroactively feed the economy. Ours: "Prize Judges" upgrades whose multiplier scales with ribbons (and later, world achievements) earned.

**Why:** It converts the trophy shelf from static bragging into a growth axis and makes every future achievement instantly valuable, which keeps old content alive. It's one small engine primitive (multiplier = f(ribbon count)) and then pure data; it also pairs with feature 3 to form the classic achievement→milk→kitten loop.

**Games that have it:** Cookie Clicker (kittens), Clicker Heroes (Atman/achievement-linked ancients loosely), Realm Grinder (trophy-scaling perks).

### 8. Risk-reward events — wrath rabbits and wrinkler-style nibblers

**TL;DR:** Cookie Clicker's Grandmapocalypse swaps some golden cookies for wrath cookies (bad-or-great outcomes) and spawns wrinklers — creatures that *eat* your CpS but return it with interest when popped. Our version: the Parsnip Man's blight as an opt-in world state, and "nibbling rabbits" that sit on the patch banking a share of CpS until someone clicks them for a bonus payout.

**Why:** Everything in our game is currently a pure buff, so there's no tension; risk-reward states are how the genre keeps the late game emotionally interesting, and wrinkler-popping is famously the most satisfying click in Cookie Clicker. A world-scoped blight the planet chooses to enter (and can exit) is a dramatic communal decision like prestige, and the Parsnip Man is already our villain. Engine + server work; gate it behind a late unlock.

**Games that have it:** Cookie Clicker (wrath cookies, wrinklers, Grandmapocalypse), Realm Grinder (evil/neutral alignments as risk trade-offs).

### 9. Seasonal & calendar events

**TL;DR:** Cookie Clicker's seasons (Halloween, Christmas, Easter…) reskin the game for a stretch and add season-limited upgrades and drops; nearly every live idle game runs calendar events. Ours would be world seasons — the entire planet's patch enters Harvest Festival together, with a few season-only upgrades and rabbit variants.

**Why:** Events are the strongest "come back this week" pull in the genre, and a shared world makes them stronger: the season is happening to everyone at once, like a real festival. Season definitions (date window, upgrades, skin tweaks) can be almost pure `data.js` once a `{ during: 'season' }` unlock primitive exists, which is exactly the R8 pattern.

**Games that have it:** Cookie Clicker (seasons), Egg Inc. (events), Clicker Heroes (holiday events), AdVenture Capitalist (limited-time event worlds).

### 10. Active skills on world cooldowns

**TL;DR:** Clicker Heroes gives players castable skills — Clickstorm, Powersurge, Lucky Strikes — on long cooldowns, and the meta is stacking them; Realm Grinder's spells are similar. Ours would be world skills: anyone can pull the "Rain Dance" lever, everyone gets the 60 s boost, then the *world's* cooldown runs.

**Why:** Skills give a reason to be present and watching (a lever someone gets to pull is presence flavor that R6 wants anyway), and a shared cooldown creates gentle coordination — do we pop it now or save it for the rabbit? It's a modest engine primitive (timed effect + cooldown in world state) with skills defined in data.

**Games that have it:** Clicker Heroes (9 skills), Realm Grinder (spells/mana), Egg Inc. (boosts).

## Tier 3 — bigger bets, further out

### 11. Slow real-time currency (sugar-lump analog)

**TL;DR:** Cookie Clicker's sugar lumps ripen one per 24 real hours regardless of production, and are spent on leveling buildings and unlocking minigames. Ours: a "heirloom seedling" matures on the patch once a day; the world spends it to level a building type (+1% CpS per level, permanent).

**Why:** A drip that ignores CpS gives the daily check-in a concrete payoff and creates long-horizon goals (level 10 Greenhouses is weeks away by design) that survive prestige. One communal lump per day also forces a tiny daily world decision, which is our kind of fun. Server-side timer + a spend intent; the balance risk is low because the income rate is fixed by the calendar.

**Games that have it:** Cookie Clicker (sugar lumps), Egg Inc. (daily gifts/videos), most mobile idlers (daily chests).

### 12. Building minigames / building levels

**TL;DR:** Cookie Clicker attaches minigames to specific buildings — the Garden (crossbreeding plants for buffs), Stock Market, Pantheon (slot gods for passive effects), Grimoire (spend magic on spells) — unlocked by leveling those buildings with sugar lumps. For us, a single well-chosen one (a literal companion-planting Garden on the shared patch) would be the flagship.

**Why:** Minigames are the deepest engagement layer in the genre and the reason veteran Cookie Clicker players are still logging in years later; a shared garden bed the whole world plants together is an extremely on-brand version. It's the most expensive item on this list (new UI, new engine surface, new protocol messages) — flagging it as the long-term destination rather than a next step.

**Games that have it:** Cookie Clicker (4 minigames), Egg Inc. (missions/artifacts), NGU Idle (many subsystems).

### 13. Second prestige layer (transcendence)

**TL;DR:** Clicker Heroes' transcendence sacrifices even your prestige currency for a higher-order currency and multiplier; Realm Grinder reincarnates; Antimatter Dimensions stacks five-plus reset layers. Ours would be a rare, world-shaking "replant the world" above going-to-seed, converting seeds into something permanent and scarcer.

**Why:** Eventually the seed count itself plateaus emotionally, and a second layer is the genre's proven answer — but it only matters once the world has prestiged many times, so it's listed for completeness, not scheduling. Whenever it happens it should be the most dramatic communal ritual in the game.

**Games that have it:** Clicker Heroes (transcendence), Realm Grinder (reincarnation), Antimatter Dimensions (infinity/eternity/reality), NGU Idle (rebirth tiers).

### 14. Story arc / endgame narrative

**TL;DR:** Universal Paperclips reinvents itself in phases; Cookie Clicker's Grandmapocalypse is a slow-burn horror plot told through upgrades and news. We have the raw cast (the Parsnip Man, the Tomato, the rabbit union, the haunted combine) and a news ticker, but no arc — nothing *happens* as the world climbs from 1e9 to 1e13.

**Why:** Narrative is nearly free in our architecture — news entries, upgrade flavor, and unlock gates are all `data.js` — and it's what turns a number-goes-up game into a story people retell. The late-game ticker entries already gesture at this ("the Singularity hums"); it needs a planned escalation with payoffs, ideally interleaved with features 8 and 13.

**Games that have it:** Universal Paperclips (three-act structure), Cookie Clicker (Grandmapocalypse), Spaceplan, A Dark Room.

## Tier 4 — QoL and polish (small, high-frequency payoff)

### 15. Purchase-efficiency info in tooltips

**TL;DR:** Show payback time ("pays for itself in 4 m 12 s") and %-of-CpS-added on every building/upgrade tooltip, the way AdCap surfaces next-milestone info and the ubiquitous Cookie Monster mod annotates Cookie Clicker. All the numbers are already client-side in every snapshot.

**Why:** It's the P3 spirit applied to purchasing — the game already refuses hidden rules, so it may as well answer "what's the best buy?" honestly instead of making players alt-tab to a calculator. Pure UI-layer change, no engine or protocol impact, probably the best effort-to-value ratio on this list.

**Games that have it:** AdVenture Capitalist (milestone hints), Cookie Clicker's dominant mods (Cookie Monster), Antimatter Dimensions (built-in rate info).

### 16. Buy Max and next-milestone buy amounts

**TL;DR:** AdCap's buy selector offers x1 / x10 / x100 / **Next** (to the next milestone) / **Max** (all you can afford); Cookie Clicker added 10/100 + sell. We have a buy-amount selector and shift-for-10 already — Max and "to next bumper crop" are the missing modes.

**Why:** Late game, banks outrun costs by orders of magnitude and players buy in hundreds; Max respects their time, and "Next" teaches the bumper-crop milestones (feature 3's cousin) by pointing at them. Note: **selling buildings**, the other half of this genre staple, is deliberately out of scope — in a shared world, selling is a griefing vector (P1/P2). Client UI + a small buy-N protocol allowance.

**Games that have it:** AdVenture Capitalist (the template), Cookie Clicker, Clicker Heroes (z/t/q buy modes), Egg Inc.

### 17. Expanded stats screen with world history

**TL;DR:** Cookie Clicker's Stats page is a beloved feature: lifetime totals, per-building production share, golden cookies clicked, prestige history, play time. Ours has a small STATS panel; the expansion is per-building CpS breakdown, rabbit stats, and — uniquely ours — a *world history*: every prestige with date and seed count, biggest harvest day, total tenders ever.

**Why:** In a communal game the stats page doubles as a chronicle — new players ask "what has this world been through?" and nothing currently answers. It reinforces R4 (rules panel) and R6 (contribution flavor) and is mostly UI + a small server-side event log.

**Games that have it:** Cookie Clicker (stats screen), AdVenture Capitalist, Antimatter Dimensions (extensive statistics tabs).

### 18. Options: number notation, volume, reduced motion

**TL;DR:** Genre-standard settings: toggle between short-scale names (1.5 Qa), scientific notation (1.5e15), and full digits; a volume slider instead of binary mute; reduced-motion mode for the canvas effects. Stored as display preferences (localStorage is already sanctioned for preferences per R11).

**Why:** Notation preference is surprisingly divisive among idle players — spreadsheet players want scientific, casual players want names — and accessibility options widen who can leave the game open all day. Pure client-side, no P-conflicts, cheap.

**Games that have it:** Cookie Clicker, Antimatter Dimensions (notation menu is famous, including joke notations), Clicker Heroes, AdVenture Capitalist.

### 19. More content, full stop ⭐ priority

**TL;DR:** Cookie Clicker ships 20 buildings and 700+ upgrades; we have 10 buildings and ~16 hand-written upgrades plus generated tiers, and the upgrade list visibly thins past 1e9. **Field data: two players, without autoclickers, effectively beat the live world in two days** (July 2026) — the horizon is far too short. This is a standing content pipeline: several new buildings before (and after) the Carrot Singularity, tier upgrades past Mythic (150/200/300 owned), ribbons past 1e13, more synergies (only 7 exist), more click upgrades continuing the cpsPct line, more news.

**Why:** R8 + P7 made content pull-request-sized on purpose — `data.js` is the designated contribution surface — so raw content velocity is the cheapest way to extend the game's horizon while the bigger systems above are designed. The multi-condition unlock vocabulary already shipped (R8): `unlock: [{ owned: 0, n: 10 }, { owned: 1, n: 10 }]` gates an upgrade on owning 10 of two different buildings *today*, so cross-building gates are pure data — use them liberally to slow the mid game. Two implementation caveats: **synergy upgrades and the world save reference buildings by index**, so inserting new buildings mid-list needs a save migration — the decided approach (over append-only ordering hacks) is a **one-time migration to id-keyed state**: give buildings stable string ids, serialize counts as a dict keyed by id, point synergies at ids instead of indexes, and `data.js` ordering becomes pure display concern with no future migrations ever needed; and the pacing sim (`tests/sim.js`) asserts the current 4-hour curve, so it gets retuned in the same PR that stretches the economy.

**Games that have it:** All of them; content volume is the baseline the genre competes on.

---

## Deliberately not suggested

- **Per-player anything** (personal achievements, private boosts, individual prestige): violates P1. World-scoped versions are suggested instead (features 3, 5).
- **Selling buildings**: griefing vector in a shared bank; noted under feature 16.
- **Offline-earnings mechanics**: solved better by the always-on server; R5's report is the right remaining piece.
- **Monetization mechanics** (premium currency, ad boosts, time skips): core to AdCap/Egg Inc. but poison to a communal free garden.
- **Export/import saves**: P2 — the server is the only truth; the dev garden already covers local experimentation.

## Research sources

- [Cookie Clicker Wiki — Golden Cookie](https://cookieclicker.wiki.gg/wiki/Golden_Cookie) (effect table, spawn timing, buff stacking)
- [Cookie Clicker Wiki — Achievements](https://cookieclicker.wiki.gg/wiki/Achievement) (622 achievements, milk, shadow achievements)
- [Cookie Clicker Wiki — Minigames](https://cookieclicker.wiki.gg/wiki/Minigames), [Sugar Lump](https://cookieclicker.fandom.com/wiki/Sugar_Lump), [Ascension](https://cookieclicker.fandom.com/wiki/Ascension), [Heavenly Chips](https://cookieclicker.fandom.com/wiki/Heavenly_Chips)
- [Cookie Clicker — Wikipedia](https://en.wikipedia.org/wiki/Cookie_Clicker)
- [Clicker Heroes Wiki — Ascension](https://clickerheroes.fandom.com/wiki/Ascension), [Transcendence](https://clickerheroes.fandom.com/wiki/Transcendence), [Clicker Heroes overview](https://clickerheroes.fandom.com/wiki/Clicker_Heroes) (skills, gilds, clans, mercenaries)
- [Incremental game — Wikipedia](https://en.wikipedia.org/wiki/Incremental_game) (genre conventions: prestige, notation, automation)
- [Kongregate — The Math of Idle Games, Part III](https://www.kongregate.com/en/pages/the-math-of-idle-games-part-iii) (Egg Inc. offline caps, prestige math)
- [GameAnalytics — How to Make an Idle Game](https://www.gameanalytics.com/blog/how-to-make-an-idle-game-adjust) (hook/habit/hobby retention phases)
