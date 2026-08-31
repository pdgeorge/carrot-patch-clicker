#!/usr/bin/env python3
"""Carrot Patch verification: JS<->Python economy parity + live protocol test.

Run with a venv that has fastapi installed:
    python server/test_patch.py
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from carrot_patch.economy import Economy, load_data  # noqa: E402

fails = 0


def check(cond: bool, msg: str) -> None:
    global fails
    if not cond:
        fails += 1
        print(f"  ✗ FAIL: {msg}")
    else:
        print(f"  ✓ {msg}")


# ---------- 1. economy parity: same scripted run in JS core and Python port ----------
print("=== JS <-> Python economy parity ===")
JS_PROBE = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(1e9);
c.buy(0, 30); c.buy(1, 12); c.buy(3, 10); c.buy(5, 3);
c.buyUpgrade('b0t0'); c.buyUpgrade('b0t1'); c.buyUpgrade('c0'); c.buyUpgrade('g0'); c.buyUpgrade('s0');
c.seeds = 7;
c.sprouts = 20; c.buyShed('p0');
c.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 30 });
console.log(JSON.stringify({
  cps: c.cps(), click: c.clickPower(), cost0: c.costOf(0, 10),
  gmult: c.globalMult(), bank: c.bank, pending: c.pendingSeeds(),
  sprouts: c.sprouts,
  smult: c.seedMult(), rmult: c.ribbonMult(), nextAt: c.nextSeedAt(),
}));
"""
js = json.loads(subprocess.run(
    ["node", "-e", JS_PROBE, str(ROOT)], capture_output=True, text=True, check=True).stdout)

py = Economy(load_data())
py.earn(1e9)
py.buy(0, 30); py.buy(1, 12); py.buy(3, 10); py.buy(5, 3)
for uid in ["b0t0", "b0t1", "c0", "g0", "s0"]:
    py.buy_upgrade(uid)
py.seeds = 7
py.sprouts = 20
py.buy_shed("p0")
py.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 30.0})

pairs = [("cps", py.cps()), ("click", py.click_power()), ("cost0", py.cost_of(0, 10)),
         ("gmult", py.global_mult()), ("bank", py.bank), ("pending", py.pending_seeds()),
         ("sprouts", py.sprouts),
         ("smult", py.seed_mult()), ("rmult", py.ribbon_mult()), ("nextAt", py.next_seed_at())]
for name, pv in pairs:
    jv = js[name]
    ok = abs(pv - jv) <= 1e-6 * max(1.0, abs(jv))
    check(ok, f"{name}: py {pv:.6g} == js {jv:.6g}")

# ---------- 1a. lifetime precision parity at live-world magnitude (audit f1) ----------
print("\n=== lifetime precision at 3.4e22 ===")
JS_BIG = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [1], bought: {}, seeds: 184711462, sprouts: 0, shed: {} });
for (let k = 0; k < 20; k++) c.tick(1);
c.earn(1);  // a single carrot must not vanish from the run accumulator
console.log(JSON.stringify({ tat: c.totalAllTime, run: c.totalRun }));
"""
js_big = json.loads(subprocess.run(
    ["node", "-e", JS_BIG, str(ROOT)], capture_output=True, text=True, check=True).stdout)
pb = Economy(load_data())
pb.deserialize({"v": 1, "bank": 0, "totalAllTime": 3.4e22, "totalRun": 0, "clicks": 0,
                "owned": [1], "bought": {}, "seeds": 184711462, "sprouts": 0, "shed": {}})
for _ in range(20):
    pb.tick(1.0)
pb.earn(1)
check(abs(pb.total_all_time - js_big["tat"]) <= 4194304,
      f"lifetime parity at 3.4e22 within one ulp (py {pb.total_all_time!r} js {js_big['tat']!r})")
check(abs(pb.total_run - js_big["run"]) < 1.0, "run accumulator parity")
check(pb.total_run > 20 * 2.2e6, "20 ticks actually accumulated — no float absorption")

# mid-run save: run assigned before total, or a reload mints phantom seeds (review T1)
pmr = Economy(load_data())
pmr.deserialize({"v": 1, "bank": 1e20, "totalAllTime": 3.4e22, "totalRun": 5.39e20,
                 "clicks": 0, "owned": [], "bought": {}, "seeds": 184390889,
                 "sprouts": 0, "shed": {}})
check(pmr.total_all_time == 3.4e22, "mid-run lifetime reconstructs exactly (base = total - run)")
check(pmr.pending_seeds() == 0, "a server restart mints no phantom seeds")

# fmt parity on small decimals, incl. exact ties like 5.25 (review T4/P6)
JS_FMT = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const out = [];
for (let i = 0; i < 200; i++) out.push(CC.fmt(i / 8));
console.log(JSON.stringify(out));
"""
from carrot_patch.economy import fmt as pyfmt  # noqa: E402
js_fmt = json.loads(subprocess.run(
    ["node", "-e", JS_FMT, str(ROOT)], capture_output=True, text=True, check=True).stdout)
mism = [i / 8 for i in range(200) if pyfmt(i / 8) != js_fmt[i]]
check(not mism, f"fmt parity for 0..25 in eighths ({len(mism)} mismatches: {mism[:5]})")

# …and across unit boundaries with exact decimal ties (10.25k etc — review F2/f5)
JS_FMT2 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const out = [];
for (let i = 0; i < 4000; i++) out.push(CC.fmt(i * 12.5));
console.log(JSON.stringify(out));
"""
js_fmt2 = json.loads(subprocess.run(
    ["node", "-e", JS_FMT2, str(ROOT)], capture_output=True, text=True, check=True).stdout)
mism2 = [i * 12.5 for i in range(4000) if pyfmt(i * 12.5) != js_fmt2[i]]
check(not mism2, f"fmt tie parity to 50k ({len(mism2)} mismatches: {mism2[:5]})")

# corrupt saves are data, not authority (review F1: OverflowError killed the server)
bad = {"v": 1, "bank": 0, "totalAllTime": 0, "totalRun": 0, "clicks": 0, "owned": [],
       "bought": {}, "seeds": 0, "sprouts": 0,
       "shed": {"l0": 1e18, "hax": 5, "p0": True}, "almanac": {"fake": True, "sd0": True},
       "tins": "abc", "stalls": 1e999, "weathers": None, "prestiges": [3]}
pbad = Economy(load_data())
pbad.deserialize(dict(bad))
l0_item = next(u for u in pbad.d["shed"] if u["id"] == "l0")
check(pbad.shed_level("l0") == pbad.shed_cap(l0_item) and pbad.shed_level("hax") == 0
      and pbad.shed_level("p0") == 1,
      "forged shed levels clamp to the ladder's own cap, unknown ids drop, legacy true survives")
plive = Economy(load_data())
plive.deserialize({"v": 1, "shed": {"l0": 1045, "h9": 106}})
check(plive.shed_level("l0") == 1045 and plive.shed_level("h9") == 106
      and math.isfinite(plive.shed_cost("l0")) and math.isfinite(plive.global_mult()),
      "the live world's 1045-turn compost heap survives a server restart")
JS_CAP = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
console.log(JSON.stringify(CC.SHED.map(u => c.shedCap(u))));
"""
js_caps = json.loads(subprocess.run(
    ["node", "-e", JS_CAP, str(ROOT)], capture_output=True, text=True, check=True).stdout)
check(js_caps == [plive.shed_cap(u) for u in plive.d["shed"]], "ladder caps identical in both engines")
bad_season = Economy(load_data())
bad_season.deserialize({"v": 1, "season": ["hax"], "seasonStart": {"no": 1}})
check(bad_season.season == "homestead" and bad_season.season_start == 0.0,
      "an unhashable forged season cannot crash the server (review f1)")
check("fake" not in pbad.almanac and pbad.almanac.get("sd0") is True
      and math.isfinite(pbad.shed_cost("l0")) and math.isfinite(pbad.global_mult()),
      "junk almanac keys drop, real history stays, costs stay finite")
check(pbad.tins == 0 and pbad.stalls == 0 and pbad.weathers == 0 and pbad.prestiges == 0,
      "garbage counters zero out instead of crashing the boot (review)")

# R14: Fair Circuit ribbon parity + the new fmt units, in both engines
print("\n=== the Fair Circuit (R14) ===")
JS_R14 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.deserialize({ v: 1, bank: 0, totalAllTime: 3.4e22, totalRun: 0, clicks: 0,
  owned: [], bought: {}, seeds: 184390889, sprouts: 0, shed: {} });
console.log(JSON.stringify({ n: c.ribbons().length, rmult: c.ribbonMult(),
  gmult: c.globalMult(), u36: CC.fmt(1e36), u45: CC.fmt(1e45) }));
"""
js_r14 = json.loads(subprocess.run(
    ["node", "-e", JS_R14, str(ROOT)], capture_output=True, text=True, check=True).stdout)
pr = Economy(load_data())
pr.deserialize({"v": 1, "bank": 0, "totalAllTime": 3.4e22, "totalRun": 0, "clicks": 0,
                "owned": [], "bought": {}, "seeds": 184390889, "sprouts": 0, "shed": {}})
check(len(pr.ribbons()) == js_r14["n"] == 15, "both engines award 15 rungs at 3.4e22")
check(abs(pr.ribbon_mult() - js_r14["rmult"]) <= 1e-9 * js_r14["rmult"], "ribbon_mult parity")
check(abs(pr.global_mult() - js_r14["gmult"]) <= 1e-9 * js_r14["gmult"], "global_mult parity with the circuit")
check(pyfmt(1e36) == js_r14["u36"] == "1.00Ud" and pyfmt(1e45) == js_r14["u45"] == "1.00Qad",
      "new fmt units identical in both engines")

# ---------- 1d. R15: leveled shed / counters / resprout parity ----------
print("\n=== the shed grounds (R15) ===")
JS_R15 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.sprouts = 3e8;
c.prestiges = 12;
['p4','p6','p9','l0','l0','l0','l1','h0','h0','h4'].forEach(id => c.buyShed(id));
c.earn(25e6);
const gained = c.prestige();
console.log(JSON.stringify({
  gained, sprouts: c.sprouts, spent: c.sproutsSpent, lvl0: c.shedLevel('l0'),
  costl0: c.shedCost('l0'), costh0: c.shedCost('h0'), mint: c.mintMult(),
  gmult: c.globalMult(), bm0: c.buildingMult(0), bm4: c.buildingMult(4),
  click: c.clickPower(), owned0: c.owned[0], owned4: c.owned[4], prestiges: c.prestiges,
}));
"""
js15 = json.loads(subprocess.run(
    ["node", "-e", JS_R15, str(ROOT)], capture_output=True, text=True, check=True).stdout)
p15 = Economy(load_data())
p15.sprouts = int(3e8)
p15.prestiges = 12
for uid in ["p4", "p6", "p9", "l0", "l0", "l0", "l1", "h0", "h0", "h4"]:
    p15.buy_shed(uid)
p15.earn(25e6)
gained15 = p15.prestige()
pairs15 = [("gained", gained15), ("sprouts", p15.sprouts), ("spent", p15.sprouts_spent),
           ("lvl0", p15.shed_level("l0")), ("costl0", p15.shed_cost("l0")),
           ("costh0", p15.shed_cost("h0")), ("mint", p15.mint_mult()),
           ("gmult", p15.global_mult()), ("bm0", p15.building_mult(0)),
           ("bm4", p15.building_mult(4)), ("click", p15.click_power()),
           ("owned0", p15.owned[0]), ("owned4", p15.owned[4]), ("prestiges", p15.prestiges)]
for name, pv in pairs15:
    jv = js15[name]
    check(abs(pv - jv) <= 1e-9 * max(1.0, abs(jv)), f"R15 {name}: py {pv:.6g} == js {jv:.6g}")

