#!/usr/bin/env node
/* Carrot Clicker pacing harness: greedy bot (3 clicks/sec, best-ROI buys)
   plays several hours; asserts the dopamine curve lands where a clicker
   should — steady unlocks, first prestige within an active session. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['data.js', 'core.js', 'net.js', 'ui.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), { filename: f });
}
const CC = global.CC;

let fails = 0;
const check = (cond, msg) => {
  if (!cond) { fails++; console.log(`  ✗ FAIL: ${msg}`); }
  else console.log(`  ✓ ${msg}`);
};

function play(hours, { prestigeOnce = false } = {}) {
  const core = new CC.Core();
  const milestones = { building: {}, ribbon: {}, firstSeed: null, prestigedAt: null, postCps: null };
  const DT = 1;
  let rabbitAt = 90;

  for (let t = 0; t < hours * 3600; t += DT) {
    core.tick(DT);
    for (let k = 0; k < 3; k++) core.click();

    /* golden rabbit appears on schedule; bot always catches it */
    if (t >= rabbitAt) {
      core.rabbitReward(() => (t % 2 === 0 ? 0.3 : 0.8)); /* alternate frenzy/lucky */
      rabbitAt = t + 150;
    }

    /* buy every affordable upgrade (always correct in this economy) */
    for (const u of core.visibleUpgrades()) {
      if (core.bank >= u.cost) core.buyUpgrade(u.id);
    }

    /* buy the building with best cps-per-carrot among affordable-soon options */
    let best = -1, bestRoi = 0;
    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      const cost = core.costOf(i, 1);
      if (cost > core.bank) continue;
      const gain = CC.BUILDINGS[i].cps * core.buildingMult(i);
      const roi = gain / cost;
      if (roi > bestRoi) { bestRoi = roi; best = i; }
    }
    if (best >= 0) core.buy(best, 1);

    for (let i = 0; i < CC.BUILDINGS.length; i++) {
      if (core.owned[i] > 0 && !(i in milestones.building)) milestones.building[i] = t;
    }
    for (const r of core.ribbons()) {
      if (!(r.name in milestones.ribbon)) milestones.ribbon[r.name] = t;
    }
    if (milestones.firstSeed === null && core.pendingSeeds() >= 1) milestones.firstSeed = t;

    if (prestigeOnce && !milestones.prestigedAt && core.pendingSeeds() >= 5) {
      const before = core.cps();
      core.prestige();
      milestones.prestigedAt = t;
      milestones.cpsBefore = before;
    }
    if (milestones.prestigedAt && !milestones.postCps && t > milestones.prestigedAt + 600) {
      milestones.postCps = core.cps();
    }
  }
  return { core, milestones };
}

