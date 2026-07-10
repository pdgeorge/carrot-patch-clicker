#!/usr/bin/env python3
"""Carrot Patch verification: JS<->Python economy parity + live protocol test.

Run with a venv that has fastapi installed:
    python server/test_patch.py
"""
from __future__ import annotations

import json
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
c.buffs.push({ name: 'Rabbit Frenzy', mult: 7, left: 30 });
console.log(JSON.stringify({
  cps: c.cps(), click: c.clickPower(), cost0: c.costOf(0, 10),
  gmult: c.globalMult(), bank: c.bank, pending: c.pendingSeeds(),
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
py.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 30.0})

pairs = [("cps", py.cps()), ("click", py.click_power()), ("cost0", py.cost_of(0, 10)),
         ("gmult", py.global_mult()), ("bank", py.bank), ("pending", py.pending_seeds())]
for name, pv in pairs:
    jv = js[name]
    ok = abs(pv - jv) <= 1e-6 * max(1.0, abs(jv))
    check(ok, f"{name}: py {pv:.6g} == js {jv:.6g}")

# ---------- 2. live protocol over a real websocket ----------
print("\n=== protocol (in-process server) ===")
import os  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from carrot_patch import main as patch_main  # noqa: E402

# don't load any existing world state for the test
state_path = Path("/tmp/carrot_patch_test_state.json")
os.environ["CARROT_PATCH_STATE"] = str(state_path)
state_path.unlink(missing_ok=True)

app = patch_main.create_app()
patch = app.state.patch

with TestClient(app) as client:
    r = client.get("/api/state")
    check(r.status_code == 200 and r.json()["state"]["bank"] == 0, "GET /api/state starts at zero")

    with client.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        check(snap["type"] == "snapshot", "greeted with a snapshot")
        check(snap["online"] == 1, "presence counts one gardener")

        # click batching: absurd auto-clicker batch is clamped server-side
        ws.send_json({"type": "clicks", "n": 999999})
        time.sleep(0.05)
        check(abs(patch.eco.bank - 40) < 1e-9, f"999999 clicks clamped to 40 (bank {patch.eco.bank})")

        # rate limit: a second batch inside 0.75s is dropped
        ws.send_json({"type": "clicks", "n": 40})
        time.sleep(0.05)
        check(abs(patch.eco.bank - 40) < 1e-9, "second batch within window is ignored")

        # buy with the global bank
        ws.send_json({"type": "buy", "b": 0, "n": 1})
        time.sleep(0.05)
        check(patch.eco.owned[0] == 1, "bought a Window Box with global carrots")
        check(patch.eco.bank < 40, "the world's bank paid for it")

        # invalid / unaffordable requests are safely ignored
        ws.send_json({"type": "buy", "b": 9, "n": 10})
        ws.send_json({"type": "upgrade", "id": "g3"})
        ws.send_json({"type": "prestige"})
        ws.send_json({"type": "nonsense"})
        ws.send_json({"type": "catch"})
        time.sleep(0.05)
        check(patch.eco.owned[9] == 0 and not patch.eco.bought and patch.eco.seeds == 0,
              "invalid intents change nothing")

        # two gardeners share one world
        with client.websocket_connect("/ws") as ws2:
            snap2 = ws2.receive_json()
            check(snap2["state"]["owned"][0] == 1, "second gardener sees the first one's Window Box")
            check(snap2["online"] == 2, "presence counts both")

        # golden rabbit: force one and catch it
        patch.rabbit = {"id": 1, "until": time.monotonic() + 10}
        before = patch.eco.bank
        ws.send_json({"type": "catch"})
        time.sleep(0.05)
        caught = patch.rabbit is None and (patch.eco.bank > before or patch.eco.buff_mult() > 1)
        check(caught, "rabbit catch pays out (frenzy or bundle)")

        # broadcast loop actually pushes snapshots
        got = ws.receive_json()
        for _ in range(30):
            if got["type"] == "snapshot":
                break
            got = ws.receive_json()
        check(got["type"] == "snapshot", "server broadcasts periodic snapshots")

    # persistence round-trip
    patch.eco.earn(12345)
    patch.save()
    fresh = Economy(load_data())
    fresh.deserialize(json.loads(state_path.read_text()))
    check(fresh.total_all_time >= 12345, "world state survives a save/load")

# ---------- 3. mounted inside a parent site (lifespan never reaches sub-apps) ----------
print("\n=== mounted under a parent FastAPI site ===")
from fastapi import FastAPI  # noqa: E402

mount_state = Path("/tmp/carrot_patch_mount_test.json")
os.environ["CARROT_PATCH_STATE"] = str(mount_state)
mount_state.unlink(missing_ok=True)

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