# ---------- 1e. R16: Almanac latch parity ----------
print("\n=== the Almanac (R16) ===")
JS_R16 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.seeds = 1000; c.clicks = 50000; c.prestiges = 12; c.sprouts = 1e6;
c.buyShed('p4'); c.earn(2e9); c.owned[0] = 400;
const ids = c.tick(1).filter(e => e.type === 'almanac').map(e => e.id).sort();
console.log(JSON.stringify({ ids, n: c.almanacCount(), amult: c.almanacMult(), gmult: c.globalMult() }));
"""
js16 = json.loads(subprocess.run(
    ["node", "-e", JS_R16, str(ROOT)], capture_output=True, text=True, check=True).stdout)
p16 = Economy(load_data())
p16.seeds = 1000
p16.clicks = 50000
p16.prestiges = 12
p16.sprouts = int(1e6)
p16.buy_shed("p4")
p16.earn(2e9)
p16.owned[0] = 400
ids16 = sorted(e["id"] for e in p16.tick(1.0) if e["type"] == "almanac")
check(ids16 == js16["ids"] and len(ids16) > 0,
      f"both engines latch the identical page set ({len(ids16)} pages)")
check(p16.almanac_count() == js16["n"], "page counts match")
check(abs(p16.almanac_mult() - js16["amult"]) <= 1e-12 * js16["amult"], "almanac_mult parity")
check(abs(p16.global_mult() - js16["gmult"]) <= 1e-9 * js16["gmult"], "global_mult parity with pages")

# ---------- 1f. R17: season parity ----------
print("\n=== seasons (R17) ===")
JS_SEA = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(5e4); c.buy(0, 10);
c.season = 'fair';
const fairCps = c.cps(), fairClick = c.clickPower();
c.season = 'market';
const marketCost = c.costOf(0, 10);
console.log(JSON.stringify({ fairCps, fairClick, marketCost }));
"""
js_sea = json.loads(subprocess.run(
    ["node", "-e", JS_SEA, str(ROOT)], capture_output=True, text=True, check=True).stdout)
psea = Economy(load_data())
psea.earn(5e4)
psea.buy(0, 10)
psea.season = "fair"
check(abs(psea.cps() - js_sea["fairCps"]) <= 1e-9 * js_sea["fairCps"], "fair-season cps parity")
check(abs(psea.click_power() - js_sea["fairClick"]) <= 1e-9 * js_sea["fairClick"],
      "fair-season click parity")
psea.season = "market"
check(abs(psea.cost_of(0, 10) - js_sea["marketCost"]) <= 1e-9 * js_sea["marketCost"],
      "market-season price parity")

# ---------- 1f'. R20: Max parity ----------
print("\n=== Max buys (R20) ===")
JS_MAX = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
const out = [];
for (const bank of [0, 15, 304.55, 304.56, 1e6, 1e12, 1e300]) {
  c.bank = bank;
  out.push(c.maxAffordable(0));
}
c.owned[3] = 40; c.bank = 1e9; out.push(c.maxAffordable(3));
c.season = 'market'; out.push(c.maxAffordable(3));
console.log(JSON.stringify(out));
"""
js_max = json.loads(subprocess.run(
    ["node", "-e", JS_MAX, str(ROOT)], capture_output=True, text=True, check=True).stdout)
pm = Economy(load_data())
py_max = []
for bank in [0, 15, 304.55, 304.56, 1e6, 1e12, 1e300]:
    pm.bank = bank
    py_max.append(pm.max_affordable(0))
pm.owned[3] = 40
pm.bank = 1e9
py_max.append(pm.max_affordable(3))
pm.season = "market"
py_max.append(pm.max_affordable(3))
check(py_max == js_max, f"max_affordable identical in both engines ({py_max})")

# ---------- 1g. R19: visitor reward parity ----------
print("\n=== visitors (R19) ===")
JS_VIS = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(1e6); c.buy(0, 20);
const t = c.visitorReward('tin');
const e = c.visitorReward('parsnip', () => 0.1);   // forced embargo
const g = c.visitorReward('parsnip', () => 0.9);   // forced coup
const z = new CC.Core();                            // freshly prestiged: floor binds
const zg = z.visitorReward('parsnip', () => 0.9).gain;
console.log(JSON.stringify({ t: t.kind, e: e.kind, g: g.kind, gain: g.gain,
  tins: c.tins, stalls: c.stalls, bank: c.bank, buffs: c.buffs.length, zg }));
"""
js_vis = json.loads(subprocess.run(
    ["node", "-e", JS_VIS, str(ROOT)], capture_output=True, text=True, check=True).stdout)
pv = Economy(load_data())
pv.earn(1e6)
pv.buy(0, 20)
tv = pv.visitor_reward("tin")
ev = pv.visitor_reward("parsnip", lambda: 0.1)
gv = pv.visitor_reward("parsnip", lambda: 0.9)
check(tv["kind"] == js_vis["t"] == "tin" and pv.tins == js_vis["tins"] == 1,
      "tin: a clank in both engines, once")
check(ev["kind"] == js_vis["e"] == "embargo" and len(pv.buffs) == js_vis["buffs"] == 1
      and pv.buffs[0]["mult"] == 0.5, "embargo: same debuff both sides")
check(gv["kind"] == js_vis["g"] == "coup"
      and abs(gv["gain"] - js_vis["gain"]) <= 1e-9 * max(1.0, js_vis["gain"])
      and abs(pv.bank - js_vis["bank"]) <= 1e-9 * js_vis["bank"],
      "coup: identical windfall and bank in both engines")
check(pv.stalls == js_vis["stalls"] == 2, "two gambles on the record")
pz = Economy(load_data())
zgp = pz.visitor_reward("parsnip", lambda: 0.9)["gain"]
check(zgp == js_vis["zg"] and zgp >= 20, "zero-state coup floor identical in both engines")

# ---------- 1a'. bulk buys all-or-nothing in both engines (audit f9) ----------
print("\n=== bulk buys all-or-nothing parity ===")
JS_AO = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(200);
const r1 = c.buy(0, 10);
c.earn(200);
const r2 = c.buy(0, 10);
console.log(JSON.stringify({ r1, r2, bank: c.bank, owned: c.owned[0] }));
"""
js_ao = json.loads(subprocess.run(
    ["node", "-e", JS_AO, str(ROOT)], capture_output=True, text=True, check=True).stdout)
pao = Economy(load_data())
pao.earn(200)
check(pao.buy(0, 10) == 0 and pao.owned[0] == 0 and abs(pao.bank - 200) < 1e-9,
      "partially-affordable ×10 buys nothing, charges nothing (py)")
pao.earn(200)
check(pao.buy(0, 10) == 10 and pao.owned[0] == 10, "fully-affordable ×10 buys all (py)")
check(js_ao["r1"] is False and js_ao["r2"] is True and abs(js_ao["bank"] - pao.bank) < 1e-9,
      "JS agrees: all-or-nothing, identical remainder")

# ---------- 1b. unlock vocabulary parity (DESIGN R8) ----------
print("\n=== unlock vocabulary parity ===")
UNLOCK = [{"owned": 1, "n": 50}, {"lifetime": 1000}, {"seeds": 2},
          {"clicks": 10}, {"bought": "c0"}, {"shed": "p0"}]
JS_UNLOCK = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
CC.CLICK_UPGRADES.push({ id: 'tu', name: 'Test Unlock', cost: 10,
  unlock: JSON.parse(process.argv[2]) });
const c = new CC.Core();
const vis = () => c.visibleUpgrades().map(u => u.id).sort();
const out = [vis()];
c.earn(1e6); c.owned[1] = 50; c.seeds = 2;
for (let i = 0; i < 10; i++) c.click();
out.push(vis());
c.buyUpgrade('c0');
out.push(vis());
c.sprouts = 99; c.buyShed('p0');
out.push(vis());
console.log(JSON.stringify(out));
"""
js_states = json.loads(subprocess.run(
    ["node", "-e", JS_UNLOCK, str(ROOT), json.dumps(UNLOCK)],
    capture_output=True, text=True, check=True).stdout)

udata = load_data()
udata["clickUpgrades"] = udata["clickUpgrades"] + [
    {"id": "tu", "name": "Test Unlock", "cost": 10, "unlock": UNLOCK}]
pu = Economy(udata)


def visible_ids(e: Economy) -> list[str]:
    return sorted(u["id"] for u in e.all_upgrades() if e.upgrade_visible(u))


py_states = [visible_ids(pu)]
pu.earn(1e6); pu.owned[1] = 50; pu.seeds = 2; pu.do_clicks(10)
py_states.append(visible_ids(pu))
pu.buy_upgrade("c0")
py_states.append(visible_ids(pu))
pu.sprouts = 99
pu.buy_shed("p0")
py_states.append(visible_ids(pu))

for i, (jv, pv) in enumerate(zip(js_states, py_states)):
    check(jv == pv, f"visible-upgrade sets identical at state {i} ({len(pv)} upgrades)")
check("tu" not in py_states[2], "gated upgrade hidden while one condition unmet")
check("tu" in py_states[3], "gated upgrade appears once every condition holds (incl. shed)")

# unknown condition types must fail closed in both engines
udata2 = load_data()
udata2["clickUpgrades"] = udata2["clickUpgrades"] + [
    {"id": "tx", "name": "Future Condition", "cost": 10,
     "unlock": [{"someFutureThing": 5}]}]
px = Economy(udata2)
px.earn(1e9)
check("tx" not in visible_ids(px), "unknown unlock condition fails closed (py)")
js_closed = json.loads(subprocess.run(
    ["node", "-e", JS_UNLOCK, str(ROOT), json.dumps([{"someFutureThing": 5}])],
    capture_output=True, text=True, check=True).stdout)
check(all("tu" not in s for s in js_closed), "unknown unlock condition fails closed (js)")

# ---------- 1b'. wire-int hardening, each junk shape individually (review T3) ----------
print("\n=== clamp_int hardening ===")
from carrot_patch.main import clamp_int  # noqa: E402

for junk in (float("nan"), float("inf"), float("-inf"), None, [1, 2], {}, "junk", object()):
    check(clamp_int(junk, 250) == 0, f"clamp_int({junk!r}) -> 0")
check(clamp_int("25", 250) == 25 and clamp_int(3.9, 250) == 3
      and clamp_int(999, 250) == 250 and clamp_int(-5, 250) == 0,
      "clamp_int keeps sane values sane and clamped")

# ---------- 1g. the Parish (R21): honey, Many Hands, the Market Hour — both engines ----------
print("\n=== R21 Parish parity ===")
JS_R21 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(1e7); c.buy(0, 12); c.buy(1, 4);
c.handsBonus = 1.035; c.marketHour = true; c.season = 'market';
c.visitorReward('tin'); c.visitorReward('stall');
c.sprouts = 1e9; c.sproutsSpent = 1e6;
for (const id of ['p0','p1','p2','p3','p4','p5']) c.buyShed(id);
c.tick(86400 / CC.HONEY.beePerDay + 0.5);
c.buffs.push({ name: 'Bumper Week', mult: 3, left: 172800, keep: true });
c.totalAllTime = 1e9; c.totalRun = 1e9;
const cpsBefore = c.cps();
c.prestige();
const epochs = [Date.UTC(2026,7,23)/1000, Date.UTC(2026,7,29,8,59,59)/1000, Date.UTC(2026,7,29,9)/1000,
  Date.UTC(2026,7,29,11,59,59)/1000, Date.UTC(2026,7,29,12)/1000, Date.UTC(2026,8,2,15,30)/1000];