console.log('=== 4-hour greedy session ===');
const { core, milestones } = play(4);
const mm = s => `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;

for (let i = 0; i < CC.BUILDINGS.length; i++) {
  const t = milestones.building[i];
  console.log(`  ${CC.BUILDINGS[i].name.padEnd(22)} ${t !== undefined ? 'first at ' + mm(t) : '— not reached'}`);
}
for (const [name, t] of Object.entries(milestones.ribbon)) console.log(`  🎀 ${name.padEnd(20)} at ${mm(t)}`);
console.log(`  first seed available: ${milestones.firstSeed !== null ? mm(milestones.firstSeed) : 'never'}`);
console.log(`  final: bank ${CC.fmt(core.bank)}, cps ${CC.fmt(core.cps())}, lifetime ${CC.fmt(core.totalAllTime)}`);

check(Number.isFinite(core.bank) && Number.isFinite(core.cps()), 'no NaN in the economy');
check(milestones.building[0] < 60, 'first Window Box within a minute');
check(milestones.building[4] !== undefined && milestones.building[4] < 3600, 'Greenhouse (tier 5) within the first hour');
check(milestones.firstSeed !== null && milestones.firstSeed < 2700, `first seed within 45 min (got ${milestones.firstSeed !== null ? mm(milestones.firstSeed) : 'never'})`);
/* late tiers are multi-session content by design (and prestige accelerates them) */
check(Object.keys(milestones.building).length >= 7, `${Object.keys(milestones.building).length}/10 buildings unlocked in 4h (late tiers are multi-session)`);
check(Object.keys(milestones.ribbon).length >= 3, `${Object.keys(milestones.ribbon).length} ribbons won in 4h`);

console.log('\n=== prestige loop ===');
const p = play(3, { prestigeOnce: true });
check(p.milestones.prestigedAt !== null, `prestiged at ${p.milestones.prestigedAt !== null ? mm(p.milestones.prestigedAt) : 'never'}`);
check(p.core.seeds >= 5, `kept ${p.core.seeds} seeds after reset`);
check(p.core.ribbons().length >= 3, 'ribbons survive prestige');
if (p.milestones.postCps) {
  console.log(`  cps 10 min after prestige: ${CC.fmt(p.milestones.postCps)} (was ${CC.fmt(p.milestones.cpsBefore)} before)`);
  check(p.milestones.postCps > 0, 'economy restarts after prestige');
}

/* bumper crops & synergies */
console.log('\n=== bumper crops & synergies ===');
const bc = new CC.Core();
bc.earn(1e12);
bc.tick(0.1); /* latch the almanac's lifetime pages before measuring ratios */
const before = bc.globalMult();
bc.buy(0, 10);
bc.tick(0.1);
check(Math.abs(bc.globalMult() / before - 1.01) < 1e-9, '10th Window Box grants +1% global');
bc.buy(0, 15); /* now 25 */
bc.buy(3, 10);
const evs = bc.tick(0.1);
check(evs.some(e => e.type === 'bumper'), 'bumper milestone fires an event');
check(bc.bumperTotal() === 3, `bumper count is 3 (WB 10+25, Stall 10) — got ${bc.bumperTotal()}`);
const multBefore = bc.buildingMult(0);
check(bc.visibleUpgrades().some(u => u.id === 's0'), 'Sill-to-Stall synergy becomes visible');
bc.buyUpgrade('s0');
check(Math.abs(bc.buildingMult(0) / multBefore - 1.5) < 1e-9, 'synergy: Window Boxes ×1.5 with 10 Market Stalls');
console.log(`  4h-session spread: [${core.owned.join(', ')}] — bumpers ${core.bumperTotal()}`);
check(core.bumperTotal() >= 6, `session earns ${core.bumperTotal()} bumper milestones organically`);

/* the Potting Shed (R13): seeds forever, sprouts spendable */
console.log('\n=== potting shed ===');
const sh = new CC.Core();
sh.earn(25e6); /* lifetime 25M → 5 seeds pending */
const minted = sh.prestige();
check(minted === 5 && sh.sprouts === 5 && sh.seeds === 5, 'prestige mints sprouts 1:1 with seeds');
const gmBefore = sh.globalMult();
check(sh.buyShed('p0'), 'shed item purchasable with sprouts');
check(sh.sprouts === 5 - CC.SHED[0].cost, `sprouts spent, seeds untouched (${sh.seeds} seeds remain)`);
check(sh.seeds === 5, 'seeds are never spent');
check(Math.abs(sh.globalMult() / gmBefore - CC.SHED[0].mult) < 1e-9, 'shed perk multiplies production');
check(!sh.buyShed('p1'), 'cannot overspend sprouts');
check(!sh.buyShed('p0'), 'cannot re-buy a shed item');
sh.earn(1e9);
const minted2 = sh.prestige();
check(sh.shed['p0'] && sh.sprouts === minted2, 'shed purchases survive prestige; new sprouts mint');

/* the Potting Shed grounds (R15): levels, ladders, doublers, resprout */
console.log('\n=== the shed grounds (R15) ===');
const g = new CC.Core();
g.sprouts = 200e6;
check(g.buyShed('p4') && g.shedLevel('p4') === 1, 'keystone one-shot plants once');
check(!g.buyShed('p4'), 'and never twice');
check(!g.shedVisible(CC.SHED.find(u => u.id === 'p6')) && !g.buyShed('p6'),
  'Seed Vault stays locked before 10 springs');
g.prestiges = 10;
check(g.buyShed('p6'), 'and opens at the 10th');
const gm0 = g.globalMult();
const cost0 = g.shedCost('l0');
check(g.buyShed('l0') && g.buyShed('l0') && g.shedLevel('l0') === 2, 'compost climbs by level');
check(g.shedCost('l0') > cost0, 'each turning costs more');
check(Math.abs(g.globalMult() / gm0 - 1.01 * 1.01) < 1e-9, 'and compounds ×1.01 per level');
for (let k = 0; k < 9; k++) g.buyShed('l1');
check(g.shedLevel('l1') === 6, 'sprinklers hard-cap at 6 valves');
const bm0 = g.buildingMult(0);
g.buyShed('h0'); g.buyShed('h0');
check(Math.abs(g.buildingMult(0) / bm0 - 1.21) < 1e-9, 'heirloom strain ×1.10 per level');
check(g.sproutsSpent > 0 && g.sprouts + g.sproutsSpent === 200e6, 'spent sprouts are counted, not lost');
g.buyShed('p9'); /* ×2 mint */
g.earn(9e6); /* 3 seeds pending */
const sp0 = g.sprouts;
const gained2 = g.prestige();
check(gained2 === 3 && g.sprouts === sp0 + 6, 'Propagation Bench doubles the mint');
check(g.owned[0] === 2, 'Parisian Round resprouts to its level each spring');
check(g.tick(0.1).every(e => e.type !== 'bumper'), 'resprout never fires a bumper toast storm');
g.rabbitReward(() => 0.9);
check(g.rabbits === 1, 'rabbit catches are counted');
g.tick(0.1); /* latch the rabbit's almanac page before the save round-trip */
const g2 = new CC.Core();
g2.deserialize(JSON.parse(JSON.stringify(g.serialize())));
check(g2.prestiges === g.prestiges && g2.shedLevel('l0') === 2 && g2.sproutsSpent === g.sproutsSpent
  && Math.abs(g2.cps() - g.cps()) < 1e-9, 'levels and counters survive the save');
const oldShed = new CC.Core();
oldShed.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0,
  owned: [], bought: {}, seeds: 0, sprouts: 0, shed: { p0: true } });
check(oldShed.shedLevel('p0') === 1 && Math.abs(oldShed.globalMult() - 1.05) < 1e-9,
  'pre-R15 `true` reads as level 1');

/* a save is data, not authority (review F1) */
const bad = new CC.Core();
bad.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {},
  seeds: 0, sprouts: 0, shed: { l0: 1e18, hax: 5, p0: true }, almanac: { fake: true, sd0: true } });
check(bad.shedLevel('l0') === bad.shedCap(CC.SHED.find(u => u.id === 'l0'))
  && bad.shedLevel('hax') === 0 && bad.shedLevel('p0') === 1,
  'forged shed levels clamp to the ladder\'s own cap, unknown ids drop, legacy true survives');
/* the live world reached compost 1045 legitimately; a reload must keep it */
const live = new CC.Core();
live.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {},
  seeds: 0, sprouts: 0, shed: { l0: 1045, h9: 106 } });
check(live.shedLevel('l0') === 1045 && live.shedLevel('h9') === 106
  && isFinite(live.shedCost('l0')) && isFinite(live.shedCost('h9')) && isFinite(live.globalMult()),
  'a 1045-turn compost heap survives a reload (the flat cap ate it)');
check(live.shedCap(CC.SHED.find(u => u.id === 'l0')) > 10000
  && live.shedCap(CC.SHED.find(u => u.id === 'h0')) > 1500
  && live.shedCap(CC.SHED.find(u => u.id === 'l1')) === 6, 'caps scale with each ladder\'s growth');
check(!bad.almanac.fake && bad.almanac.sd0 === true
  && isFinite(bad.shedCost('l0')) && isFinite(bad.globalMult()),
  'junk almanac keys drop, real history stays, costs stay finite');

/* the Almanac (R16): deeds latch forever, once, and compound */
console.log('\n=== the Almanac ===');
check(CC.ALMANAC.length === 101, `101 pages in the catalog — 78 + 9 Trial + 8 Seed Bed + 6 Fallow pages (got ${CC.ALMANAC.length})`);
check(new Set(CC.ALMANAC.map(p => p.id)).size === 101, 'page ids unique');
const al = new CC.Core();
al.seeds = 100;
check(al.almanacCount() === 0, 'nothing latches without a tick');
let aev = al.tick(0.1).filter(e => e.type === 'almanac');
check(aev.length === 3 && al.almanacCount() === 3, `seed pages latch on tick (got ${al.almanacCount()})`);
check(Math.abs(al.almanacMult() - Math.pow(1.02, 3)) < 1e-12, 'each page compounds ×1.02');
check(Math.abs(al.globalMult() / al.seedMult() - al.almanacMult()) < 1e-9, 'and lands in globalMult');
aev = al.tick(0.1).filter(e => e.type === 'almanac');
check(aev.length === 0, 'a page is written once');
al.owned[0] = 400;
al.tick(0.1);
check(al.almanac['rn0'] === true, 'Sill City written at 400 window boxes this spring');
al.earn(1.1e10); /* seeds=100 held, so pending needs lifetime past (101)²·1e6 */
al.prestige();
check(al.owned[0] === 0 && al.almanac['rn0'] === true, 'prestige resets the boxes, never the page');
const al2 = new CC.Core();
al2.deserialize(JSON.parse(JSON.stringify(al.serialize())));
check(al2.almanacCount() >= al.almanacCount(), 'pages survive the save');
check(al2.tick(0.1).filter(e => e.type === 'almanac').length === 0, 'and a reload announces nothing');
const pz = new CC.Core();
pz.earn(9e6);
pz.owned[3] = 300; /* Market Saturation, never ticked before the reset */
pz.prestige();
check(pz.almanac['rn3'] === true, 'a deed done in the dying second of a spring still makes the book');
const mir = new CC.Core();
mir.mirrorBook = true; /* a world-mode client must never latch its own pages */
mir.seeds = 100;
check(mir.tick(0.1).filter(e => e.type === 'almanac').length === 0 && mir.almanacCount() === 0,
  'a mirroring client never latches its own pages');

/* skin strings (review P1) */
console.log('\n=== skin strings ===');
const proto = CC.UI.prototype;
check(proto.plural('Window Box') === 'Window Boxes'
  && proto.plural('Carrot Singularity') === 'Carrot Singularities'
  && proto.plural('Greenhouse') === 'Greenhouses', 'building plurals are English');
const h0txt = proto.shedEffectText.call({ plural: proto.plural }, CC.SHED.find(u => u.id === 'h0'));
check(h0txt.includes('Window Boxes'), `heirloom effect text pluralizes (${h0txt})`);

/* seasons (R17): data-driven, time-boxed, engine-predictable */
console.log('\n=== seasons ===');
const se = new CC.Core();
se.earn(1000); se.buy(0, 5);
const seCps = se.cps(), seClick = se.clickPower(), seCost = se.costOf(0, 1);
se.season = 'fair';
check(Math.abs(se.cps() / seCps - 1.05) < 1e-9, 'the County Fair: +5% production');
check(Math.abs(se.clickPower() / seClick - 1.05) < 1e-9, 'and +5% clicks');
se.season = 'market';
check(Math.abs(se.costOf(0, 1) / seCost - 0.9) < 1e-9, 'Market Days: buildings 10% off');
check(se.cps() === seCps, 'and production unchanged');
se.season = 'endless-winter';
check(se.cps() === seCps && se.costOf(0, 1) === seCost, 'unknown seasons behave as homestead (fail-safe)');
se.season = 'fair';
const se2 = new CC.Core();
se2.deserialize(JSON.parse(JSON.stringify(se.serialize())));
check(se2.season === 'homestead',
  'the dev garden never persists a season — ?season= is per-session only');
se2.deserialize({ ...JSON.parse(JSON.stringify(se.serialize())), season: 'hax' });
check(se2.season === 'homestead', 'junk seasons sanitize to homestead');

/* theme packs (R18): one skin per season per time of day */
console.log('\n=== theme packs ===');
check(CC.SEASONS.every(s => CC.THEMES[s.id + '-day'] && CC.THEMES[s.id + '-night']),
  'every season has a day and a night skin');
check(CC.UI.prototype.themeId.call({ core: { season: 'endless-winter' }, dayNight: 'night' }) === 'homestead-night',
  'unknown seasons fall back to the homestead skin');
check(CC.UI.prototype.themeId.call({ core: { season: 'market' }, dayNight: 'day' }) === 'market-day',
  'season + preference pick the pack');
const cssTxt = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
check(Object.keys(CC.THEMES).filter(t => t !== 'homestead-day')
  .every(t => cssTxt.includes(`[data-theme="${t}"]`)),
  'every non-default pack has a CSS block');

/* visitors & weather (R19) */
console.log('\n=== visitors & weather ===');
check(CC.VISITORS.some(v => v.id === 'rabbit') && CC.VISITORS.every(v => v.weight > 0 && v.ttl > 0),
  'visitor table is sane and the classic is present');
const vz = new CC.Core();
vz.earn(1e6); vz.buy(0, 20);
const bank0 = vz.bank;
check(vz.visitorReward('tin').kind === 'tin' && vz.tins === 1 && vz.bank === bank0,
  'the tin rabbit pays nothing and counts one clank');
check(vz.visitorReward('parsnip', () => 0.1).kind === 'embargo'
  && vz.buffs.some(b => b.name === 'Parsnip Embargo' && b.mult === 0.5),
  'a bad gamble is a 45s half-speed embargo');
vz.buffs = [];
const coup = vz.visitorReward('parsnip', () => 0.9);
check(coup.kind === 'coup' && coup.gain > 0 && vz.stalls === 2, 'a good gamble pays the world');
const zc = new CC.Core(); /* freshly prestiged world: bank 0, cps 0 */
check(zc.visitorReward('parsnip', () => 0.9).gain >= 20,
  'a coup never pays a humiliating +0 (click-power floor)');
const cpsBefore = vz.cps();
vz.buffs.push({ name: CC.WEATHER[0].name, mult: CC.WEATHER[0].mult, left: CC.WEATHER[0].dur });
check(Math.abs(vz.cps() / cpsBefore - CC.WEATHER[0].mult) < 1e-9,
  'gentle rain doubles production while it lasts');
vz.weathers = 3;
const vz2 = new CC.Core();
vz2.deserialize(JSON.parse(JSON.stringify(vz.serialize())));
check(vz2.tins === 1 && vz2.stalls === 2 && vz2.weathers === 3, 'visitor counters survive the save');
vz.tins = 25;
vz.tick(0.01);
check(vz.almanac['vt1'] === true, 'the Almanac collects the clanks');

/* growth-budget tripwire: every growth term is DERIVED FROM DATA (review
   f2 — a hardcoded term can never trip), so any data.js edit that makes
   the economy super-linear fails here */
console.log('\n=== growth-budget tripwire ===');
let beta = 0.03; /* reserved headroom for future Almanac cadence (the finite catalog is 0 asymptotically) */
const fair = CC.RIBBONS.filter(r => r.at >= 1e14);
const fairDecades = Math.log10(fair[fair.length - 1].at / 1e13);
beta += 2 * fair.reduce((s, r) => s + Math.log(r.mult), 0) / (Math.LN10 * fairDecades);
for (const u of CC.SHED) {
  if (!u.repeat || u.max !== undefined) continue;
  if (u.mult) beta += Math.log(u.mult) / Math.log(u.costGrowth);
  if (u.bmult) beta += Math.log(u.bmult) / Math.log(u.costGrowth) / CC.BUILDINGS.length;
}
/* 0.62 pins the 2026-07 tail stretch: reverting to per-decade tail rungs
   pushes β back to 0.639 and must trip here (runaway inflation at 1) */
check(beta < 0.62, `β-budget ${beta.toFixed(3)} < 0.62`);

/* dynamic projection: 300 modeled springs from the live state must
   DECELERATE (polynomial growth) — this is the tripwire that actually
   feels RIBBONS/ALMANAC/SHED edits, not just the static sum above */
const w = new CC.Core();
w.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0, owned: [],
  bought: {}, seeds: 184390889, sprouts: 184390889, shed: {} });
const logs = [];
for (let p = 0; p < 300; p++) {
  let bought = true;
  while (bought) { /* greedy communal spending */
    bought = false;
    for (const u of CC.SHED) {
      if (!w.shedMaxed(u) && w.shedVisible(u) && w.sprouts >= w.shedCost(u.id)) {
        w.buyShed(u.id);
        bought = true;
      }
    }
  }
  w.earn(w.globalMult() * 1e6 * 21600); /* ~6h of a built-out world (1e6 base cps) */
  w.tick(0.001);
  w.prestige();
  logs.push(Math.log10(w.totalAllTime));
}
const early = logs[149] - logs[99], late = logs[299] - logs[249];
check(late <= early + 0.01, `growth decelerates (Δlog₁₀/50 springs: ${early.toFixed(2)} → ${late.toFixed(2)})`);
check(logs[299] < 65, `300 springs stay bounded (lifetime 1e${logs[299].toFixed(1)})`);

/* save round-trip */
console.log('\n=== save round-trip ===');
const a = new CC.Core();
a.earn(5e6); a.buy(0, 10); a.buy(1, 5); a.buyUpgrade('b0t0'); a.seeds = 3;
a.sprouts = 9; a.shed = { p0: true };
a.tick(0.01); /* latch almanac pages so both sides of the round-trip hold the same book */
const b = new CC.Core();
b.deserialize(JSON.parse(JSON.stringify(a.serialize())));
check(Math.abs(a.cps() - b.cps()) < 1e-9, 'cps identical after save/load');
check(b.seeds === 3 && b.owned[0] === 10, 'seeds and buildings persist');
check(b.sprouts === 9 && b.shed.p0, 'sprouts and shed persist');
const legacy = a.serialize();
delete legacy.sprouts; delete legacy.shed;
const m = new CC.Core();
m.deserialize(JSON.parse(JSON.stringify(legacy)));
check(m.sprouts === m.seeds && m.seeds === 3, 'pre-R13 save mints retroactive sprouts 1:1 with seeds');

/* bulk buys are all-or-nothing, exactly like the displayed ×N price (audit f9) */
console.log('\n=== bulk buys all-or-nothing ===');
const ao = new CC.Core();
ao.bank = 200; /* costOf(0,10) ≈ 304.6 */
check(!ao.buy(0, 10) && ao.owned[0] === 0 && ao.bank === 200, 'cannot afford ×10: buys none, charges nothing');
ao.bank = 400;
check(ao.buy(0, 10) && ao.owned[0] === 10, 'affordable ×10 bought at the summed geometric price');

/* Max buys (R20): the geometric inverse, verified against costOf */
console.log('\n=== Max buys ===');
const mx = new CC.Core();
mx.bank = mx.costOf(0, 7);
check(mx.maxAffordable(0) === 7, 'bank of exactly seven boxes affords seven');
mx.bank = mx.costOf(0, 7) - 0.01;
check(mx.maxAffordable(0) === 6, 'a hair less affords six');
mx.bank = 0;
check(mx.maxAffordable(0) === 0, 'an empty bank affords none');
mx.bank = 1e300;
const cap = mx.maxAffordable(0);
check(cap <= 5000 && isFinite(mx.costOf(0, cap)), 'an absurd bank caps sanely');
mx.bank = 5000;
const m1 = mx.maxAffordable(0);
mx.season = 'market';
const m2 = mx.maxAffordable(0);
/* a 10% discount adds ~0.75 to the count (steps grow 15%), so it may or
   may not cross an integer — but it can never shrink the reach */
check(m2 >= m1 && mx.costOf(0, m2) <= mx.bank, 'Market Days never shrinks the reach');
mx.season = 'homestead';
check(mx.buy(0, mx.maxAffordable(0)) && mx.bank < mx.costOf(0, 1),
  'buying Max leaves less than one more box');

/* lifetime precision at live-world magnitude (audit f1): at 3.4e22 a double's
   ulp is 4,194,304 carrots — naive `+=` absorbed clicks and small ticks */
console.log('\n=== lifetime precision at 3.4e22 ===');
const big = new CC.Core();
big.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [1], bought: {}, seeds: 184711462, sprouts: 0, shed: {} });
const bcps = big.cps();
/* post-R16: seeds ×14.78M × ribbons ×4.255 × 15 almanac pages ×1.346 ≈ 8.47M/s */
check(bcps > 8e6 && bcps < 9e6, `one Window Box at 184.7M seeds makes ~8.47M/s (got ${CC.fmt(bcps)})`);
for (let k = 0; k < 20; k++) big.tick(1);
const dl = big.totalAllTime - 3.4e22;
check(Math.abs(dl - 20 * bcps) <= 4194304,
  `20 ticks advance lifetime by 20×cps within one ulp (Δ ${CC.fmt(dl)}, want ${CC.fmt(20 * bcps)})`);
const b2 = new CC.Core();
b2.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [], bought: {}, seeds: 0, sprouts: 0, shed: {} });
for (let k = 0; k < 5; k++) b2.earn(1e6);
check(b2.totalRun === 5e6, 'the run accumulator is exact');
check(b2.totalAllTime > 3.4e22, 'five 1M earns are visible at 3.4e22 lifetime (naive += absorbed each one)');

/* mid-run saves: run must be assigned before total, or a reload re-adds the
   run into lifetime and mints phantom seeds (review T1) */
console.log('\n=== mid-run save ordering ===');
const mr = new CC.Core();
mr.deserialize({ v: 1, bank: 1e20, totalAllTime: 3.4e22, totalRun: 5.39e20, clicks: 0,
  owned: [], bought: {}, seeds: 184390889, sprouts: 0, shed: {} });
check(mr.totalAllTime === 3.4e22, 'mid-run lifetime reconstructs exactly (base = total − run)');
check(mr.pendingSeeds() === 0, 'a reload mints no phantom seeds');

/* the world-snapshot handler shares the same ordering constraint (review T2) */
console.log('\n=== patch snapshot ordering ===');
const pp = Object.create(CC.Patch.prototype);
pp.core = new CC.Core();
pp.ui = { updatePatchLine() {}, patchEvent() {}, nameResult() {}, toast() {}, whileAway() {}, rabbit: null };
pp.handle({ type: 'snapshot', online: 3, clickRate: 7, rabbitTtl: 0, state: {
  bank: 1e20, totalAllTime: 3.4e22, totalRun: 5.39e20, clicks: 9,
  owned: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], bought: {}, seeds: 184390889,
  sprouts: 0, shed: {}, buffs: [] } });
check(pp.core.totalAllTime === 3.4e22, 'snapshot reconstructs lifetime exactly (run assigned first)');
check(pp.core.pendingSeeds() === 0, 'no phantom pending seeds after a snapshot');

/* the Fair Circuit (R14): 32 rungs into the former dead zone */
console.log('\n=== the Fair Circuit ===');
check(CC.RIBBONS.length === 38, `38 ribbons on the ladder (got ${CC.RIBBONS.length})`);
check(CC.RIBBONS.every((r, i) => i === 0 || r.at > CC.RIBBONS[i - 1].at),
  'ribbon thresholds strictly ascend');
check(new Set(CC.RIBBONS.map(r => r.name)).size === CC.RIBBONS.length, 'ribbon names unique');
const fc = new CC.Core();
fc.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [], bought: {}, seeds: 0, sprouts: 0, shed: {} });
check(fc.ribbons().length === 15, `live world claims 15 rungs on deploy day (got ${fc.ribbons().length})`);
check(Math.abs(fc.ribbonMult() / (1.5344979552 * Math.pow(1.12, 9)) - 1) < 1e-9,
  `day-one ribbon mult is the old six × 1.12^9 (×${fc.ribbonMult().toFixed(3)})`);
check(CC.fmt(1e36) === '1.00Ud' && CC.fmt(1.8e41) === '180Dd' && CC.fmt(1e45) === '1.00Qad'
  && CC.fmt(1e60) === '1.00Nod', 'fmt speaks the new units (Ud through Vg)');
check(CC.RIBBONS[CC.RIBBONS.length - 1].at === 1e60
  && CC.RIBBONS.filter(r => r.at > 1e30)
    .every((r, i, a) => i === 0 || Math.abs(Math.log10(r.at / a[i - 1].at) - 2) < 1e-9),
  'the stretched tail: two decades between rungs past 1e30, ending at 1e60');
const evs2 = fc.tick(0.1);
check(!evs2.some(e => e.type === 'ribbon'), 'no ribbon toast storm on load — rungs pre-seeded');

/* active buffs survive the save (audit f27) */
console.log('\n=== buffs survive save ===');
const bf = new CC.Core();
bf.earn(1000); bf.buy(0, 5);
bf.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 12 });
const bf2 = new CC.Core();
bf2.deserialize(JSON.parse(JSON.stringify(bf.serialize())));
check(bf2.buffs.length === 1 && Math.abs(bf2.cps() - bf.cps()) < 1e-9, 'an active frenzy survives a save/load');

/* the Parish (R21): honey, Many Hands, the Market Hour, long buffs */
console.log('\n=== the Parish (R21) ===');
const ph = new CC.Core();
check(ph.honey === 0 && ph.handsBonus === 1 && ph.marketHour === false, 'a fresh world has an empty jar and neutral clocks');
ph.earn(1e6); ph.buy(0, 10);
const cps0 = ph.cps(), click0 = ph.clickPower(), cost0p = ph.costOf(0, 5);
ph.handsBonus = 1.04;
check(Math.abs(ph.cps() / cps0 - 1.04) < 1e-12 && Math.abs(ph.clickPower() / click0 - 1.04) < 1e-12,
  'Many Hands multiplies cps and clicks alike (presence-boxed, outside β)');
check(ph.costOf(0, 5) === cost0p, 'Many Hands never touches prices');
ph.handsBonus = 1;
ph.marketHour = true;
check(Math.abs(ph.costOf(0, 5) / cost0p - (1 - CC.MARKET_HOUR.priceOff)) < 1e-12, 'Market Hour takes 20% off the stalls');
ph.season = 'market';
const both = ph.costOf(0, 5) / cost0p;
check(both < 1 - CC.MARKET_HOUR.priceOff && both > 0.5, `Market season + Market Hour compose multiplicatively (×${both.toFixed(3)})`);
check(ph.maxAffordable(0) >= 1, 'maxAffordable uses the same discount');
ph.marketHour = false; ph.season = 'homestead';
const honey0 = ph.honey;
ph.visitorReward('tin');
check(ph.honey === honey0 + CC.HONEY.tin, 'the tin rabbit mints honey');
const seedsBefore = ph.seeds;
ph.seeds = 0; ph.totalAllTime = 1e8; ph.totalRun = 1e8; /* enough for a spring */
const gainedH = ph.prestige();
check(gainedH > 0 && ph.honey === honey0 + CC.HONEY.tin + CC.HONEY.spring, 'a spring mints 10 honey');
check(ph.honey > 0 && ph.cps() >= 0, 'honey is never in the cps formula (a balance, not a multiplier)');
/* the Bee Cooperative: on the clock, never on cps */
const bee = new CC.Core();
bee.sprouts = 1e9; bee.sproutsSpent = 1e6;
for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) bee.buyShed(id);
check(bee.buyShed('p5') && bee.shedLevel('p5') === 1, 'Bee Cooperative plants');
bee.tick(86400 / CC.HONEY.beePerDay - 1);
check(bee.honey === 0, 'no honey before the first hour is up');
bee.tick(2);
check(bee.honey === 1, 'one honey an hour from the bees');
bee.tick(86400);
check(bee.honey === 1 + CC.HONEY.beePerDay, `${CC.HONEY.beePerDay} honey a day`);
/* long buffs (Parish rewards) survive a spring; weather does not */
const lb = new CC.Core();
lb.totalAllTime = 1e8; lb.totalRun = 1e8;
lb.buffs.push({ name: 'Gentle Rain', mult: 2, left: 60 });
lb.buffs.push({ name: 'Bumper Week', mult: 3, left: 172800, keep: true });
lb.prestige();
check(lb.buffs.length === 1 && lb.buffs[0].name === 'Bumper Week', 'a spring clears the weather, never a Parish reward');
const lb2 = new CC.Core();
lb2.deserialize(JSON.parse(JSON.stringify(lb.serialize())));
check(lb2.buffs[0].keep === true && lb2.honey === lb.honey, 'keep flag and honey survive a save');
/* the Market Hour clock: Saturday 09:00–12:00 UTC */
const sat1000 = Date.UTC(2026, 7, 29, 10, 0, 0) / 1000;   /* Sat 29 Aug 2026 */
const sat0859 = Date.UTC(2026, 7, 29, 8, 59, 59) / 1000;
const sat1200 = Date.UTC(2026, 7, 29, 12, 0, 0) / 1000;
const sun = Date.UTC(2026, 7, 23, 0, 0, 0) / 1000;         /* Sun 23 Aug 2026 00:00 */
check(CC.marketHourAt(sat1000).active && !CC.marketHourAt(sat0859).active && !CC.marketHourAt(sat1200).active,
  'Market Hour is open 09:00–12:00 UTC Saturday, closed a second either side');
check(CC.marketHourAt(sun).next === Date.UTC(2026, 7, 29, 9, 0, 0) / 1000
  && CC.marketHourAt(sat1200).next === Date.UTC(2026, 8, 5, 9, 0, 0) / 1000,
  'next opening is the coming Saturday; at noon Saturday it is next week');
check(CC.marketHourAt(sat1000).end === sat1200, 'the end is noon Saturday');
/* readable numbers: a display preference, never a different value */
CC.fmtLong = true;
check(CC.fmt(1234) === '1.23 thousand' && CC.fmt(1.8e41) === '180 duodecillion' && CC.fmt(999) === '999',
  'long numbers speak in words');
CC.fmtLong = false;
check(CC.fmt(1234) === '1.23k', 'short numbers are the default');
check(CC.fmtDur(45) === '45s' && CC.fmtDur(3661) === '1h 1m' && CC.fmtDur(90061) === '1d 1h' && CC.fmtDur(-5) === '0s',
  'durations: s, m s, h m, d h');
/* sanitizer: honey and the bee clock never go bad */
const badH = new CC.Core();
badH.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {},
  seeds: 0, sprouts: 0, shed: {}, honey: -7.5, beeT: 1e12 });
check(badH.honey === 0 && badH.beeT <= 86400, 'negative honey and a runaway bee clock are clamped');

/* Trials (R22): one rule for one spring; rewards are never multipliers */
console.log('\n=== Trials (R22) ===');
const T = CC.TRIAL;
/* a spring with `run` harvested so far and enough lifetime for a seed; bank set, not earned */
const spring = (core, run) => { core.totalRun = run; core.lifetimeBase = Math.max(core.lifetimeBase, 1e7); core.bank = 1e6; };
const tr = new CC.Core();
spring(tr, 3e6); tr.buy(0, 10); tr.buy(1, 5);
check(tr.trialGoal('frost') === 3e6, 'goal is the spring being left (no log yet)');
check(!tr.prestige('nope') || tr.trial === null, 'an unknown trial id is a plain spring');
const tr2 = new CC.Core();
spring(tr2, 3e6);
check(tr2.prestige('frost') > 0 && tr2.trial && tr2.trial.id === 'frost' && tr2.trial.goal === 3e6,
  'going to seed into Late Frost opens a Trial at the spring\'s goal');
check(tr2.runLog.length === 1 && tr2.runLog[0] === 3e6, 'the run log remembers the spring');
tr2.bank = 1e4; tr2.buy(0, 5);
check(tr2.cps() === 0 && tr2.haltT === 180, 'a purchase stills the garden');
tr2.tick(90); /* ribbons/pages latch here too, so compare against the live base */
check(Math.abs(tr2.cps() / tr2.baseCps() - 0.5) < 1e-9, 'half thawed at 90 s');
tr2.tick(100);
check(Math.abs(tr2.cps() / tr2.baseCps() - 1) < 1e-9 && tr2.haltT === 0, 'fully thawed after three minutes');
tr2.bank = 1e6; tr2.buy(0, 5); tr2.haltT = 0; tr2.buyUpgrade('b0t0');
check(tr2.haltT === 180, 'an upgrade is a purchase too');
tr2.trial.t = 0; tr2.haltT = 0;
tr2.bank = 0; tr2.earn(3e6); /* reach the goal */
const won = tr2.tick(0.1);
check(won.some(e => e.type === 'trial' && e.won && e.id === 'frost' && e.n === 1), 'reaching the goal wins the Trial');
check(tr2.trial === null && tr2.trialsDone.frost === 1 && tr2.trialBest.frost > 0 && tr2.perks.scarecrow === 1,
  'the Trial clears, the count and best time record, the Scarecrow is paid');
check(tr2.trialGoal('frost') >= 3e7 && tr2.trialGoal('frost') < 3.1e7, 'the next Late Frost asks a decade more');
tr2.latchPages();
check(tr2.almanac.tr0 === true && !tr2.almanac.tr7, 'The Thaw is written; the set page waits');
/* expiry */
const tx = new CC.Core();
spring(tx, 1e9); tx.prestige('drought');
const gm = tx.globalMult();
tx.trial = null; const gmRaw = tx.globalMult(); tx.trial = { id: 'drought', goal: 1e9, t: 0 };
check(Math.abs(gm - Math.pow(gmRaw, 0.75)) < 1e-12 * gmRaw, 'Drought raises every blessing to the 3/4 power');
const lost = tx.tick(T.hours * 3600 + 1);
check(lost.some(e => e.type === 'trial' && !e.won) && tx.trial === null && !tx.trialsDone.drought,
  'the clock runs out: the spring simply continues, nothing is paid');
/* Crop Rotation: a pyramid of plots */
const cr = new CC.Core();
spring(cr, 1e7); cr.prestige('rotation'); cr.bank = 1e9;
check(!cr.buy(1, 1) && cr.owned[1] === 0, 'no plot may outnumber the one before it');
check(cr.buy(0, 3) && cr.buy(1, 3) && !cr.buy(1, 1) && cr.maxAffordable(1) === 0, 'the chain holds at equal counts');
check(cr.maxAffordable(2) === 3 && cr.buy(2, 2) && cr.rowRoom(2) === 1, 'Max respects the room left in the chain');
/* Short Rows: only six plots exist */
const sr = new CC.Core();
spring(sr, 1e7); sr.prestige('rows'); sr.bank = 1e12; sr.owned[7] = 50;
check(!sr.buy(6, 1) && sr.maxAffordable(6) === 0 && sr.buy(5, 1), 'the seventh plot does not exist; the sixth does');
check(sr.baseCps() === sr.owned[5] * CC.BUILDINGS[5].cps * sr.buildingMult(5) * sr.globalMult(), 'rows past six make nothing');
check(!sr.visibleUpgrades().some(u => u.id === 'b7t0'), 'their upgrades stay off the shelf');
/* Hands Only: the sanctioned bot spring */
const ho = new CC.Core();
spring(ho, 1e7); ho.buyUpgrade('c0');
ho.prestige('hands'); ho.bank = 1e9; ho.buy(0, 50); ho.buy(1, 20);
ho.bought.c1 = true; /* a cpsPct click upgrade, if any — harmless otherwise */
check(ho.cps() === 0 && ho.baseCps(true) > 0, 'the plots sleep');
const pctAny = CC.CLICK_UPGRADES.some(u => u.cpsPct);
ho.shed.l1 = 2;
check(ho.clickPower() > 1 + 0 && ho.clickPower() >= 0.01 * ho.baseCps(true) * ho.buffMult(), 'clicks keep their share of what the plots would make');
void pctAny;
/* the Scarecrow */
const sc = new CC.Core();
sc.perks.scarecrow = 1; sc.earn(1e6);
sc.tick(T.scarecrowEvery + 0.01);
check(sc.owned[0] === 1 && sc.owned[1] === 0, 'Scarecrow lv 1 buys one Window Box a minute (cheapest ≤ 1% of bank)');
sc.bank = 100; sc.tick(T.scarecrowEvery + 0.01);
check(sc.owned[0] === 1, 'and never spends more than 1% of the bank');
/* perks at the next spring */
const pk = new CC.Core();
pk.perks.startTier = 1; pk.perks.resproutCap = 20; pk.shed.h0 = 150;
spring(pk, 1e7); pk.prestige();
check(CC.BUILDINGS.every((_, i) => pk.bought[`b${i}t0`]) && !pk.bought.b0t1, 'springs start with tier-1 upgrades');
check(pk.owned[CC.SHED.find(u => u.id === 'h0').building] === 120, 'heirlooms resprout to 120');
pk.perks.cap.l1 = 2;
check(pk.shedCap(CC.SHED.find(u => u.id === 'l1')) === 8, 'the Sprinkler Network cap rises to 8 valves');
pk.perks.clickFrenzy = 1;
pk.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 10 });
const cpF = pk.clickPower(); pk.perks.clickFrenzy = 0;
check(Math.abs(cpF / pk.clickPower() - 3) < 1e-9, 'Click Frenzy lv 1 triples clicks during a frenzy');
/* a spring mid-Trial abandons it */
const ab = new CC.Core();
spring(ab, 1e7); ab.prestige('fog'); spring(ab, 1e8);
ab.prestige();
check(ab.trial === null && !ab.trialsDone.fog, 'going to seed mid-Trial abandons it');
/* save / load */
const sv = new CC.Core();
spring(sv, 1e7); sv.prestige('hedge'); sv.perks.longEars = 2; sv.trialsDone.frost = 3; sv.trialBest.frost = 1234.5;
sv.haltT = 0; sv.trial.t = 100;
const sv2 = new CC.Core();
sv2.deserialize(JSON.parse(JSON.stringify(sv.serialize())));
check(sv2.trial && sv2.trial.id === 'hedge' && sv2.trial.goal === sv.trial.goal && sv2.trial.t === 100
  && sv2.trialsDone.frost === 3 && sv2.trialBest.frost === 1234.5 && sv2.perks.longEars === 2 && sv2.runLog.length === 1,
  'a Trial, its ledger and the perks survive a save');
const junk = new CC.Core();
junk.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {}, seeds: 0, sprouts: 0, shed: {},
  trial: { id: 'frost', goal: Infinity, t: -5 }, trialsDone: { frost: 99, bogus: 3 }, perks: { scarecrow: 1e9, cap: { l1: 50, zz: 1 } }, runLog: [1, 'x', -2, Infinity], haltT: 1e12 });
check(junk.trial === null && junk.trialsDone.frost === T.maxDone && junk.trialsDone.bogus === undefined
  && junk.perks.scarecrow === 5 && junk.perks.cap.l1 === 10 && junk.perks.cap.zz === undefined && junk.runLog.length === 1 && junk.haltT === 3600,
  'forged Trial state is clamped: no infinite goal, no ladder past its top');
check(!junk.trialAvailable('frost') && junk.trialAvailable('fog'), 'a maxed Trial cannot be entered again');

/* the Seed Bed (R23): a shared bed on a shared clock, recipes by seeded RNG */
console.log('\n=== the Seed Bed (R23) ===');
const B = CC.BED;
check(CC.PLANTS.length === 24 && new Set(CC.PLANTS.map(p => p.id)).size === 24, '24 species, ids unique');
check(CC.PLANTS.every(p => !p.parents || p.parents.every(q => CC.PLANTS.some(x => x.id === q))), 'every recipe names real parents');
check(CC.PLANTS.every(p => p.tier === 1 || p.wild || (p.parents && CC.PLANTS.filter(x => p.parents.includes(x.id)).every(x => x.tier < p.tier))),
  'every cross is born of lower tiers — the tree has no loops');
const bd = new CC.Core();
bd.earn(1e6); bd.buy(0, 20);
const ref = bd.bedCpsRef();
check(ref >= 10 && bd.bedPrice('sprout').carrots === ref * 60, 'a Carrot Sprout costs one minute of steady cps');
check(bd.bedPrice('nettle') === null && bd.bedPrice('honeyroot') === null, 'weeds and undiscovered crosses are not for sale');
check(bd.bedPlant(0, 'sprout') && bd.bedPlant(1, 'clover') && !bd.bedPlant(1, 'thyme'), 'plants go into empty plots only');
check(bd.bedHarvest(0) === null, 'a seedling cannot be picked — there is no uproot');
bd.tick(B.tick * 4 + 1);
check(bd.bed.n === 4 && bd.bed.plots[0].age === 4 && bd.plotMature(bd.bed.plots[0]), 'four bed ticks: the sprout is mature');
check(Math.abs(bd.bedMult() - 1.01) < 1e-12, 'a mature sprout is ×1.01 while it stands');
const bankB = bd.bank, h = bd.bedHarvest(0);
check(h && h.first && h.sp === 'sprout' && bd.bank > bankB && bd.bed.log.sprout === 1 && bd.bed.plots[0] === null,
  'the harvest pays, writes the log, clears the plot');
bd.latchPages();
check(bd.almanac.sb0 === true, 'First Harvest is written');
/* recipes: deterministic from the seed */
const cross = new CC.Core();
cross.bed.seed = 12345;
cross.bed.plots[5] = { sp: 'sprout', age: 3 }; cross.bed.plots[6] = { sp: 'clover', age: 4 };
let found = null;
for (let k = 0; k < 8 && !found; k++) {
  for (const e of cross.bedTick()) if (e.type === 'bedSprout' && e.sp === 'honeyroot') found = k;
}
check(found !== null, `Honeyroot appears between a sprout and a clover (tick ${found})`);
const cross2 = new CC.Core();
cross2.bed.seed = 12345;
cross2.bed.plots[5] = { sp: 'sprout', age: 3 }; cross2.bed.plots[6] = { sp: 'clover', age: 4 };
let found2 = null;
for (let k = 0; k < 8 && found2 === null; k++) {
  for (const e of cross2.bedTick()) if (e.type === 'bedSprout' && e.sp === 'honeyroot') found2 = k;
}
check(found2 === found, 'the same seed rolls the same bed');
const lone = new CC.Core();
lone.bed.seed = 12345; lone.bed.plots[5] = { sp: 'sprout', age: 3 };
let wrong = false;
for (let k = 0; k < 200; k++) for (const e of lone.bedTick()) if (e.type === 'bedSprout' && !CC.PLANTS.find(p => p.id === e.sp).wild) wrong = true;
check(!wrong, 'no cross without both parents; only weeds blow in');
/* soils */
const clay = new CC.Core();
clay.bed.plots[0] = { sp: 'sprout', age: 0 };
check(clay.bedSoil('clay', 1000) && !clay.bedSoil('chips', 1200) && clay.bedSoil('chips', 1000 + B.soilCooldown), 'soil switches honour the world cooldown');
clay.bed.soil = 'clay';
clay.bedTick(); clay.bedTick();
check(clay.bed.plots[0].age === 0, 'clay ages a plant every third tick');
clay.bedTick();
check(clay.bed.plots[0].age === 1, '…and then it does');
clay.bed.plots[0].age = 99;
check(Math.abs(clay.bedMult() - 1.0125) < 1e-12, 'clay gives a quarter more heart (×1.0125 from a sprout)');
/* caps */
const capB = new CC.Core();
for (let i = 0; i < capB.bed.plots.length; i++) capB.bed.plots[i] = { sp: 'fairyring', age: 99 };
check(Math.abs(capB.bedMult() - Math.min(B.multCap, Math.pow(1.05, 16))) < 1e-9 && capB.bedRabbit() === B.rabbitCap && capB.bedWeather() === B.weatherCap,
  `sixteen Fairy Rings are a bounded blessing (×${capB.bedMult().toFixed(2)} production, guests ×${B.rabbitCap}, rain ×${B.weatherCap})`);
/* honey seeds and the sacrifice */
const hs = new CC.Core();
hs.honey = 4;
hs.bed.log.honeyroot = 1;
check(hs.bedPrice('honeyroot').honey === B.honeyTierCost[2] && !hs.bedPlant(0, 'honeyroot'), 'a found cross costs honey, and five is not enough');
hs.honey = 5;
check(hs.bedPlant(0, 'honeyroot') && hs.honey === 0, 'five honey plants it');
for (const p of CC.PLANTS) hs.bed.log[p.id] = 1;
hs.latchPages();
check(hs.logFull() && hs.bedSacrifice() && hs.bed.sacrificeLeft === B.sacrificeWait, 'a full log can be given up — after a wait');
check(hs.bedCancel() && hs.bed.sacrificeLeft === 0 && hs.logFull(), 'anyone can cancel the wait');
hs.bedSacrifice(); hs.tick(B.sacrificeWait + 1);
check(hs.honey === B.sacrificeHoney && hs.sacrifices === 1 && !hs.logFull(), 'the sacrifice pays 100 honey and opens the log again');
hs.latchPages();
check(hs.almanac.sb6 === true && hs.almanac.sb5 === true, 'Seedless to Nay and The Whole Catalogue are written');
/* save / load */
const sv3 = new CC.Core();
sv3.bed.plots[3] = { sp: 'thyme', age: 2 }; sv3.bed.log.sprout = 4; sv3.bed.seed = 777; sv3.bed.soil = 'chips'; sv3.bedT = 42;
const sv4 = new CC.Core();
sv4.deserialize(JSON.parse(JSON.stringify(sv3.serialize())));
check(sv4.bed.plots[3].sp === 'thyme' && sv4.bed.plots[3].age === 2 && sv4.bed.log.sprout === 4 && sv4.bed.seed === 777
  && sv4.bed.soil === 'chips' && sv4.bedT === 42, 'the bed survives a save');
const junkB = new CC.Core();
junkB.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {}, seeds: 0, sprouts: 0, shed: {},
  bed: { soil: 'lava', plots: [{ sp: 'bogus', age: 1 }, { sp: 'sprout', age: 1e9 }, 'x'], log: { bogus: 3, clover: -1, sprout: 2.7 }, seed: -5, sacrificeLeft: 1e9 } });
check(junkB.bed.soil === 'dirt' && junkB.bed.plots[0] === null && junkB.bed.plots[1].age === 12 && junkB.bed.plots[2] === null
  && junkB.bed.log.bogus === undefined && junkB.bed.log.clover === undefined && junkB.bed.log.sprout === 2 && junkB.bed.seed > 0 && junkB.bed.sacrificeLeft === 3600,
  'a forged bed is pruned to known species and sane ages');

/* Lie Fallow (R24): seeds retire into loam; loam buys rules */
console.log('\n=== Lie Fallow (R24) ===');
const F = CC.FALLOW;
const fw = new CC.Core();
fw.seeds = 1.96e22; fw.lifetimeBase = 4.5e50; fw.totalRun = 1e47; fw.bank = 1e48; fw.sprouts = 5e20;
fw.shed = { p0: 1, p1: 1, p5: 1, l0: 1045, l1: 6, h0: 105, h3: 110 }; fw.bought = { c0: true, b0t0: true };
fw.honey = 140; fw.trialsDone = { frost: 2 }; fw.perks.scarecrow = 2; fw.bed.log.sprout = 3; fw.bed.plots[0] = { sp: 'thyme', age: 2 };
fw.buffs = [{ name: 'Gentle Rain', mult: 2, left: 50 }, { name: 'Bumper Week', mult: 3, left: 1e5, keep: true }];
check(fw.loamPending() === 496 && fw.fallowAvailable(), 'the live world\'s first Fallow is worth 496 loam');
const small = new CC.Core(); small.seeds = 1e19;
check(small.loamPending() === 361 && !small.fallowAvailable() && small.fallow() === 0, 'below 1e20 seeds (400 loam) the bell is silent');
check(fw.ribbons().length > 10, 'ribbons stand before the Fallow');
const got = fw.fallow();
check(got === 496 && fw.loam === 496 && fw.fallows === 1, 'the world lies fallow: +496 loam');
check(fw.seeds === 0 && fw.totalAllTime === 0 && fw.bank === 0 && fw.sprouts === 0 && fw.ribbons().length === 0
  && Object.keys(fw.bought).length === 0 && fw.owned.every(n => n === 0), 'seeds, lifetime, ribbons, bank, sprouts, plots, upgrades: gone');
check(fw.shed.p0 === 1 && fw.shed.p5 === 1 && fw.shed.l0 === undefined && fw.shed.l1 === undefined && fw.shed.h0 === undefined,
  'the shed keeps its one-shots and loses its ladders (tm\'s call)');
check(fw.honey === 140 && fw.trialsDone.frost === 2 && fw.perks.scarecrow === 2 && fw.bed.log.sprout === 3 && fw.bed.plots[0].sp === 'thyme',
  'honey, the Trial ledger, perks, the seed log and the bed itself survive');
check(fw.buffs.length === 1 && fw.buffs[0].name === 'Bumper Week', 'the weather clears; the Parish reward stays');
fw.latchPages();
check(fw.almanac.fy0 === true && fw.almanac.fy3 === undefined, 'Fallow Year I is written');
/* the Root Cellar */
check(fw.cellarCost('quick') === 1 && fw.buyCellar('quick') && fw.cellarCost('quick') === 2 && fw.loam === 495, 'level 1 costs 1 loam, level 2 costs 2');
for (let k = 0; k < 10; k++) fw.buyCellar('quick');
check(fw.cellarLevel('quick') === 5 && fw.loam === 496 - 15, 'Quick Spring caps at 5 (1+2+3+4+5 = 15 loam)');
check(!fw.buyCellar('quick') && !fw.buyCellar('bogus'), 'a capped perk and a bogus id buy nothing');
fw.totalRun = 1e8; fw.lifetimeBase = 1e8; fw.bank = 1e6; fw.prestige();
check(fw.owned.every(n => n === 50), 'Quick Spring 5: every spring starts with 50 of each plot');
check(fw.buyCellar('beds') && fw.bedW() === 5 && fw.bed.plots.length === 25 && fw.bed.plots[0].sp === 'thyme', 'Deeper Beds: 5×5, plants kept by position');
fw.bed.plots[24] = { sp: 'clover', age: 1 };
check(fw.buyCellar('beds') && fw.bedW() === 6 && fw.bed.plots.length === 36 && fw.bed.plots[4 * 6 + 4].sp === 'clover' && !fw.buyCellar('beds'),
  '…then 6×6, and no deeper');
check(fw.bedNeighbors(0).length === 3 && fw.bedNeighbors(7).length === 8, 'neighbours follow the new shape');
fw.buyCellar('pace'); fw.buyCellar('pace');
check(fw.scarecrowEvery() === 40, 'Scarecrow Pace 2: every 40 s');
fw.buyCellar('gate');
check(Math.abs(fw.gateRate() - 1.05) < 1e-12, 'Open Gate 1: guests ×1.05');
for (let k = 0; k < 6; k++) fw.buyCellar('memory');
check(fw.cellarLevel('memory') === 6, 'Seed Memory to 6');
fw.seeds = 1e21; fw.lifetimeBase = 1e48;
const got2 = fw.fallow();
check(got2 === 441 && fw.seeds === 1e6 && fw.totalAllTime === 1e18 && fw.pendingSeeds() === 0,
  'Seed Memory 6: the next cycle starts at a million seeds and the lifetime that earned them — no phantom pending seeds');
check(Math.abs(fw.tilthMult() - 1.10) < 1e-12, 'Tilth: two Fallows sweeten the mint by 10%');
const tl = new CC.Core(); tl.fallows = 40;
check(Math.abs(tl.tilthMult() - (1 + F.tilthPerFallow * F.tilthCap)) < 1e-12, 'Tilth caps at 25 Fallows');
tl.seeds = 0; tl.totalRun = 1e8; tl.lifetimeBase = 1e8; tl.bank = 1;
const s0 = tl.sprouts, gT = tl.prestige();
check(gT > 0 && tl.sprouts - s0 === Math.floor(gT * tl.mintMult() * tl.tilthMult()), 'the sprout mint carries Tilth (floored)');
/* save / load */
const fs2 = new CC.Core();
fs2.deserialize(JSON.parse(JSON.stringify(fw.serialize())));
check(fs2.loam === fw.loam && fs2.fallows === 2 && fs2.cellarLevel('beds') === 2 && fs2.bed.plots.length === 36 && fs2.bed.plots[4 * 6 + 4].sp === 'clover',
  'loam, the Cellar and a 6×6 bed survive a save');
const junkF = new CC.Core();
junkF.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0, owned: [], bought: {}, seeds: 0, sprouts: 0, shed: {},
  loam: -3, fallows: 2.5, cellar: { quick: 99, bogus: 1, beds: 1 }, bed: { plots: Array(16).fill(null) } });
check(junkF.loam === 0 && junkF.fallows === 2 && junkF.cellar.quick === 5 && junkF.cellar.bogus === undefined && junkF.bed.plots.length === 25,
  'forged loam and Cellar levels are clamped; the bed is sized by the Cellar');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
