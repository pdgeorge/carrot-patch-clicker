"""Carrot Patch — server-side economy, a faithful port of clicker/src/core.js.

Game data (buildings, upgrades, milestones, ribbons) is loaded from
dist/patch-data.json, which build.js exports from the JS source, so the
client and server can never disagree about the numbers.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
from pathlib import Path


def dist_dir() -> Path:
    """Where the built client + game data live. CARROT_PATCH_DIST overrides;
    otherwise look next to this package (vendored layout: carrot_patch/dist)
    and then beside it (source layout: server/../dist)."""
    env = os.getenv("CARROT_PATCH_DIST")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for cand in (here / "dist", here.parent / "dist"):
        if (cand / "patch-data.json").exists():
            return cand
    return here.parent / "dist"


def load_data() -> dict:
    with open(dist_dir() / "patch-data.json", encoding="utf-8") as f:
        return json.load(f)


class Economy:
    def __init__(self, data: dict):
        self.d = data
        self.bank: float = 0.0
        self._lifetime_base: float = 0.0  # lifetime banked before this run (see total_all_time)
        self.total_run: float = 0.0
        self.clicks: int = 0
        self.owned: list[int] = [0] * len(data["buildings"])
        self.bought: dict[str, bool] = {}
        self.seeds: int = 0            # permanent: +8% each, never spent
        self.sprouts: int = 0          # spendable twin: minted 1:1 with seeds (R13)
        self.shed: dict[str, bool] = {}  # Potting Shed item id -> True; survives prestige
        self.buffs: list[dict] = []  # {name, mult, left}
        self._ribbon_seen = 0
        self._bumper_seen = [0] * len(data["buildings"])
        self._upgrades: list[dict] | None = None

    # Lifetime harvest = base (folded in at prestige) + this run's total, so
    # earning always accumulates at run magnitude: at 3e22 lifetime a double's
    # ulp is ~4M carrots and a naive += silently drops clicks and small ticks
    # (and freezes entirely past 2**75). Reads still round to one ulp of the
    # sum — a display grain, never lost carrots. Mirror of core.js.
    @property
    def total_all_time(self) -> float:
        return self._lifetime_base + self.total_run

    @total_all_time.setter
    def total_all_time(self, v: float) -> None:
        self._lifetime_base = v - self.total_run

    # ---------- upgrades ----------
    def all_upgrades(self) -> list[dict]:
        if self._upgrades is None:
            ups: list[dict] = []
            for i, b in enumerate(self.d["buildings"]):
                for ti, t in enumerate(self.d["tiers"]):
                    ups.append({
                        "id": f"b{i}t{ti}", "type": "building", "b": i,
                        "need": t["need"], "cost": b["cost"] * t["costMult"],
                        "name": f"{t['prefix']} {b['name']}" if t.get("prefix") else b["upName"],
                    })
            for u in self.d["clickUpgrades"]:
                ups.append({**u, "type": "click"})
            for u in self.d["globalUpgrades"]:
                ups.append({**u, "type": "global"})
            for u in self.d["synergyUpgrades"]:
                ups.append({**u, "type": "synergy"})
            self._upgrades = ups
        return self._upgrades

    def cond_met(self, c: dict) -> bool:
        """One unlock condition (DESIGN R8) — mirror of core.js condMet.
        Unknown conditions fail closed: the upgrade stays hidden."""
        if "owned" in c:
            return self.owned[c["owned"]] >= c["n"]
        if "lifetime" in c:
            return self.total_all_time >= c["lifetime"]
        if "seeds" in c:
            return self.seeds >= c["seeds"]
        if "clicks" in c:
            return self.clicks >= c["clicks"]
        if "bought" in c:
            return bool(self.bought.get(c["bought"]))
        if "shed" in c:
            return bool(self.shed.get(c["shed"]))
        return False

    def upgrade_visible(self, u: dict) -> bool:
        if self.bought.get(u["id"]):
            return False
        if u.get("unlock"):
            return all(self.cond_met(c) for c in u["unlock"])
        if u["type"] == "building":
            return self.owned[u["b"]] >= u["need"]
        if u["type"] == "synergy":
            return (self.owned[u["target"]] >= u["needTarget"]
                    and self.owned[u["per"]] >= u["needPer"])
        return self.total_all_time >= u["cost"] / 4

    def buy_upgrade(self, uid: str) -> bool:
        u = next((u for u in self.all_upgrades() if u["id"] == uid), None)
        if not u or self.bought.get(uid) or self.bank < u["cost"] or not self.upgrade_visible(u):
            return False
        self.bank -= u["cost"]
        self.bought[uid] = True
        return True

    # ---------- production ----------
    def building_mult(self, i: int) -> float:
        m = 1.0
        for ti in range(len(self.d["tiers"])):
            if self.bought.get(f"b{i}t{ti}"):
                m *= 2
        for u in self.d["synergyUpgrades"]:
            if u["target"] == i and self.bought.get(u["id"]):
                m *= 1 + u["pct"] * self.owned[u["per"]]
        return m

    def bumper_count(self, i: int) -> int:
        return sum(1 for at in self.d["milestones"] if self.owned[i] >= at)

    def bumper_total(self) -> int:
        return sum(self.bumper_count(i) for i in range(len(self.owned)))

    def ribbons(self) -> list[dict]:
        return [r for r in self.d["ribbons"] if self.total_all_time >= r["at"]]

    def seed_mult(self) -> float:
        return 1 + 0.08 * self.seeds

    def ribbon_mult(self) -> float:
        m = 1.0
        for r in self.ribbons():
            m *= r["mult"]
        return m

    def global_mult(self) -> float:
        m = self.seed_mult() * self.ribbon_mult()
        for u in self.d["globalUpgrades"]:
            if self.bought.get(u["id"]):
                m *= u["mult"]
        for u in self.d["shed"]:
            if self.shed.get(u["id"]):
                m *= u["mult"]
        m *= self.d["milestoneMult"] ** self.bumper_total()
        return m

    def buff_mult(self) -> float:
        m = 1.0
        for b in self.buffs:
            m *= b["mult"]
        return m

    def base_cps(self) -> float:
        c = sum(self.owned[i] * b["cps"] * self.building_mult(i)
                for i, b in enumerate(self.d["buildings"]))
        return c * self.global_mult()

    def cps(self) -> float:
        return self.base_cps() * self.buff_mult()

    def click_power(self) -> float:
        base, pct = 1.0, 0.0
        for u in self.d["clickUpgrades"]:
            if not self.bought.get(u["id"]):
                continue
            if u.get("mult"):
                base *= u["mult"]
            if u.get("cpsPct"):
                pct += u["cpsPct"]
        return (base + pct * self.base_cps()) * self.buff_mult()

    # ---------- actions ----------
    def earn(self, n: float) -> None:
        self.bank += n
        self.total_run += n  # lifetime = base + run

    def do_clicks(self, n: int) -> float:
        gain = self.click_power() * n
        self.earn(gain)
        self.clicks += n
        return gain

    def cost_of(self, i: int, count: int = 1) -> float:
        r = 1.15
        c0 = self.d["buildings"][i]["cost"] * (r ** self.owned[i])
        return c0 * (r ** count - 1) / (r - 1)

    def buy(self, i: int, count: int = 1) -> int:
        """Buy exactly `count` or nothing, at the summed geometric price —
        matching core.js buy() and the ×N price the shop row displays.
        Returns the number bought (count or 0)."""
        cost = self.cost_of(i, count)
        if self.bank < cost:
            return 0
        self.bank -= cost
        self.owned[i] += count
        return count

    # ---------- the Potting Shed (R13) ----------
    def buy_shed(self, uid: str) -> bool:
        u = next((u for u in self.d["shed"] if u["id"] == uid), None)
        if not u or self.shed.get(uid) or self.sprouts < u["cost"]:
            return False
        self.sprouts -= u["cost"]
        self.shed[uid] = True
        return True

    def rabbit_reward(self, rng=random.random) -> dict:
        if rng() < 0.55:
            self.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 30.0})
            return {"kind": "frenzy", "text": "RABBIT FRENZY! Production ×7 for 30 seconds!"}
        gain = max(self.click_power() * 20,
                   min(self.bank * 0.15, self.cps() * 600) + self.cps() * 60)
        self.earn(gain)
        return {"kind": "lucky", "gain": gain, "text": f"Lucky bundle! +{fmt(gain)} carrots!"}

    # ---------- prestige ----------
    def seeds_earned_total(self) -> int:
        return int(math.sqrt(self.total_all_time / 1e6))

    def pending_seeds(self) -> int:
        return max(0, self.seeds_earned_total() - self.seeds)

    def next_seed_at(self) -> float:
        return (self.seeds_earned_total() + 1) ** 2 * 1e6

    def prestige(self) -> int:
        gain = self.pending_seeds()
        if gain < 1:
            return 0
        self.seeds += gain
        self.sprouts += gain  # every seed also sprouts (R13); shed keeps its purchases
        self.bank = 0.0
        self._lifetime_base += self.total_run  # fold the run before resetting it
        self.total_run = 0.0
        self.owned = [0] * len(self.owned)
        self.bought = {}
        self.buffs = []
        self._bumper_seen = [0] * len(self.owned)
        return gain

    # ---------- tick ----------
    def tick(self, dt: float) -> list[dict]:
        events: list[dict] = []
        self.earn(self.cps() * dt)
        for b in self.buffs:
            b["left"] -= dt
        self.buffs = [b for b in self.buffs if b["left"] > 0]

        # structured events, same shapes as core.js tick() — presentation
        # happens client-side (F1); main.py composes legacy prose for
        # pre-F1 clients during the transition
        rc = len(self.ribbons())
        if rc > self._ribbon_seen:
            for k in range(self._ribbon_seen, rc):
                events.append({"type": "ribbon", "i": k})
            self._ribbon_seen = rc
        for i in range(len(self.owned)):
            n = self.bumper_count(i)
            if n > self._bumper_seen[i]:
                events.append({"type": "bumper", "b": i, "owned": self.owned[i],
                               "at": self.d["milestones"][n - 1]})
                self._bumper_seen[i] = n
        return events

    # ---------- persistence ----------
    def serialize(self) -> dict:
        return {
            "v": 1, "bank": self.bank, "totalAllTime": self.total_all_time,
            "totalRun": self.total_run, "clicks": self.clicks, "owned": self.owned,
            "bought": self.bought, "seeds": self.seeds, "buffs": self.buffs,
            "sprouts": self.sprouts, "shed": self.shed,
            "saved": time.time(),
        }

    def deserialize(self, s: dict) -> None:
        if not s or s.get("v") != 1:
            return
        self.bank = s.get("bank", 0.0)
        self.total_run = s.get("totalRun", 0.0)
        self.total_all_time = s.get("totalAllTime", 0.0)  # setter derives base — run first
        self.clicks = s.get("clicks", 0)
        self.owned = [(s.get("owned") or [0] * len(self.owned))[i] if i < len(s.get("owned", [])) else 0
                      for i in range(len(self.owned))]
        self.bought = s.get("bought", {})
        self.seeds = s.get("seeds", 0)
        # pre-R13 saves earned their seeds when none were spendable: mint the
        # backlog — sprouts = seeds — as the fair one-time migration
        self.sprouts = s["sprouts"] if "sprouts" in s else s.get("seeds", 0)
        self.shed = s.get("shed", {})
        self.buffs = s.get("buffs", [])
        self._ribbon_seen = len(self.ribbons())
        self._bumper_seen = [self.bumper_count(i) for i in range(len(self.owned))]
        # the garden keeps growing while the server is down (full rate, capped 24h)
        away = min(max(0.0, time.time() - s.get("saved", time.time())), 24 * 3600)
        for b in self.buffs:  # buffs kept ticking while we were down
            b["left"] -= away
        self.buffs = [b for b in self.buffs if b["left"] > 0]
        if away > 1:
            self.earn(self.base_cps() * away)

    def snapshot(self) -> dict:
        """Wire-format state pushed to every client."""
        return {
            "bank": self.bank, "totalAllTime": self.total_all_time,
            "totalRun": self.total_run, "clicks": self.clicks,
            "owned": self.owned, "bought": self.bought, "seeds": self.seeds,
            "sprouts": self.sprouts, "shed": self.shed,
            "buffs": [{"name": b["name"], "mult": b["mult"], "left": b["left"]} for b in self.buffs],
        }


def fmt(n: float) -> str:
    if n < 1000:
        # mirror CC.fmt: one decimal for small non-integers, ties rounding up
        # like toFixed (5.25 -> "5.3"), not python's round-half-even ("5.2")
        if n < 10 and n % 1:
            return f"{math.floor(n * 10 + 0.5) / 10:.1f}"
        return str(int(n))
    units = ["k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"]
    u = -1
    while n >= 1000 and u < len(units) - 1:
        n /= 1000
        u += 1
    return f"{n:.0f}{units[u]}" if n >= 100 else f"{n:.1f}{units[u]}" if n >= 10 else f"{n:.2f}{units[u]}"