console.log(JSON.stringify({
  cps: cpsBefore, click: c.clickPower(), cost0: c.costOf(0, 10), max0: c.maxAffordable(0),
  honey: c.honey, beeT: c.beeT, buffs: c.buffs.length, disc: c.priceDisc(),
  mh: epochs.map(e => { const m = CC.marketHourAt(e); return [m.active ? 1 : 0, m.next, m.end]; }),
  snap: c.serialize(),
}));
"""
js21 = json.loads(subprocess.run(
    ["node", "-e", JS_R21, str(ROOT)], capture_output=True, text=True, check=True).stdout)
from carrot_patch.economy import market_hour_at  # noqa: E402
p21 = Economy(load_data())
p21.earn(1e7); p21.buy(0, 12); p21.buy(1, 4)
p21.hands_bonus = 1.035; p21.market_hour = True; p21.season = "market"
p21.visitor_reward("tin"); p21.visitor_reward("stall")
p21.sprouts = 1e9; p21.sprouts_spent = 1e6
for sid in ["p0", "p1", "p2", "p3", "p4", "p5"]:
    p21.buy_shed(sid)
p21.tick(86400 / p21.d["honey"]["beePerDay"] + 0.5)
p21.buffs.append({"name": "Bumper Week", "mult": 3, "left": 172800.0, "keep": True})
p21.total_all_time = 1e9; p21.total_run = 1e9
cps_before = p21.cps()
p21.prestige()
for name, pv in [("cps", cps_before), ("click", p21.click_power()), ("cost0", p21.cost_of(0, 10)),
                 ("disc", p21.price_disc())]:
    check(abs(pv - js21[name]) <= 1e-9 * max(1.0, abs(js21[name])), f"R21 {name}: py {pv:.6g} == js {js21[name]:.6g}")
check(p21.max_affordable(0) == js21["max0"], "max_affordable under the Market Hour discount matches")
check(p21.honey == js21["honey"] == 1 + 1 + 1 + 10, f"honey ledger identical: tin + stall + bee + spring = {p21.honey}")
check(abs(p21.bee_t - js21["beeT"]) < 1e-9, "bee clock remainder identical")
check(len(p21.buffs) == js21["buffs"] == 1, "a spring keeps the Parish reward in both engines")
d21 = load_data()
py_mh = []
for e in [1787443200.0, 1787993999.0, 1787994000.0, 1788004799.0, 1788004800.0, 1788363000.0]:
    m = market_hour_at(e, d21)
    py_mh.append([1 if m["active"] else 0, m["next"], m["end"]])
check(py_mh == js21["mh"], f"market_hour_at matches CC.marketHourAt at six epochs ({py_mh[2]})")
check(py_mh[2][0] == 1 and py_mh[3][0] == 1 and py_mh[1][0] == 0 and py_mh[4][0] == 0,
      "Saturday 09:00 opens, 11:59:59 is open, 08:59:59 and 12:00 are shut")
p21b = Economy(load_data())
p21b.deserialize(js21["snap"])
check(p21b.honey == js21["honey"] and abs(p21b.bee_t - js21["beeT"]) < 1e-9
      and p21b.buffs and p21b.buffs[0].get("keep") is True, "a JS save carries honey, the bee clock and keep into Python")
p21c = Economy(load_data())
p21c.deserialize({"v": 1, "bank": 0, "totalAllTime": 0, "totalRun": 0, "clicks": 0, "owned": [],
                  "bought": {}, "seeds": 0, "sprouts": 0, "shed": {}, "honey": -3, "beeT": 1e12})
check(p21c.honey == 0 and p21c.bee_t <= 86400, "negative honey and a runaway bee clock are clamped (py)")
check(p21.snapshot()["honey"] == p21.honey and p21.snapshot()["handsBonus"] == 1.035
      and p21.snapshot()["marketHour"] is True, "snapshot carries honey, Many Hands and the Market Hour")

# ---------- 1h. Trials (R22): the same rule-bound spring in both engines ----------
print("\n=== R22 Trials parity ===")
JS_R22 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const out = {};
const run = (id, fn) => { const c = new CC.Core(); c.totalRun = 5e6; c.runT = 7200; c.lifetimeBase = 2e7; c.bank = 1e6; c.shed.l1 = 3;
  c.bought.c0 = true; c.buy(0, 5); c.buy(1, 2); c.prestige(id); c.bank = 1e9; fn(c); return c; };
const f = run('frost', c => { c.buy(0, 12); c.buy(1, 4); c.tick(45); });
out.frost = { cps: f.cps(), click: f.clickPower(), halt: f.haltT, goal: f.trial.goal, t: f.trial.t };
const r = run('rotation', c => { c.buy(0, 7); c.buy(1, 7); c.buy(1, 1); c.buy(2, 3); });
out.rotation = { owned: r.owned.slice(0, 4), max2: r.maxAffordable(2), max1: r.maxAffordable(1), cps: r.cps() };
const s = run('rows', c => { c.buy(5, 2); c.buy(6, 1); c.owned[8] = 9; });
out.rows = { owned: s.owned, cps: s.cps(), vis: s.visibleUpgrades().map(u => u.id), max6: s.maxAffordable(6) };
const h = run('hands', c => { c.buy(0, 30); c.buy(3, 4); });
out.hands = { cps: h.cps(), click: h.clickPower(), raw: h.baseCps(true) };
const d = run('drought', c => { c.buy(0, 30); c.buy(2, 4); c.seeds = 50; });
out.drought = { cps: d.cps(), gm: d.globalMult() };
/* win a trial, collect the perk, carry it into the next spring */
const w = run('frost', c => { c.haltT = 0; c.earn(1e7); c.tick(0.5); });
w.perks.startTier = 1; w.perks.cap.l1 = 2; w.perks.clickFrenzy = 1;
w.totalRun = 1e8; w.lifetimeBase = 1e9; w.bank = 0; w.prestige();
w.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 10 });
out.won = { done: w.trialsDone, best: w.trialBest.frost, scarecrow: w.perks.scarecrow, goalNext: w.trialGoal('frost'),
  bought: Object.keys(w.bought).sort(), cap: w.shedCap(CC.SHED.find(u => u.id === 'l1')), click: w.clickPower(), log: w.runBest };
const hp = new CC.Core(); hp.lifetimeBase = 1e7; hp.runT = 7200; hp.bank = 1e12; for (let i = 0; i < 10; i++) hp.buy(i, 30); hp.totalRun = 1e9; hp.shed.l1 = 2; hp.bought.c0 = true;
out.handicaps = CC.TRIALS.map(t => [t.id, hp.ruleHandicap(t.id), hp.trialGoal(t.id)]);
const sc = new CC.Core(); sc.perks.scarecrow = 2; sc.bank = 5e6; sc.tick(61); sc.tick(61);
out.scarecrow = { owned: sc.owned, bank: sc.bank };
out.snap = w.serialize();
console.log(JSON.stringify(out));
"""
js22 = json.loads(subprocess.run(
    ["node", "-e", JS_R22, str(ROOT)], capture_output=True, text=True, check=True).stdout)


def run22(tid, fn):
    c = Economy(load_data())
    c.total_run = 5e6; c.run_t = 7200; c._lifetime_base = 2e7; c.bank = 1e6; c.shed["l1"] = 3
    c.bought["c0"] = True
    c.buy(0, 5); c.buy(1, 2)
    c.prestige(tid); c.bank = 1e9
    fn(c)
    return c


def near(a, b, tol=1e-9):
    return abs(a - b) <= tol * max(1.0, abs(b))


pf = run22("frost", lambda c: (c.buy(0, 12), c.buy(1, 4), c.tick(45)))
j = js22["frost"]
check(near(pf.cps(), j["cps"]) and near(pf.click_power(), j["click"]) and pf.halt_t == j["halt"]
      and pf.trial["goal"] == j["goal"] and pf.trial["t"] == j["t"], f"Late Frost: cps/click/halt/goal identical (halt {pf.halt_t})")
pr = run22("rotation", lambda c: (c.buy(0, 7), c.buy(1, 7), c.buy(1, 1), c.buy(2, 3)))
j = js22["rotation"]
check(pr.owned[:4] == j["owned"] and pr.max_affordable(2) == j["max2"] and pr.max_affordable(1) == j["max1"]
      and near(pr.cps(), j["cps"]), f"Crop Rotation: the chain refuses the same buys ({pr.owned[:4]})")
ps = run22("rows", lambda c: (c.buy(5, 2), c.buy(6, 1), c.owned.__setitem__(8, 9)))
j = js22["rows"]
check(ps.owned == j["owned"] and near(ps.cps(), j["cps"]) and ps.max_affordable(6) == j["max6"]
      and sorted(u["id"] for u in ps.all_upgrades() if ps.upgrade_visible(u)) == sorted(j["vis"]),
      "Short Rows: six plots, same cps, same shelf")
ph = run22("hands", lambda c: (c.buy(0, 30), c.buy(3, 4)))
j = js22["hands"]
check(ph.cps() == j["cps"] == 0 and near(ph.click_power(), j["click"]) and near(ph.base_cps(True), j["raw"]),
      "Hands Only: plots make nothing, clicks keep their share")
pd = run22("drought", lambda c: (c.buy(0, 30), c.buy(2, 4), setattr(c, "seeds", 50)))
j = js22["drought"]
check(near(pd.cps(), j["cps"]) and near(pd.global_mult(), j["gm"]), "Drought: the 3/4 power agrees")
pw = run22("frost", lambda c: (setattr(c, "halt_t", 0.0), c.earn(1e7), c.tick(0.5)))
pw.perks["startTier"] = 1; pw.perks["cap"]["l1"] = 2; pw.perks["clickFrenzy"] = 1
pw.total_run = 1e8; pw._lifetime_base = 1e9; pw.bank = 0.0; pw.prestige()
pw.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 10.0})
j = js22["won"]
check(pw.trials_done == j["done"] and near(pw.trial_best["frost"], j["best"]) and pw.perks["scarecrow"] == j["scarecrow"]
      and near(pw.trial_goal("frost"), j["goalNext"]), "a won Trial records the same ledger and next goal")
check(sorted(pw.bought) == j["bought"] and pw.shed_cap(next(u for u in pw.d["shed"] if u["id"] == "l1")) == j["cap"]
      and near(pw.click_power(), j["click"]) and pw.run_best == j["log"], "perks land identically at the next spring")
hp = Economy(load_data()); hp._lifetime_base = 1e7; hp.run_t = 7200; hp.bank = 1e12
for i in range(10):
    hp.buy(i, 30)
hp.total_run = 1e9; hp.shed["l1"] = 2; hp.bought["c0"] = True
py_h = [[t["id"], hp.rule_handicap(t["id"]), hp.trial_goal(t["id"])] for t in hp.d["trials"]]
check(all(a[0] == b[0] and near(a[1], b[1]) and near(a[2], b[2]) for a, b in zip(py_h, js22["handicaps"])),
      "every rule's handicap and goal agree (" + ", ".join(f"{a[0]} {a[1]:.3f}" for a in py_h) + ")")
psc = Economy(load_data()); psc.perks["scarecrow"] = 2; psc.bank = 5e6; psc.tick(61); psc.tick(61)
check(psc.owned == js22["scarecrow"]["owned"] and near(psc.bank, js22["scarecrow"]["bank"]), f"the Scarecrow buys the same rows ({psc.owned[:4]})")
p22 = Economy(load_data()); p22.deserialize(js22["snap"])
check(p22.trials_done == pw.trials_done and p22.perks == pw.perks and p22.run_best == pw.run_best and p22.trial is None,
      "a JS save's Trial ledger and perks load into Python")
p22b = Economy(load_data())
p22b.deserialize({"v": 1, "bank": 0, "totalAllTime": 0, "totalRun": 0, "clicks": 0, "owned": [], "bought": {}, "seeds": 0,
                  "sprouts": 0, "shed": {}, "trial": {"id": "frost", "goal": float("inf"), "t": -5},
                  "trialsDone": {"frost": 99, "bogus": 3}, "perks": {"scarecrow": 1e9, "cap": {"l1": 50, "zz": 1}},
                  "runLog": [1, "x", -2, 1e999], "haltT": 1e12})
check(p22b.trial is None and p22b.trials_done == {"frost": 5} and p22b.perks["scarecrow"] == 5
      and p22b.perks["cap"] == {"l1": 10} and p22b.run_best == 1.0 and p22b.halt_t == 3600.0,
      "forged Trial state clamps identically (py)")

