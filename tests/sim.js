#!/usr/bin/env node
/* Carrot Clicker pacing harness: greedy bot (3 clicks/sec, best-ROI buys)
   plays several hours; asserts the dopamine curve lands where a clicker
   should — steady unlocks, first prestige within an active session. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const f of ['data.js', 'core.js']) {
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

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
