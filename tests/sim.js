#!/usr/bin/env node
/* Carrot Clicker pacing harness: greedy bot (3 clicks/sec, best-ROI buys)
   plays several hours; asserts the dopamine curve lands where a clicker
   should — steady unlocks, first prestige within an active session. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['data.js', 'core.js', 'net.js']) {
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
const g2 = new CC.Core();
g2.deserialize(JSON.parse(JSON.stringify(g.serialize())));
check(g2.prestiges === g.prestiges && g2.shedLevel('l0') === 2 && g2.sproutsSpent === g.sproutsSpent
  && Math.abs(g2.cps() - g.cps()) < 1e-9, 'levels and counters survive the save');
const oldShed = new CC.Core();
oldShed.deserialize({ v: 1, bank: 0, totalAllTime: 0, totalRun: 0, clicks: 0,
  owned: [], bought: {}, seeds: 0, sprouts: 0, shed: { p0: true } });
check(oldShed.shedLevel('p0') === 1 && Math.abs(oldShed.globalMult() - 1.05) < 1e-9,
  'pre-R15 `true` reads as level 1');

/* growth-budget tripwire: every uncapped ladder's β must fit the budget —
   if a data.js edit trips this, the economy has become super-linear */
console.log('\n=== growth-budget tripwire ===');
let beta = 0.098 + 0.03; /* Fair Circuit (per decade, spec) + Almanac headroom (R16) */
for (const u of CC.SHED) {
  if (!u.repeat || u.max !== undefined) continue;
  if (u.mult) beta += Math.log(u.mult) / Math.log(u.costGrowth);
  if (u.bmult) beta += Math.log(u.bmult) / Math.log(u.costGrowth) / CC.BUILDINGS.length;
}
check(beta < 0.75, `β-budget ${beta.toFixed(3)} < 0.75 (runaway inflation at 1)`);

/* save round-trip */
console.log('\n=== save round-trip ===');
const a = new CC.Core();
a.earn(5e6); a.buy(0, 10); a.buy(1, 5); a.buyUpgrade('b0t0'); a.seeds = 3;
a.sprouts = 9; a.shed = { p0: true };
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

/* lifetime precision at live-world magnitude (audit f1): at 3.4e22 a double's
   ulp is 4,194,304 carrots — naive `+=` absorbed clicks and small ticks */
console.log('\n=== lifetime precision at 3.4e22 ===');
const big = new CC.Core();
big.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [1], bought: {}, seeds: 184711462, sprouts: 0, shed: {} });
const bcps = big.cps();
/* post-R14: seeds ×14.78M × 15 ribbons ×4.255 → one box ≈ 6.29M/s */
check(bcps > 6e6 && bcps < 7e6, `one Window Box at 184.7M seeds makes ~6.29M/s (got ${CC.fmt(bcps)})`);
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
pp.ui = { updatePatchLine() {}, patchEvent() {}, nameResult() {}, toast() {}, rabbit: null };
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
check(CC.fmt(1e36) === '1.00Ud' && CC.fmt(1.8e41) === '180Dd' && CC.fmt(1e45) === '1.00Qad',
  'fmt speaks the new units (Ud/Dd/Td/Qad/Qid)');
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

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