# ---------- 1i. the Seed Bed (R23): the same seed grows the same garden in both engines ----------
print("\n=== R23 Seed Bed parity ===")
JS_R23 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.earn(1e7); c.buy(0, 25); c.buy(1, 10); c.honey = 50;
c.bed.seed = 424242;
const r = { plant: [c.bedPlant(0, 'sprout'), c.bedPlant(1, 'clover'), c.bedPlant(5, 'thyme'), c.bedPlant(4, 'bluebell'), c.bedPlant(0, 'thyme'), c.bedPlant(2, 'nettle')] };
r.bankAfterPlant = c.bank;
c.bed.plots[10] = { sp: 'sprout', age: 3 }; c.bed.plots[11] = { sp: 'clover', age: 4 }; c.bed.plots[14] = { sp: 'clover', age: 4 };
c.bed.plots[15] = { sp: 'thyme', age: 6 }; c.bed.plots[9] = { sp: 'bluebell', age: 5 };
c.bedSoil('chips', 5000);
const evs = [];
for (let k = 0; k < 9; k++) evs.push(...c.bedTick());
r.events = evs; r.plots = c.bed.plots.map(pl => pl && { ...pl }); r.seed = c.bed.seed; r.n = c.bed.n;
r.mult = c.bedMult(); r.rabbit = c.bedRabbit(); r.weather = c.bedWeather(); r.cps = c.cps(); r.click = c.clickPower();
const mi = c.bed.plots.findIndex(pl => pl && c.plotMature(pl));
r.harvestIdx = mi; r.harvest = mi >= 0 ? c.bedHarvest(mi) : null; r.bank = c.bank; r.honey = c.honey; r.log = { ...c.bed.log };
r.priceHoney = c.bedPrice(r.harvest ? r.harvest.sp : 'sprout');
c.tick(CC.BED.tick * 2 + 7); r.bedT = c.bedT; r.n2 = c.bed.n;
c.bed.soil = 'clay'; c.bed.plots[2] = { sp: 'beebalm', age: 7 }; c.bed.plots[3] = { sp: 'heartwood', age: 16 };
r.clayHoney = [c.bedHarvest(2).honey, c.bedHarvest(3).honey];
r.snap = c.serialize();
console.log(JSON.stringify(r));
"""
js23 = json.loads(subprocess.run(
    ["node", "-e", JS_R23, str(ROOT)], capture_output=True, text=True, check=True).stdout)
p23 = Economy(load_data())
p23.earn(1e7); p23.buy(0, 25); p23.buy(1, 10); p23.honey = 50
p23.bed["seed"] = 424242
plant = [p23.bed_plant(0, "sprout"), p23.bed_plant(1, "clover"), p23.bed_plant(5, "thyme"), p23.bed_plant(4, "bluebell"),
         p23.bed_plant(0, "thyme"), p23.bed_plant(2, "nettle")]
check(plant == js23["plant"] and near(p23.bank, js23["bankAfterPlant"]), f"planting agrees, bank agrees ({plant})")
p23.bed["plots"][10] = {"sp": "sprout", "age": 3}; p23.bed["plots"][11] = {"sp": "clover", "age": 4}; p23.bed["plots"][14] = {"sp": "clover", "age": 4}
p23.bed["plots"][15] = {"sp": "thyme", "age": 6}; p23.bed["plots"][9] = {"sp": "bluebell", "age": 5}
p23.bed_soil("chips", 5000)
evs = []
for _ in range(9):
    evs.extend(p23.bed_tick())
check(evs == js23["events"], f"nine bed ticks roll the same {len(evs)} events from the same seed")
check(p23.bed["plots"] == js23["plots"] and p23.bed["seed"] == js23["seed"] and p23.bed["n"] == js23["n"], "the same garden stands")
check(near(p23.bed_mult(), js23["mult"]) and near(p23.bed_rabbit(), js23["rabbit"]) and near(p23.bed_weather(), js23["weather"]),
      f"live effects agree (×{p23.bed_mult():.4f}, guests ×{p23.bed_rabbit():.3f}, rain ×{p23.bed_weather():.3f})")
check(near(p23.cps(), js23["cps"]) and near(p23.click_power(), js23["click"]), "cps and clicks carry the bed")
mi = next((i for i, pl in enumerate(p23.bed["plots"]) if pl and p23.plot_mature(pl)), -1)
h = p23.bed_harvest(mi) if mi >= 0 else None
check(mi == js23["harvestIdx"] and (h == js23["harvest"] or (h and js23["harvest"] and h["sp"] == js23["harvest"]["sp"]
      and near(h["gain"], js23["harvest"]["gain"]) and h["honey"] == js23["harvest"]["honey"] and h["first"] == js23["harvest"]["first"])),
      f"the harvest pays the same ({h and h['sp']})")
check(near(p23.bank, js23["bank"]) and p23.honey == js23["honey"] and p23.bed["log"] == js23["log"], "bank, honey and the log agree")
check(p23.bed_price(h["sp"] if h else "sprout") == js23["priceHoney"] or near(p23.bed_price(h["sp"] if h else "sprout").get("carrots", 0), (js23["priceHoney"] or {}).get("carrots", 0)),
      "prices agree after the log is written")
p23.tick(p23.d["bed"]["tick"] * 2 + 7)
check(near(p23.bed_t, js23["bedT"]) and p23.bed["n"] == js23["n2"], "the bed clock ticks in step with the world")
p23.bed["soil"] = "clay"; p23.bed["plots"][2] = {"sp": "beebalm", "age": 7}; p23.bed["plots"][3] = {"sp": "heartwood", "age": 16}
clay_h = [p23.bed_harvest(2)["honey"], p23.bed_harvest(3)["honey"]]
check(clay_h == js23["clayHoney"] == [3, 13], f"honey on Clay rounds half UP in both engines ({clay_h})")
p23b = Economy(load_data()); p23b.deserialize(js23["snap"])
check(p23b.bed["plots"] == p23.bed["plots"] and p23b.bed["log"] == p23.bed["log"] and p23b.bed["seed"] == p23.bed["seed"]
      and p23b.bed["soil"] == "clay", "a JS save's bed loads into Python intact")

# ---------- 1j. Lie Fallow (R24): the same retirement in both engines ----------
print("\n=== R24 Lie Fallow parity ===")
JS_R24 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.seeds = 1.96e22; c.lifetimeBase = 4.5e50; c.totalRun = 1e47; c.bank = 1e48; c.sprouts = 5e20;
c.shed = { p0: 1, p5: 1, p9: 1, l0: 1045, l1: 6, h0: 105 }; c.bought = { c0: true }; c.honey = 140; c.fallows = 1;
c.bed.plots[3] = { sp: 'thyme', age: 2 }; c.bed.log.sprout = 3; c.perks.startTier = 1;
const out = { pending: c.loamPending(), avail: c.fallowAvailable(), gain: c.fallow() };
for (const id of ['quick', 'quick', 'beds', 'pace', 'gate', 'memory', 'memory', 'orders']) c.buyCellar(id);
out.loam = c.loam; out.cellar = { ...c.cellar }; out.bedW = c.bedW(); out.plots = c.bed.plots.length; out.thyme = c.bed.plots[3];
out.every = c.scarecrowEvery(); out.gate = c.gateRate(); out.tilth = c.tilthMult();
c.totalRun = 4e8; c.lifetimeBase = 1e8; c.bank = 1; out.gained = c.prestige(); out.sprouts = c.sprouts; out.owned = c.owned; out.bought = Object.keys(c.bought).sort();
c.seeds = 1e21; out.gain2 = c.fallow(); out.seeds = c.seeds; out.tat = c.totalAllTime; out.pendingSeeds = c.pendingSeeds();
out.cps = c.cps(); out.shed = c.shed; out.snap = c.serialize();
console.log(JSON.stringify(out));
"""
js24 = json.loads(subprocess.run(
    ["node", "-e", JS_R24, str(ROOT)], capture_output=True, text=True, check=True).stdout)
p24 = Economy(load_data())
p24.seeds = 1.96e22; p24._lifetime_base = 4.5e50; p24.total_run = 1e47; p24.bank = 1e48; p24.sprouts = 5e20
p24.shed = {"p0": 1, "p5": 1, "p9": 1, "l0": 1045, "l1": 6, "h0": 105}; p24.bought = {"c0": True}; p24.honey = 140; p24.fallows = 1
p24.bed["plots"][3] = {"sp": "thyme", "age": 2}; p24.bed["log"]["sprout"] = 3; p24.perks["startTier"] = 1
check(p24.loam_pending() == js24["pending"] == 496 and p24.fallow_available() == js24["avail"] is True, "496 loam pending, the bell available")
check(p24.fallow() == js24["gain"] == 496, "the Fallow pays the same")
for cid in ["quick", "quick", "beds", "pace", "gate", "memory", "memory", "orders"]:
    p24.buy_cellar(cid)
check(p24.loam == js24["loam"] and p24.cellar == js24["cellar"] and p24.bed_w() == js24["bedW"] and len(p24.bed["plots"]) == js24["plots"]
      and p24.bed["plots"][3] == js24["thyme"], f"the Cellar buys identically ({p24.cellar}, loam {p24.loam})")
check(p24.scarecrow_every() == js24["every"] and near(p24.gate_rate(), js24["gate"]) and near(p24.tilth_mult(), js24["tilth"]), "pace, gate and tilth agree")
p24.total_run = 4e8; p24._lifetime_base = 1e8; p24.bank = 1.0
check(p24.prestige() == js24["gained"] and p24.sprouts == js24["sprouts"] and p24.owned == js24["owned"] and sorted(p24.bought) == js24["bought"],
      f"a Quick Spring with Tilth starts the same ({p24.owned[:3]}…, {p24.sprouts} sprouts)")
p24.seeds = 1e21
check(p24.fallow() == js24["gain2"] and p24.seeds == js24["seeds"] and p24.total_all_time == js24["tat"] and p24.pending_seeds() == js24["pendingSeeds"] == 0,
      f"Seed Memory starts the next cycle identically ({p24.seeds} seeds)")
check(near(p24.cps(), js24["cps"]) and p24.shed == js24["shed"], "cps and the surviving shed agree")
p24b = Economy(load_data()); p24b.deserialize(js24["snap"])
check(p24b.loam == p24.loam and p24b.cellar == p24.cellar and p24b.fallows == 3 and len(p24b.bed["plots"]) == 25,
      "a JS save's loam, Cellar and 5×5 bed load into Python")

# ---------- 1k. the Honey Stall & the Cellar tree (R25): both engines agree ----------
print("\n=== R25 Stall & tree parity ===")
JS_R25 = r"""
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['data.js', 'core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(process.argv[1], 'src', f), 'utf8'));
}
const c = new CC.Core();
c.honey = 300;
const out = { buys: ['clover4', 'clover4', 'sugar', 'candle', 'candle', 'candle', 'candle', 'gnome', 'bogus'].map(id => c.buyCharm(id)) };
out.honey = c.honey; out.charms = { ...c.charms }; out.bought = c.charmsBought;
out.buffs = c.buffs.map(b => [b.charm, b.mult, b.left, !!b.keep]);
out.candleUse = [c.useCandle(), c.useCandle(), c.useCandle(), c.useCandle()];
c.loam = 5000;
out.tree = ['coldframe', 'quick', 'beds', 'coldframe', 'hives', 'drill', 'pace', 'drill'].map(id => c.buyCellar(id));
out.loam = c.loam; out.cellar = { ...c.cellar };
const sp = CC.PLANTS.find(p => p.id === 'sprout');
out.life = c.plotLife(sp);
out.visible = CC.CELLAR.map(cd => [cd.id, c.cellarVisible(cd)]);
c.sprouts = 1e9; c.sproutsSpent = 1e6;
for (const id of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']) c.buyShed(id);
c.cellar.hives = 2;
c.tick(86400 / (CC.HONEY.beePerDay + 12) + 0.5);
out.beeHoney = c.honey;
out.snap = c.serialize();
console.log(JSON.stringify(out));
"""
js25 = json.loads(subprocess.run(
    ["node", "-e", JS_R25, str(ROOT)], capture_output=True, text=True, check=True).stdout)
p25 = Economy(load_data())
p25.honey = 300
buys = [p25.buy_charm(i) for i in ["clover4", "clover4", "sugar", "candle", "candle", "candle", "candle", "gnome", "bogus"]]
check(buys == js25["buys"] and p25.honey == js25["honey"] and p25.charms == js25["charms"] and p25.charms_bought == js25["bought"],
      f"charm purchases agree (honey {p25.honey}, ledger {p25.charms_bought})")
check([[b.get("charm"), b["mult"], b["left"], bool(b.get("keep"))] for b in p25.buffs] == js25["buffs"],
      "the hanging charms agree")
check([p25.use_candle() for _ in range(4)] == js25["candleUse"], "candles burn identically")
p25.loam = 5000
tree = [p25.buy_cellar(i) for i in ["coldframe", "quick", "beds", "coldframe", "hives", "drill", "pace", "drill"]]
check(tree == js25["tree"] and p25.loam == js25["loam"] and p25.cellar == js25["cellar"],
      f"the tree refuses and admits identically ({p25.cellar})")
sp25 = next(p for p in p25.d["plants"] if p["id"] == "sprout")
check(p25.plot_life(sp25) == js25["life"], "Cold Frames extend a life identically")
check([[cd["id"], p25.cellar_visible(cd)] for cd in p25.d["cellar"]] == js25["visible"], "the lit branches match")
p25.sprouts = 1e9; p25.sprouts_spent = 1e6
for sid in ["p0", "p1", "p2", "p3", "p4", "p5"]:
    p25.buy_shed(sid)
p25.cellar["hives"] = 2
p25.tick(86400 / (p25.d["honey"]["beePerDay"] + 12) + 0.5)
check(p25.honey == js25["beeHoney"], "Warm Hives hum at the same pitch")
p25b = Economy(load_data()); p25b.deserialize(js25["snap"])
check(p25b.charms == p25.charms and p25b.charms_bought == p25.charms_bought and p25b.cellar == p25.cellar,
      "a JS save's charms and tree load into Python")

# ---------- 2. live protocol over a real websocket ----------
print("\n=== protocol (in-process server) ===")
import os  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from carrot_patch import main as patch_main  # noqa: E402

