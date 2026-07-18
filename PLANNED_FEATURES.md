# Planned Features

**[DESIGN.md](DESIGN.md) is the law.** Everything below has been filtered against its principles (cite them by number — P1 one world, P2 server is truth, P3 no hidden rules, P4 auto-clickers are gardeners too), entries are ranked by value-for-effort, and anything landing from this list updates DESIGN.md's Tunables table in the same commit it ships. Per P7, each entry notes its layer: **content** (`data.js` only), **engine** (mirrored `core.js` + `economy.py`), or **system** (protocol/server work too).

## Tier 1 — biggest remaining wins

### 1. Golden rabbit effect variety — *engine + content*

The rabbit still rolls only Frenzy or a Lucky bundle; the genre's golden-cookie table has ~9 outcomes weighted so rare ones feel like events. Add Click Frenzy (a sanctioned stage for fast clickers, pure P4), Building Special, and a rare Rabbit Stampede. R19's shared visitor/weather data table is the natural home — each new effect is one mirrored primitive, then data forever.

### 2. Rabbit-boosting upgrades — *system, small*

World upgrades that improve spawn rate, linger time, or payouts (the Lucky Day line, communal edition). County Fair's seasonal rabbits ×2 (R17) proved the knob works; this makes it purchasable. Needs the server to read rabbit tunables from bought upgrades, then it's data.

### 3. Buff bar with stacking buffs — *engine + UI*

There are now real concurrent buffs (Frenzy, Gentle Rain, season bonuses) with no unified timer display. An icon row with countdowns makes stacking legible — and stacked buffs are the genre's skill ceiling, cooperative in our world: one tender's rabbit sets up another's combo.

### 4. Daily world goal — *system*

Earth is already one clan; give it a shared daily/weekly target ("harvest 50M today") with a communal reward. The strongest on-theme retention hook we don't have; goal definitions are data once a small server-side scheduler exists.

## Tier 2 — deepens the loop

### 5. Kitten-analog: upgrades scaling with deeds — *engine primitive + content*

"Prize Judges" whose multiplier scales with ribbons and Almanac pages earned. R16 built the trophy shelf; this converts it from static bragging into a growth axis that makes every future deed instantly valuable.

### 6. Risk-reward states: blight and nibblers — *system, gated late*

The Parsnip Man's stall (R19) introduced the communal gamble; the fuller version is an opt-in world blight (wrath-rabbit odds) and CpS-banking nibblers popped for interest. Everything else in the game is a pure buff — this is where late-game tension comes from.

### 7. Active skills on world cooldowns — *engine + content*

Levers anyone can pull, boosts everyone shares, cooldown the world waits out. Gentle coordination ("save it for the rabbit?") and a reason to be present.

### 8. Heirloom seedling (sugar-lump analog) — *system, small*

One real-time daily currency spent leveling building types permanently. Gives the daily check-in a concrete payoff on a calendar-fixed income the economy can't inflate.

## Tier 3 — bigger bets, further out

### 9. Building minigames — *system, flagship-sized*

One well-chosen shared minigame (a literal companion-planting garden bed) is the long-term destination, not a next step.

### 10. Second prestige layer — *system, ceremonial*

"Replant the world" above Going to Seed. Only matters after many world prestiges; listed for completeness so the eventual design is deliberate.

### 11. Story arc — *content, nearly free*

The cast exists (the Parsnip Man, the Tomato, the rabbit union, the haunted combine) and news/unlocks/flavor are all data; what's missing is a planned escalation with payoffs, ideally interleaved with #6 and #10.

## Tier 4 — QoL (small, high-frequency payoff)

### 12. Purchase-efficiency tooltips — *UI only*

Payback time and %-CpS-added on every tooltip — P3's spirit applied to purchasing. The floating-tooltip rework already shipped, so this is filling in the content.

### 13. Buy Max / buy-to-next-milestone — *UI + small protocol allowance*

Bulk buying is now honest (all-or-nothing ×N); Max and "Next" are the missing modes that respect late-game banks.

### 14. World history chronicle — *UI + small server log*

R15's world counters started the record-keeping on deploy day; the chronicle view (every prestige with date, biggest harvest day, total tenders ever) is what lets a new player ask "what has this world been through?"

### 15. Options: notation, volume, reduced motion — *UI only*

Short-scale / scientific / full-digit toggle, a real volume slider, reduced motion. The ☀/🌙/auto toggle (R18) established the preferences pattern.

## Standing pipeline — more content, full stop ⭐

The horizon problem is structural: two players beat the live world in two days (July 2026). R14/R15/R16 stretched the late game enormously, but the pipeline never closes: new buildings around the Carrot Singularity, tier upgrades past Mythic, more synergies (7 exist), more `cpsPct` click upgrades, more news. `data.js` is the designated contribution surface (R8 + P7) — content PRs are the cheapest horizon we can buy, and the pacing sim gets retuned in the same PR that stretches the economy.

## Deliberately out of scope

Per-player anything — personal achievements, private boosts, individual prestige — violates P1; world-scoped versions are what the entries above propose instead. Selling buildings is a griefing vector in a shared bank. Offline-earnings mechanics are solved better by a server that never sleeps. Monetization mechanics are poison to a communal free garden. Save export/import breaks P2 — the server is the only truth, and the dev garden already covers local experimentation.

---

External genre research backing these entries: [docs/BALANCE_RESEARCH.md](docs/BALANCE_RESEARCH.md).
