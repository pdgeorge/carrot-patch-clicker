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
       "shed": {"l0": 1e18, "hax": 5, "p0": True}, "almanac": {"fake": True, "sd0": True}}
pbad = Economy(load_data())
pbad.deserialize(dict(bad))
check(pbad.shed_level("l0") == 800 and pbad.shed_level("hax") == 0 and pbad.shed_level("p0") == 1,
      "forged shed levels clamp, unknown ids drop, legacy true survives")
bad_season = Economy(load_data())
bad_season.deserialize({"v": 1, "season": ["hax"], "seasonStart": {"no": 1}})
check(bad_season.season == "homestead" and bad_season.season_start == 0.0,
      "an unhashable forged season cannot crash the server (review f1)")
check("fake" not in pbad.almanac and pbad.almanac.get("sd0") is True
      and math.isfinite(pbad.shed_cost("l0")) and math.isfinite(pbad.global_mult()),
      "junk almanac keys drop, real history stays, costs stay finite")

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
console.log(JSON.stringify({ t: t.kind, e: e.kind, g: g.kind, gain: g.gain,
  tins: c.tins, stalls: c.stalls, bank: c.bank, buffs: c.buffs.length }));
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

# ---------- 2. live protocol over a real websocket ----------
print("\n=== protocol (in-process server) ===")
import os  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from carrot_patch import main as patch_main  # noqa: E402

# don't load any existing world state (or tender registry) for the test
state_path = Path("/tmp/carrot_patch_test_state.json")
os.environ["CARROT_PATCH_STATE"] = str(state_path)
state_path.unlink(missing_ok=True)
Path("/tmp/carrot_patch_test_state_tenders.db").unlink(missing_ok=True)

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

# ---------- 3. mounted inside a parent site (lifespan never reaches sub-apps) ----------
print("\n=== mounted under a parent FastAPI site ===")
from fastapi import FastAPI  # noqa: E402

mount_state = Path("/tmp/carrot_patch_mount_test.json")
os.environ["CARROT_PATCH_STATE"] = str(mount_state)
mount_state.unlink(missing_ok=True)
Path("/tmp/carrot_patch_mount_test_tenders.db").unlink(missing_ok=True)

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