# don't load any existing world state (or tender registry) for the test
state_path = Path("/tmp/carrot_patch_test_state.json")
os.environ["CARROT_PATCH_STATE"] = str(state_path)
state_path.unlink(missing_ok=True)
for suffix in ("_tenders.db", "_parish.json", "_events.jsonl", "_quilt.json"):
    Path("/tmp/carrot_patch_test_state" + suffix).unlink(missing_ok=True)
Path("/tmp/orders_override.json").unlink(missing_ok=True)

app = patch_main.create_app()
patch = app.state.patch

with TestClient(app) as client:
    r = client.get("/api/state")
    check(r.status_code == 200 and r.json()["state"]["bank"] == 0, "GET /api/state starts at zero")

    with client.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        check(snap["type"] == "snapshot", "greeted with a snapshot")
        check(snap["online"] == 1, "presence counts one gardener")
        check(snap["state"].get("season") == "homestead" and snap["state"].get("seasonEnds", 0) > 0,
              "snapshot carries the season and its clock")
        check("visitor" in snap, "the greeting speaks visitor (review: reconnect mid-visit)")

        # click batching: an absurd batch is clamped to the anti-flood
        # ceiling (1000 — anti-flood only, never game balance; DESIGN R2)
        ws.send_json({"type": "clicks", "n": 999999})
        time.sleep(0.05)
        check(abs(patch.eco.bank - 1000) < 1e-9, f"999999 clicks clamped to 1000 (bank {patch.eco.bank})")

        # rate limit: a second batch inside 0.75s is dropped
        ws.send_json({"type": "clicks", "n": 40})
        time.sleep(0.05)
        check(abs(patch.eco.bank - 1000) < 1e-9, "second batch within window is ignored")

        # buy with the global bank
        ws.send_json({"type": "buy", "b": 0, "n": 1})
        time.sleep(0.05)
        check(patch.eco.owned[0] == 1, "bought a Window Box with global carrots")
        check(patch.eco.bank < 1000, "the world's bank paid for it")

        # invalid / unaffordable requests are safely ignored
        ws.send_json({"type": "buy", "b": 9, "n": 10})
        ws.send_json({"type": "upgrade", "id": "g3"})
        ws.send_json({"type": "prestige"})
        ws.send_json({"type": "nonsense"})
        ws.send_json({"type": "catch"})
        time.sleep(0.05)
        check(patch.eco.owned[9] == 0 and not patch.eco.bought and patch.eco.seeds == 0,
              "invalid intents change nothing")

        # malformed wire payloads must never kill the socket (audit f2):
        # json.loads accepts bare NaN/Infinity, and int() of those raises
        time.sleep(1.1)  # age out the flood window and the click interval
        for bad in ('{"type":"clicks","n":NaN}', '{"type":"clicks","n":Infinity}',
                    '{"type":"clicks","n":null}', '{"type":"clicks","n":[1,2]}',
                    '{"type":"clicks","n":"junk"}'):
            ws.send_text(bad)
        ws.send_json({"type": "buy", "b": True, "n": 1})  # bool is not a building index
        time.sleep(0.9)  # the NaN batch consumed the click window; wait it out
        bank_before = patch.eco.bank
        ws.send_json({"type": "clicks", "n": 3})
        time.sleep(0.05)
        delta = patch.eco.bank - bank_before
        check(3 <= delta < 4, f"socket survives malformed payloads and still counts clicks (Δ {delta})")
        check(patch.eco.owned[1] == 0, "buy with b=true is ignored (bool is not an index)")

        # R20: ×5 and Max over the wire (Max resolves server-side)
        patch.eco.earn(100000)
        ws.send_json({"type": "buy", "b": 1, "n": 5})
        time.sleep(0.05)
        check(patch.eco.owned[1] == 5, "×5 buys exactly five Garden Plots")
        before_n = patch.eco.owned[1]
        ws.send_json({"type": "buy", "b": 1, "n": "max"})
        time.sleep(0.05)
        got_n = patch.eco.owned[1] - before_n
        check(got_n >= 5 and patch.eco.bank < patch.eco.cost_of(1, 1),
              f"Max buys to the hilt ({got_n} more; can't afford another)")
        ws.send_json({"type": "buy", "b": 1, "n": "lots"})
        time.sleep(0.05)
        check(patch.eco.owned[1] == before_n + got_n + (1 if patch.eco.bank >= patch.eco.cost_of(1, 1) else 0),
              "junk n falls back to a single, honest purchase")

        # the second defense layer, pinned separately (review T3): even a
        # handler that RAISES must not kill the socket
        def boom(m, c2):
            raise RuntimeError("boom (test)")
        real_handle, patch.handle = patch.handle, boom
        ws.send_json({"type": "clicks", "n": 999})
        time.sleep(0.05)
        patch.handle = real_handle
        time.sleep(0.9)
        bank_before = patch.eco.bank
        ws.send_json({"type": "clicks", "n": 2})
        time.sleep(0.05)
        delta = patch.eco.bank - bank_before
        check(2 <= delta < 3, f"socket survives a raising handle() (Δ {delta})")

        # the Potting Shed (R13): broke world can't buy; sprouts spend globally
        ws.send_json({"type": "shed", "id": "p0"})
        time.sleep(0.05)
        check(not patch.eco.shed, "shed purchase without sprouts is ignored")
        patch.eco.sprouts = 7
        ws.send_json({"type": "shed", "id": "p0"})
        time.sleep(0.05)
        check(patch.eco.shed.get("p0") and patch.eco.sprouts == 2,
              f"shed purchase spends the world's sprouts (left {patch.eco.sprouts})")
        ws.send_json({"type": "shed", "id": "p0"})
        time.sleep(0.05)
        check(patch.eco.sprouts == 2, "double-buying a shed item is ignored")

        # R15: repeatable levels climb over the wire at geometric prices
        patch.eco.sprouts += 30000
        ws.send_json({"type": "shed", "id": "l0"})
        time.sleep(0.05)
        check(patch.eco.shed_level("l0") == 1, "compost level 1 over the wire")
        ws.send_json({"type": "shed", "id": "l0"})
        time.sleep(0.05)
        check(patch.eco.shed_level("l0") == 2 and patch.eco.sprouts == 9602,
              f"level 2 costs more (10000 then 10400; left {patch.eco.sprouts})")
        check(patch.eco.sprouts_spent == 5 + 20400, "the world's spent-sprouts counter tallies")

        # two gardeners share one world
        with client.websocket_connect("/ws") as ws2:
            snap2 = ws2.receive_json()
            check(snap2["state"]["owned"][0] == 1, "second gardener sees the first one's Window Box")
            check(snap2["online"] == 2, "presence counts both")

        # golden rabbit: force one and catch it
        time.sleep(1.0)  # clear MAX_MSGS_PER_SEC — the shed intents above used the window
        patch.visitor = {"kind": "rabbit", "until": time.monotonic() + 10}
        before = patch.eco.bank
        ws.send_json({"type": "catch"})
        time.sleep(0.05)
        caught = patch.visitor is None and (patch.eco.bank > before or patch.eco.buff_mult() > 1)
        check(caught, "rabbit catch pays out (frenzy or bundle)")

        # R19: the tin rabbit clanks — no payout, but the Almanac remembers
        time.sleep(0.2)
        patch.visitor = {"kind": "tin", "until": time.monotonic() + 10}
        before = patch.eco.bank
        ws.send_json({"type": "catch"})
        time.sleep(0.05)
        check(patch.visitor is None and patch.eco.tins == 1 and patch.eco.bank == before,
              "tin rabbit pays nothing and counts one clank")

        # R19: weather simply happens — a buff lands on the whole world
        patch.next_weather = 0.0
        time.sleep(1.3)
        check(any(b["name"] == "Gentle Rain" for b in patch.eco.buffs)
              and patch.eco.weathers == 1,
              "gentle rain drifts in as an ordinary buff, on the record")

        # broadcast loop pushes snapshots, and the rabbit catch goes out
        # both as a structured event (F1) and as legacy prose (for pre-F1
        # clients, until R12 drops it)
        seen = {"snapshot": False, "event": False, "toast": False}
        for _ in range(40):
            m = ws.receive_json()
            if m["type"] == "snapshot":
                seen["snapshot"] = True
            elif m["type"] == "event" and m.get("ev", {}).get("type") == "rabbitCaught":
                seen["event"] = True
            elif m["type"] == "toast" and m["text"].startswith("🐇"):
                seen["toast"] = True
            if all(seen.values()):
                break
        check(seen["snapshot"], "server broadcasts periodic snapshots")
        check(seen["event"], "rabbit catch broadcast as structured event")
        check(seen["toast"], "…and as legacy prose for pre-F1 clients")

        # noticeboard (R11): sign, tally, top-10 endpoint
        def name_reply():
            m = ws.receive_json()
            for _ in range(40):
                if m["type"] == "name":
                    return m
                m = ws.receive_json()
            return m

        ws.send_json({"type": "name", "name": "  Carrot   Fan  "})
        r = name_reply()
        check(r.get("ok") and r.get("name") == "Carrot Fan",
              "name accepted and whitespace-normalised")
        ws.send_json({"type": "name", "name": "shithead supreme"})
        check(not name_reply().get("ok"), "blocklisted name rejected")

        time.sleep(0.8)  # clear MIN_MSG_INTERVAL from earlier click batches
        ws.send_json({"type": "clicks", "n": 7})
        ws.send_json({"type": "buy", "b": 0, "n": 1})
        time.sleep(0.05)
        board = client.get("/api/board").json()
        me = next((t for t in board["tenders"] if t["name"] == "Carrot Fan"), None)
        check(me is not None and me["clicks"] >= 7 and me["buildings"] >= 1,
              f"board tallies clicks and buildings under the good name ({me})")

        # prestige announces its actual seed-bonus boost (audit f7)
        patch.eco.earn(4e6)  # lifetime ≈ 4M → 2 seeds pending
        ws.send_json({"type": "prestige"})
        got = None
        for _ in range(120):
            m = ws.receive_json()
            if m["type"] == "event" and m.get("ev", {}).get("type") == "prestige":
                got = m["ev"]
                break
        check(got is not None and got.get("gained") == 2, f"prestige event carries gained ({got})")
        check(got is not None and abs(got.get("boost", 0) - 1.16) < 1e-9,
              f"and the real boost ×1.16, not '+16% of nothing' ({got})")

        # R16: the world's tick loop writes the Almanac and tells everyone
        time.sleep(1.3)  # one server tick after the prestige above
        check(patch.eco.almanac.get("sd0"), "the Almanac records the world's first seed")

        # ladder levels announce milestones only (review: launch-day toast flood)
        conn_stub = {"last_click_msg": 0.0, "msg_times": []}
        patch.eco.sprouts += 1_000_000
        patch._pending.clear()
        for _ in range(3):
            patch.handle({"type": "shed", "id": "l0"}, conn_stub)
        noisy = [m for m in list(patch._pending)
                 if m.get("type") == "event" and m["ev"]["type"] == "shed"]
        check(patch.eco.shed_level("l0") == 5 and not noisy,
              "ladder levels 3-5 climb silently — milestones only on the wire")

        # R17: the calendar turns (age the current season 15 days)
        patch.eco.season_start = time.time() - 15 * 86400
        time.sleep(1.3)
        check(patch.eco.season == "fair",
              f"the calendar turns to the County Fair (got {patch.eco.season})")
        check(time.time() - patch.eco.season_start < 2 * 86400,
              "and the new season's clock starts roughly now")

    # persistence round-trip
    patch.eco.earn(12345)
    patch.save()
    fresh = Economy(load_data())
    fresh.deserialize(json.loads(state_path.read_text()))
    check(fresh.total_all_time >= 12345, "world state survives a save/load")
    check(fresh.shed.get("p0") and fresh.shed_level("l0") == patch.eco.shed_level("l0")
          and fresh.sprouts == patch.eco.sprouts,
          "shed levels and sprouts survive a save/load")
    check(fresh.prestiges == patch.eco.prestiges
          and fresh.sprouts_spent == patch.eco.sprouts_spent,
          "world counters survive a save/load")
    check(fresh.almanac.get("sd0"), "the Almanac survives a save/load")
    check(fresh.season == patch.eco.season and fresh.season_start > 0,
          "the season and its clock survive a save/load")

    # pre-R13 save migration: sprouts backlog = seeds (none were ever spendable)
    legacy = json.loads(state_path.read_text())
    del legacy["sprouts"], legacy["shed"]
    legacy["seeds"] = 42
    old = Economy(load_data())
    old.deserialize(legacy)
    check(old.sprouts == 42 and not old.shed, "pre-R13 save mints retroactive sprouts 1:1 with seeds")

# ---------- 2b. the Parish (R21): orders, the chronicle, the quiet, presence ----------
print("\n=== the Parish (R21) ===")
import tempfile  # noqa: E402
from carrot_patch.parish import Chronicle, OrderBook, Quilt  # noqa: E402

pdir = Path(tempfile.mkdtemp(prefix="carrot_parish_"))
chron = Chronicle(pdir / "w_events.jsonl")
book = OrderBook(load_data(), pdir / "w_parish.json", chron)
eco = Economy(load_data())
eco.earn(1e7); eco.buy(0, 20); eco.buy(1, 5)
t0 = 1787443200.0  # Sun 23 Aug 2026 00:00 UTC
o = book.post(eco, t0)
check(o["id"] == "harvest" and o["deadline"] == 1788004800.0,
      "first order is the Parish Harvest, due at the end of Saturday's Market Hour")
steady = eco.base_cps() * eco.season_mult()
check(o["targets"] == [steady * (o["deadline"] - t0) * k for k in (1, 2, 4)],
      "harvest tiers are 1/2/4 × the steady cps × the actual window (6.5 days here)")
eco.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 30.0}); eco.hands_bonus = 2.5
o_b = OrderBook(load_data(), pdir / "w2_parish.json", chron).post(eco, t0)
check(o_b["targets"] == o["targets"], "a frenzy and a crowd at the bell cannot move the target (review R21)")
eco.buffs.clear(); eco.hands_bonus = 1.0
late = OrderBook(load_data(), pdir / "w3_parish.json", chron).post(eco, t0 + 4 * 86400)  # Thursday
check(late["targets"][0] == steady * (late["deadline"] - (t0 + 4 * 86400)) and late["targets"][0] < o["targets"][0],
      "an order posted on Thursday is pro-rated to its 2.5-day window, never a 7-day bar")
check(book.tier(eco) == 0 and book.maybe_resolve(eco, t0 + 86400) is None, "nothing resolves before the bell")
eco.earn(o["targets"][1] + 1)
check(book.tier(eco) == 2, "earning two weeks' worth reaches tier 2")
snap = book.snapshot(eco, t0 + 10)
check(snap["tier"] == 2 and snap["value"] > snap["targets"][1] and snap["last"] is None, "snapshot reports progress")
honey0, buffs0 = eco.honey, len(eco.buffs)
out = book.maybe_resolve(eco, o["deadline"])
check(out is not None and out["tier"] == 2 and eco.honey == honey0 + 100
      and any(b["name"] == "Bumper Day" and b.get("keep") for b in eco.buffs),
      f"at the bell tier 2 pays 100 honey and a Bumper Day ({out and out['applied']})")
check(book.order is None and book.history[-1]["tier"] == 2, "the order clears and the outcome is kept")
o2 = book.post(eco, o["deadline"])
check(o2["id"] == "gate" and o2["deadline"] == o["deadline"] + 7 * 86400,
      "the rotation moves on; posted at the bell, the next is due a week later")
out2 = book.maybe_resolve(eco, o2["deadline"] + 1)
check(out2["tier"] == 0 and any(b["name"] == "Parish Embargo" for b in eco.buffs)
      and book.weather_gap_mult(o2["deadline"] + 2) == 2.0 and book.weather_gap_mult(o2["deadline"] + 2 * 86400) == 1.0,
      "a missed order: Embargo ×0.5 and the weather thins for a day, then it's over")
# a won tier 3 livens the gate
o3 = book.post(eco, o2["deadline"] + 1)
eco.stalls += int(o3["targets"][2]) + 1
check(o3["id"] == "diplomacy" and book.tier(eco) == 3 and 1 <= o3["targets"][0] < o3["targets"][2],
      f"Parsnip Diplomacy tiers are a share of the stalls expected this week ({[round(x) for x in o3['targets']]})")
out3 = book.maybe_resolve(eco, o3["deadline"])
check(out3["tier"] == 3 and book.visitor_rate(o3["deadline"] + 1) == 2.0
      and book.visitor_rate(o3["deadline"] + 2 * 86400) == 1.0, "tier 3 doubles visitors for a day")
# persistence: the live order and history survive a restart
o4 = book.post(eco, o3["deadline"] + 1)
book2 = OrderBook(load_data(), pdir / "w_parish.json", chron)
check(book2.order == o4 and len(book2.history) == 3, "the order book survives a restart")
# the override file: a human holds the pen
(pdir / "orders_override.json").write_text(json.dumps([
    {"id": "tmbday", "name": "A Birthday Order", "kind": "visitors", "tiers": [1, 2, 3], "line": "For the gardener."}]))
book2.order = None
o5 = book2.post(eco, o4["deadline"])
check(o5["id"] == "tmbday" and o5["authored"] is True and len(o5["targets"]) == 3
      and o5["targets"][0] < o5["targets"][1] < o5["targets"][2],
      "the override file posts first, marked authored, pro-rated like any order")
book2.order = None
o6 = book2.post(eco, o4["deadline"])
check(o6["id"] != "tmbday" and o6["authored"] is False, "each override posts once, then the table resumes")
# the pen is checked: bad shapes are skipped, never posted, never a crash
(pdir / "orders_override.json").write_text(json.dumps([
    {"kind": "harvest", "tiers": "1,2,4"}, {"kind": "visitors", "tiers": [1, 2, 3, 4]},
    {"kind": "bogus", "tiers": [1, 2, 3]}, {"kind": "harvest", "tiers": [1, 2, 1e999]},
    {"kind": "harvest", "tiers": [3, 2, 1]}, {"kind": "stalls", "tiers": [0.2, 0.4, 0.8], "name": "x" * 80}]))
book2.override_used = 0
book2.order = None
o7 = book2.post(eco, o4["deadline"])
check(o7["kind"] == "stalls" and o7["authored"] and len(o7["name"]) == 40 and book2.override_used == 6,
      "five malformed override specs are skipped (logged), the sixth posts with its name trimmed")
(pdir / "orders_override.json").unlink()
# the rotation is its own counter: a restart after 20+ orders keeps its place
book3 = OrderBook(load_data(), pdir / "w_parish.json", chron)
book3.history = [{"tier": 1}] * 20; book3.rotation = 23; book3.save()
book4 = OrderBook(load_data(), pdir / "w_parish.json", chron)
check(book4.rotation == 23 and len(book4.history) == 20, "the rotation pointer survives the 20-entry history cap")
# no Market Hour in the data: a plain week, never a 1970 deadline
d_nomh = load_data(); d_nomh["marketHour"] = None
b_nomh = OrderBook(d_nomh, pdir / "w5_parish.json", chron)
o8 = b_nomh.post(eco, t0)
check(abs(o8["deadline"] - (t0 + 7 * 86400)) < 1 and b_nomh.maybe_resolve(eco, t0 + 60) is None,
      "without a Market Hour an order is due in a week — not overdue at once")
# unwinnable kinds are skipped: a full Almanac has no pages to write
full = Economy(load_data())
for pg in full.d["almanac"]:
    full.almanac[pg["id"]] = True
b_skip = OrderBook(load_data(), pdir / "w6_parish.json", chron)
b_skip.rotation = 3  # 'ink' is next
o9 = b_skip.post(full, t0)
check(o9["id"] != "ink" and any(e["type"] == "order_skipped" and e.get("id") == "ink" for e in chron.read(0)),
      "Ink for the Almanac is skipped on a full book and the chronicle says so")
q_full = Quilt(load_data(), pdir / "q.json")
for i in range(len(q_full.cells)):
    q_full.cells[i] = 1
b_q = OrderBook(load_data(), pdir / "w7_parish.json", chron, q_full)
b_q.rotation = 6  # 'quilt' is next
check(b_q.post(eco, t0)["id"] != "quilt", "a finished quilt is not ordered again")
# the quiet state
q = load_data()["quiet"]
book2.touch(eco, 1e9)
n0 = len(eco.buffs)
check(book2.touch(eco, 1e9 + 60) is None and len(eco.buffs) == n0, "a minute's gap is not quiet")
woke_q = book2.touch(eco, 1e9 + 60 + q["afterHours"] * 3600 + 1)
hrs = woke_q and woke_q["hours"]
check(hrs is not None and hrs > q["afterHours"] and eco.buffs[-1]["name"] == "Welcome Back"
      and eco.buffs[-1]["mult"] == q["boost"] and eco.buffs[-1]["left"] == q["boostHours"] * 3600,
      f"{q['afterHours']}h of quiet: whoever returns wakes a Welcome Back ×{q['boost']} for everyone")
# the chronicle
days = chron.days(7)
check(days and days[0]["counts"].get("order_posted", 0) >= 5 and any(e["type"] == "quiet" for e in days[0]["notable"]),
      "the chronicle buckets the day: counts plus notable events")
check(all(e["type"] in ("order_posted", "order_resolved", "order_skipped", "quiet") for d in days for e in d["notable"]),
      "only notable types reach the day's notes")
chron2 = Chronicle(pdir / "w_events.jsonl")
check(len(chron2.recent) == len(chron.recent) and chron2.days(7)[0]["counts"] == days[0]["counts"],
      "a restart reads the day-book back from the file tail into memory")
# R24 review: three cards at one bell are one Embargo, not ×0.125
emb = Economy(load_data())
b_e = OrderBook(load_data(), pdir / "w12_parish.json", chron)
b_e.apply(emb, load_data()["orderFail"], t0); b_e.apply(emb, load_data()["orderFail"], t0); b_e.apply(emb, load_data()["orderFail"], t0)
check(sum(1 for b in emb.buffs if b["name"] == "Parish Embargo") == 1 and abs(emb.buff_mult() - 0.5) < 1e-9,
      "a buff by the same name refreshes, never stacks")

# R22 review: the quilt order is a share of the bare cloth at posting, and never a sure fail
q_half = Quilt(load_data(), pdir / "qh.json")
for i in range(len(q_half.cells) // 2):
    q_half.cells[i] = 2
b_qh = OrderBook(load_data(), pdir / "w10_parish.json", chron, q_half)
b_qh.rotation = 6
o_q = b_qh.post(eco, t0)
check(o_q["id"] == "quilt" and abs(o_q["targets"][0] - (0.5 + 0.25 * 0.5)) < 1e-9 and o_q["targets"][2] < 1.0,
      f"a half-stitched quilt is ordered to 62.5 / 75 / 87.5 % ({[round(x, 3) for x in o_q['targets']]})")
check(b_qh.tier(eco) == 0, "…and tier 0 at posting, not a free win")
# a Trial rule must not set the harvest bar
ho = Economy(load_data()); ho.earn(1e7); ho.buy(0, 20); ho.buy(1, 5)
steady_ho = ho.base_cps() * ho.season_mult()
ho.trial = {"id": "hands", "goal": 1e9, "t": 0.0}
o_ho = OrderBook(load_data(), pdir / "w11_parish.json", chron).post(ho, t0)
check(abs(o_ho["targets"][0] - steady_ho * (o_ho["deadline"] - t0)) < 1e-6 * o_ho["targets"][0], "a harvest posted during Hands Only asks for the plain steady cps")
# a Trial's elapsed time never overwrites the chronicle's clock
chron.log({"type": "trial", "id": "frost", "won": True, "n": 1, "t": 4321.0})
last_ev = chron.recent[-1]
check(last_ev["t"] > 1e9 and last_ev["dur"] == 4321.0, "a trial record keeps the epoch and moves its elapsed time to dur")

# the Honey Stall (R25): a candle warms the next quiet; the Press pays on tier 3
cnd = Economy(load_data()); cnd.honey = 100
book_q = OrderBook(load_data(), pdir / "w13_parish.json", chron)
book_q.touch(cnd, 2e9)
check(cnd.buy_charm("candle") and book_q.touch(cnd, 2e9 + 7 * 3600) is not None
      and cnd.buffs[-1]["name"] == "Welcome Back" and cnd.buffs[-1]["mult"] == 4 and cnd.buffs[-1]["left"] == 7200.0
      and cnd.charm_count("candle") == 0,
      "a stored candle burns on the next quiet: ×4 for two hours, then it is gone")
check(book_q.touch(cnd, 2e9 + 14 * 3600) is not None and cnd.buffs[-1]["mult"] == 2,
      "with no candle the welcome is the plain ×2")
prs = Economy(load_data()); prs.earn(1e7); prs.buy(0, 20); prs.cellar["press"] = 2
b_p = OrderBook(load_data(), pdir / "w14_parish.json", chron)
o_p = b_p.post(prs, t0)
prs.earn(o_p["targets"][2] + 1)
h0 = prs.honey
out_p = b_p.maybe_resolve(prs, o_p["deadline"])
check(out_p["tier"] == 3 and prs.honey - h0 == 200 + 100 and any("the Press" in a for a in out_p["applied"]),
      f"the Almanac Press adds 100 honey to a tier-3 order (applied: {out_p['applied'][-1]})")

# Wider Orders (R24): a second slot means a second card, never the same kind twice
wide = Economy(load_data()); wide.earn(1e7); wide.buy(0, 20); wide.cellar["orders"] = 2
b_w = OrderBook(load_data(), pdir / "w8_parish.json", chron)
check(b_w.slots(wide) == 3, "Wider Orders 2: three slots")
o_a = b_w.post(wide, t0); o_b = b_w.post(wide, t0); o_c = b_w.post(wide, t0)
check(len(b_w.live) == 3 and len({o_a["id"], o_b["id"], o_c["id"]}) == 3 and b_w.order is o_a, "three different orders stand; the first is the legacy one")
check(len(b_w.snapshot_all(wide)) == 3 and b_w.snapshot(wide, t0)["id"] == o_a["id"], "the snapshot lists every card")
wide.earn(o_a["targets"][2] + 1)
out_w = b_w.maybe_resolve(wide, o_a["deadline"])
check(out_w and out_w["id"] == o_a["id"] and out_w["tier"] == 3 and len(b_w.live) == 2 and b_w.order is o_b,
      "at the bell each due order resolves on its own; the others stay")
b_w2 = OrderBook(load_data(), pdir / "w8_parish.json", chron)
check(len(b_w2.live) == 2, "all live orders survive a restart")

# Lie Fallow's bell (R24): four rings two hours apart; the first is a rehearsal
fb = Economy(load_data()); fb.seeds = 1.96e22; fb._lifetime_base = 4.5e50
book_b = OrderBook(load_data(), pdir / "w9_parish.json", chron, Quilt(load_data(), pdir / "q9.json"))
F = load_data()["fallow"]
small = Economy(load_data()); small.seeds = 1e10
check(book_b.ring(small, t0, "tbone") is None, "no loam, no bell")
b = book_b.ring(fb, t0, "tbone")
check(b and b["rehearsal"] is True and b["rung"] == 1 and book_b.ring(fb, t0 + 1) is None, "the first bell is a rehearsal, and only one bell rings at a time")
check(book_b.bell_tick(fb, t0 + F["ringGap"] - 1) == [], "quiet until the second ring")
ev2 = book_b.bell_tick(fb, t0 + F["ringGap"])
check(ev2 and ev2[0]["type"] == "bell" and ev2[0]["ring"] == 2 and ev2[0]["rehearsal"], "the second ring, two hours on")
v1 = book_b.silence("pdgeorge", "10.0.0.2", online_addrs=3, now=t0 + 10)
check(v1 and not v1["silenced"] and v1["votes"] == 1 and v1["needed"] == 2 and book_b.bell, "one voice of three online is not enough to silence")
check(book_b.silence("pdgeorge", "10.0.0.2", online_addrs=3, now=t0 + 11) is None, "the same address cannot vote twice")
v2 = book_b.silence("griefer2", "10.0.0.9", online_addrs=3, now=t0 + 12)
check(v2 and v2["silenced"] and book_b.bell is None and book_b.silence() is None, "two of three voices silence it; then there is nothing to silence")
check(book_b.ring(fb, t0 + 13, "tbone") is None and book_b.ring(fb, t0 + 13 + F["ringRest"], "tbone") is not None,
      "after a silence the bell rests before it can ring again")
book_b.bell = None; book_b.bell_rest = 0.0
book_b.ring(fb, t0, "tbone")
evs_b = []
for k in range(1, F["rings"] + 1):
    evs_b.extend(book_b.bell_tick(fb, t0 + k * F["ringGap"]))
check([e["type"] for e in evs_b] == ["bell", "bell", "rehearsed"] and fb.rehearsed and fb.fallows == 0 and fb.seeds == 1.96e22,
      "the rehearsal rings out: nothing resets, the bell is armed")
book_b.quilt.cells[0] = 5
fb.trial = {"id": "drought", "goal": 1e9, "t": 100.0}
book_b.post(fb, t0)
book_b.ring(fb, t0, "tbone")
evs_b = []
for k in range(1, F["rings"] + 1):
    evs_b.extend(book_b.bell_tick(fb, t0 + k * F["ringGap"]))
fal = next((e for e in evs_b if e["type"] == "fallow"), None)
check(fal and fal["loam"] == 496 and fb.fallows == 1 and fb.seeds == 0 and fb.loam == 496 and book_b.bell is None,
      "the real bell: the world lies fallow for 496 loam")
check(any(e["type"] == "trial" and e.get("abandoned") for e in evs_b) and fb.trial is None, "a Trial under the bell is abandoned on the record")
check(book_b.live == [] and any(e["type"] == "order_skipped" and e.get("reason") == "fallow" for e in chron.read(0)),
      "the old world's Orders are wiped without effect")
check(fal["quilt"] == "" and book_b.quilt.cells[0] == 5, "the quilt waits for the caller (the world is saved first)")
book_b.frame_quilt(fal)
check(fal["quilt"][:2] == "05" and book_b.quilt.cells[0] == 0 and book_b.quilt.version > 0, "the quilt is framed into the chronicle and cleared")
check(any(e["type"] == "fallow" for e in chron.read(0)), "the chronicle records the Fallow Year")
book_b.ring(fb, t0)
check(book_b.bell is None, "after the Fallow the loam is gone: the bell is silent again")
book_b.save()  # the caller persists after the fourth ring; do it here
book_c = OrderBook(load_data(), pdir / "w9_parish.json", chron)
fb.seeds = 1e22
check(book_c.hold_springs == fb.prestiges, "after a Fallow the board is held until the cycle's first spring")
check(book_c.held(fb), "…held now")
fb.prestiges += 1
check(not book_c.held(fb) and book_c.hold_springs is None, "…and released by the first Go to Seed")
book_c.ring(fb, t0 + 86400)
book_d = OrderBook(load_data(), pdir / "w9_parish.json", chron)
check(book_d.bell and book_d.bell["rung"] == 1, "a ringing bell survives a restart")

import shutil  # noqa: E402
shutil.rmtree(pdir, ignore_errors=True)

# the presence board (sybil-resistant): streaks over consecutive UTC days
from carrot_patch.tenders import TenderBook  # noqa: E402
tb = TenderBook(Path(tempfile.mkdtemp(prefix="carrot_tb_")) / "t.db", ROOT / "carrot_patch" / "blocklist.txt")
# dates RELATIVE to the wall clock: names_active() reads time.time(), so a
# fixed calendar here started failing the week after it was written
from datetime import date as _date, timedelta as _td  # noqa: E402
day = lambda off: (_date.today() + _td(days=off)).isoformat()  # noqa: E731
tb.bump("Ada", clicks=1, today=day(-4))
tb.bump("Ada", clicks=1, today=day(-3))
tb.bump("Ada", clicks=1, today=day(-2))
tb.bump("Ada", clicks=1, today=day(-2))   # same day twice: no double count
tb.bump("Bob", clicks=1, today=day(-2))
tb.bump("Bob", clicks=1, today=day(0))    # skipped a day: streak resets
pres = tb.presence(today=day(0))
ada = next(r for r in tb.db.execute("SELECT streak, best_streak, first_seen FROM tenders WHERE name='Ada'"))
bob = next(r for r in tb.db.execute("SELECT streak, best_streak FROM tenders WHERE name='Bob'"))
check(ada[0] == 3 and ada[1] == 3 and ada[2] == day(-4), f"three consecutive days make a streak of 3 (Ada {ada})")
check(bob[0] == 1 and bob[1] == 1, f"a missed day resets the streak (Bob {bob})")
check(pres["hands_today"] == ["Bob"] and pres["hands_count"] == 1, "hands today lists who tended today, with an exact count")
check(pres["founders"][0]["name"] == "Ada", "founders are ordered by first appearance")
check(tb.names_active(7) == 2, "two names active this week")
pres_later = tb.presence(today=day(37))
ada_row = next(x for x in pres_later["streaks"] if x["name"] == "Ada")
check(ada_row["streak"] == 0 and ada_row["best"] == 3, "a streak that ended last month is a best, not 'days running'")
for i in range(60):
    tb.bump(f"sybil{i:02d}", clicks=0, today=day(37))
pres_many = tb.presence(today=day(37))
check(len(pres_many["hands_today"]) == 50 and pres_many["hands_count"] == 60, "the hands list is bounded; the count is exact")
# a pre-R21 registry: nobody becomes a founder on restart day
import sqlite3  # noqa: E402
legacy_db = Path(tempfile.mkdtemp(prefix="carrot_legacy_")) / "t.db"
con = sqlite3.connect(legacy_db)
con.execute("CREATE TABLE tenders (name TEXT PRIMARY KEY, clicks INTEGER NOT NULL DEFAULT 0, buildings INTEGER NOT NULL DEFAULT 0)")
con.execute("INSERT INTO tenders VALUES ('tbone', 422000000, 5), ('!zed', 1, 0)")
con.commit(); con.close()
tb2 = TenderBook(legacy_db, ROOT / "carrot_patch" / "blocklist.txt")
tb2.bump("!zed", clicks=1)
tb2.bump("newcomer", clicks=1)
f2 = tb2.presence()["founders"]
check(f2[0]["name"] == "tbone" and f2[1]["name"] == "!zed" and f2[0]["since"] < "2026-08-01",
      "legacy tenders are dated before R21 and ranked by clicks — the restart day makes no founders")

# over the wire: the snapshot carries the order and the market clock; /api/chronicle and presence answer
with TestClient(app) as client:
    with client.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        check(snap.get("order") and snap["order"]["id"] and "market" in snap and snap.get("now", 0) > 0,
              "the greeting carries the Parish Order, the market clock and the server's time")
        check(snap["state"].get("honey", 0) >= 0 and snap["state"].get("handsBonus", 0) >= 1,
              "snapshot state speaks honey and Many Hands")
    r = client.get("/api/chronicle?since=1")
    check(r.status_code == 200 and r.json()["days"] and any(e["type"] == "order_posted" for e in r.json()["events"]),
          "GET /api/chronicle lists the day's book")
    r = client.get("/api/board")
    check("presence" in r.json() and "hands_today" in r.json()["presence"], "GET /api/board carries presence")
    check(patch.eco.hands_bonus >= 1.0, "Many Hands is set by the server")

    # the Quilt (R22) over the wire
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        patch.eco.bank = 1000.0
        cps0 = patch.eco.cps()
        ws.send_json({"type": "paint", "i": 5, "c": 3})
        time.sleep(0.05)
        check(patch.quilt.cells[5] == 3 and patch.quilt.version == 1 and abs(patch.eco.bank - (1000 - cps0)) < 1e-9,
              "a stitch lands and costs a second of harvest")
        ws.send_json({"type": "paint", "i": 6, "c": 3})
        time.sleep(0.05)
        check(patch.quilt.cells[6] == 0, "a second stitch inside the cooldown is ignored")
        with client.websocket_connect("/ws") as ws2:  # a fresh socket from the same address is still the same hand
            ws2.receive_json()
            ws2.send_json({"type": "paint", "i": 7, "c": 3})
            time.sleep(0.05)
            check(patch.quilt.cells[7] == 0, "reconnecting does not reset the needle (cooldown is per address)")
        for junk in ({"i": "5", "c": 3}, {"i": True, "c": 1}, {"i": 1e999, "c": 1}, {"i": -1, "c": 1}, {"i": 7, "c": 99}, {}):
            ws.send_json({"type": "paint", **junk})
        time.sleep(1.1)
        check(patch.quilt.version == 1, "garbage stitches change nothing and kill no socket")
        r = client.get("/api/quilt")
        check(r.json()["v"] == 1 and r.json()["cells"][10:12] == "03", "GET /api/quilt serves the cloth")
        # Trials over the wire: go to seed into Late Frost
        patch.eco.total_run = 1e15; patch.eco._lifetime_base = 2e7  # a goal no tick can reach by accident
        ws.send_json({"type": "prestige", "trial": "frost"})
        time.sleep(0.05)
        check(patch.eco.trial is not None and patch.eco.trial["id"] == "frost", "the world goes to seed into a Trial")
        for junk in ("nope", True, ["frost"], "x" * 1000):
            ws.send_json({"type": "prestige", "trial": junk})
        time.sleep(0.05)
        check(patch.eco.trial["id"] == "frost", "junk trial ids and a seedless prestige change nothing")
        time.sleep(1.1)  # flood guard
        patch.eco.total_run = 5e9; patch.eco._lifetime_base = 1e22; patch._pending.clear()  # more seeds than the last spring earned
        ws.send_json({"type": "prestige"})
        time.sleep(0.05)
        check(patch.eco.trial is None and any(m.get("type") == "event" and m["ev"]["type"] == "trial" and m["ev"].get("abandoned")
                                                for m in patch._pending), "going to seed mid-Trial abandons it, on the wire and on the record")
        check(any(e["type"] == "trial" and e.get("abandoned") for e in patch.chronicle.read(0)), "the chronicle says so")
        patch.eco.total_run = 1e15; patch.eco._lifetime_base = 1e24
        ws.send_json({"type": "prestige", "trial": "frost"})
        time.sleep(0.05)
        check(patch.eco.trial is not None and patch.eco.trial["id"] == "frost", "…and a fresh Trial can begin")
        snap = None
        time.sleep(1.2)  # the socket buffers older snapshots; read until one taken after the prestige
        for _ in range(60):
            m = ws.receive_json()
            if m["type"] == "snapshot" and m["state"].get("trial"):
                snap = m
                break
        check(snap and snap["state"]["trial"]["id"] == "frost" and "perks" in snap["state"] and "quiltV" in snap,
              "the snapshot carries the Trial, the perks and the quilt version")
        patch.eco.trial = None

    # the Seed Bed (R23) over the wire
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        patch.eco.bank = 1e9; patch.eco.honey = 0
        ws.send_json({"type": "plant", "i": 0, "sp": "sprout"})
        time.sleep(0.05)
        check(patch.eco.bed["plots"][0] == {"sp": "sprout", "age": 0} and patch.eco.bank < 1e9, "a seed goes into the bed and is paid for")
        ws.send_json({"type": "plant", "i": 1, "sp": "clover"})
        replies = []
        for _ in range(200):  # the first seed's ok reply is queued behind snapshots/events; read until the refusal
            m = ws.receive_json()
            if m.get("type") == "plant":
                replies.append(m)
                if not m["ok"]:
                    break
        check(patch.eco.bed["plots"][1] is None and replies and replies[0]["ok"] is True and replies[-1]["ok"] is False
              and replies[-1]["why"] == "trowel",
              "a second seed inside the trowel cooldown is refused — and the sender is told (after the first's ok)")
        with client.websocket_connect("/ws") as ws2:  # same address, fresh socket: same trowel
            ws2.receive_json()
            ws2.send_json({"type": "plant", "i": 1, "sp": "clover"})
            time.sleep(0.05)
            check(patch.eco.bed["plots"][1] is None, "reconnecting does not reset the trowel (per address)")
        # the share cap: one address may hold a quarter of the bed immature
        patch._plant_at.clear()
        cap = max(1, -(-len(patch.eco.bed["plots"]) // 4))
        for k in range(1, cap + 2):
            patch._plant_at.clear()
            ws.send_json({"type": "plant", "i": k, "sp": "sprout"})
            time.sleep(0.05)
        held = sum(1 for pl in patch.eco.bed["plots"] if pl)
        check(held == cap, f"one address holds at most {cap} immature plots ({held})")
        for k in range(1, cap + 1):
            patch.eco.bed["plots"][k] = None
        patch._plant_at.clear()
        for junk in ({"i": "0", "sp": "sprout"}, {"i": 2, "sp": 5}, {"i": 1e999, "sp": "sprout"}, {"i": 2, "sp": "nettle"},
                     {"i": 2, "sp": "honeyroot"}, {"i": -1, "sp": "sprout"}, {"i": 2, "sp": "x" * 100}, {}):
            ws.send_json({"type": "plant", **junk})
        time.sleep(1.1)  # the flood guard allows 10 messages a second; let it breathe
        check(sum(1 for pl in patch.eco.bed["plots"] if pl) == 1, "garbage, weeds and undiscovered crosses never plant")
        ws.send_json({"type": "harvest", "i": 0})
        time.sleep(0.05)
        check(patch.eco.bed["plots"][0] is not None, "a seedling cannot be picked")
        patch.eco.bed["plots"][0]["age"] = 5
        patch._harvest_at.clear()
        patch._pending.clear()
        ws.send_json({"type": "harvest", "i": 0})
        time.sleep(0.05)
        check(patch.eco.bed["plots"][0] is None and patch.eco.bed["log"].get("sprout") == 1
              and any(m.get("type") == "event" and m["ev"]["type"] == "bedHarvest" and m["ev"]["first"] for m in patch._pending),
              "a mature plant is picked, logged, and announced as a first")
        for junk in ({"i": True}, {"i": "0"}, {"i": 1e999}, {}):
            ws.send_json({"type": "harvest", **junk})
        time.sleep(1.1)
        ws.send_json({"type": "soil", "id": "clay"})
        time.sleep(0.05)
        check(patch.eco.bed["soil"] == "clay", "the soil turns to clay")
        patch.eco.bed["plots"][5] = {"sp": "sprout", "age": 9}
        ws.send_json({"type": "harvest", "i": 5})
        time.sleep(0.05)
        check(patch.eco.bed["plots"][5] is not None, "the basket rests between harvests (per address)")
        patch.eco.bed["plots"][5] = None
        ws.send_json({"type": "soil", "id": "chips"})
        ws.send_json({"type": "soil", "id": ["x"]})
        time.sleep(0.05)
        check(patch.eco.bed["soil"] == "clay", "…and not again inside the cooldown, and never to garbage")
        ws.send_json({"type": "sacrifice"})
        time.sleep(0.05)
        check(patch.eco.bed["sacrificeLeft"] == 0, "no sacrifice without a full log")
        for pl in patch.eco.d["plants"]:
            patch.eco.bed["log"][pl["id"]] = 1
        ws.send_json({"type": "sacrifice"})
        time.sleep(0.05)
        check(patch.eco.bed["sacrificeLeft"] > 0, "a full log starts the countdown")
        ws.send_json({"type": "cancelSacrifice"})
        time.sleep(0.05)
        check(patch.eco.bed["sacrificeLeft"] == 0 and patch.eco.log_full(), "anyone cancels it; the log stays")
        patch.eco.bed["log"] = {}
        snap = None
        time.sleep(1.2)
        for _ in range(400):
            m = ws.receive_json()
            if m["type"] == "snapshot" and m["state"].get("bed", {}).get("soil") == "clay":
                snap = m
                break
        check(snap and "bed" in snap["state"] and snap["state"]["bed"]["soil"] == "clay" and "bedT" in snap["state"],
              "the snapshot carries the bed")

    # the Honey Stall (R25) over the wire
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        patch.eco.honey = 200
        ws.send_json({"type": "charm", "id": "clover4"})
        time.sleep(0.05)
        check(patch.eco.honey == 190 and patch.eco.charm_busy("clover4"), "a clover is bought over the wire and hangs")
        patch.visitor = None; patch.next_visitor = time.monotonic() + 9999
        ws.send_json({"type": "charm", "id": "sugar"})
        time.sleep(0.05)
        check(patch.eco.honey == 185 and patch.next_visitor - time.monotonic() < 61, "sugar water calls the next guest within the minute")
        w0 = patch.eco.weathers
        ws.send_json({"type": "charm", "id": "rainjar"})
        time.sleep(0.05)
        check(patch.eco.weathers == w0 + 1 and any(b["name"] == "Gentle Rain" for b in patch.eco.buffs),
              "a jar of rain starts a rain right now")
        ws.send_json({"type": "charm", "id": "rainjar"})
        time.sleep(0.05)
        check(patch.eco.weathers == w0 + 1, "…and rests before the next jar")
        patch._pending.clear()
        ws.send_json({"type": "charm", "id": "gnome"})
        time.sleep(0.05)
        check(patch.eco.charm_count("gnome") == 1 and any(m.get("type") == "event" and m["ev"]["type"] == "charm"
                                                           and m["ev"]["cosmetic"] for m in patch._pending),
              "the gnome arrives, announced as a cosmetic")
        check(any(e["type"] == "charm" and e["id"] == "gnome" for e in patch.chronicle.read(0)), "…and enters the chronicle")
        for junk in ({"id": "bogus"}, {"id": 5}, {}, {"id": "gnome"}):
            ws.send_json({"type": "charm", **junk})
        time.sleep(1.1)
        # 185 − 15 (jar) + 1 (its rain mints like any rain) − 60 (gnome) = 111
        check(patch.eco.charm_count("gnome") == 1 and patch.eco.honey == 111, "junk and re-buys change nothing")
        patch.eco.buffs = [b for b in patch.eco.buffs if not b.get("charm")]

    # Lie Fallow (R24) over the wire: the bell, the Cellar
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        step = patch.eco.d["fallow"]["cellarStep"]
        patch.eco.seeds = 1.96e22; patch.eco._lifetime_base = 4.5e50; patch.eco.loam = step + 4
        ws.send_json({"type": "ring"})
        time.sleep(0.05)
        check(patch.orders.bell and patch.orders.bell["rehearsal"] and patch.orders.bell["rung"] == 1, "the bell rings over the wire — a rehearsal first")
        snap_b = patch.snapshot_msg(time.monotonic())
        check(snap_b["bell"] and "silences" not in snap_b["bell"] and snap_b["bell"]["votes"] == 0 and "bellRest" in snap_b,
              "the snapshot carries the bell as a vote COUNT, never the voters' addresses")
        ws.send_json({"type": "silence"})
        time.sleep(0.05)
        check(patch.orders.bell is None, "…and is silenced over the wire")
        ws.send_json({"type": "cellar", "id": "quick"})
        ws.send_json({"type": "cellar", "id": "bogus"})
        ws.send_json({"type": "cellar", "id": ["x"]})
        time.sleep(0.05)
        check(patch.eco.cellar.get("quick") == 1 and patch.eco.loam == 4, "loam buys a Cellar level (step loam); junk ids buy nothing")
        # the bell rings out for real when the clock says so
        patch.eco.rehearsed = True
        patch.orders.bell_rest = 0.0  # skip the rest after the silence
        ws.send_json({"type": "ring"})
        time.sleep(0.05)
        check(patch.orders.bell and not patch.orders.bell["rehearsal"], "the armed bell is real")
        patch.orders.bell["at"] = time.time() - 4 * patch.eco.d["fallow"]["ringGap"]  # every ring is due
        time.sleep(1.3)
        check(patch.orders.bell is None and patch.eco.fallows == 1 and patch.eco.seeds == 0 and patch.eco.loam == 4 + 496,
              f"the world lies fallow on the tick: +496 loam, seeds retired (fallows {patch.eco.fallows})")
        check(any(e["type"] == "fallow" for e in patch.chronicle.read(0)), "the chronicle records it")
        fresh_f = Economy(load_data()); fresh_f.deserialize(json.loads(state_path.read_text()))
        check(fresh_f.fallows == 1 and fresh_f.loam == 500 and fresh_f.cellar.get("quick") == 1, "the Fallow is saved at once")

# ---------- 3. mounted inside a parent site (lifespan never reaches sub-apps) ----------
print("\n=== mounted under a parent FastAPI site ===")
from fastapi import FastAPI  # noqa: E402

mount_state = Path("/tmp/carrot_patch_mount_test.json")
os.environ["CARROT_PATCH_STATE"] = str(mount_state)
mount_state.unlink(missing_ok=True)
for suffix in ("_tenders.db", "_parish.json", "_events.jsonl", "_quilt.json"):
    Path("/tmp/carrot_patch_mount_test" + suffix).unlink(missing_ok=True)

site = FastAPI()
sub = patch_main.create_app()
site.mount("/carrot-patch", sub)

with TestClient(site) as client:
    r = client.get("/carrot-patch/api/state")
    check(r.status_code == 200, "GET /carrot-patch/api/state works under the subpath")
    with client.websocket_connect("/carrot-patch/ws") as ws:
        snap = ws.receive_json()
        check(snap["type"] == "snapshot", "websocket works under the subpath")
        ws.send_json({"type": "clicks", "n": 5})
        time.sleep(0.05)
        check(sub.state.patch.eco.bank == 5, "clicks land on the mounted world")
    task = getattr(sub.state, "loop_task", None)
    check(task is not None and not task.done(), "tick loop is running despite no sub-app lifespan")
mount_state.unlink(missing_ok=True)

print(f"\n{fails} FAILURE(S)" if fails else "\nALL CHECKS PASSED")
sys.exit(1 if fails else 0)
