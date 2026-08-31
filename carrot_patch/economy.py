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
from decimal import Decimal, ROUND_HALF_UP
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


def _cnt(v) -> int:
    """A world counter from a save: non-negative int, or 0 for any garbage
    ("abc", 1e999, None, lists) — a corrupt-but-parsable save must never
    keep the server from booting (review; mirror of core.js Math.floor||0)."""
    try:
        n = int(v)
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, n)


def market_hour_at(epoch: float, d: dict) -> dict:
    """Market Hour window for a UTC epoch — mirror of CC.marketHourAt. The
    engine never reads a clock; the server calls this and sets market_hour."""
    m = d.get("marketHour")
    if not m:
        return {"active": False, "next": 0, "end": 0}
    t = time.gmtime(epoch)
    dow = (t.tm_wday + 1) % 7  # python Monday=0 → JS Sunday=0
    h = t.tm_hour + t.tm_min / 60 + t.tm_sec / 3600
    week_start = epoch - (dow * 24 + h) * 3600
    start = week_start + (m["dow"] * 24 + m["startUtc"]) * 3600
    end = start + m["hours"] * 3600
    if epoch >= end:
        start += 7 * 86400
        end += 7 * 86400
    return {"active": start <= epoch < end, "next": start, "end": end}


def load_data() -> dict:
    with open(dist_dir() / "patch-data.json", encoding="utf-8") as f:
        return json.load(f)


def fresh_bed(d: dict, w: int | None = None, h: int | None = None) -> dict:
    b = d.get("bed") or {"w": 4, "h": 4}
    return {"soil": "dirt", "plots": [None] * ((w or b["w"]) * (h or b["h"])), "log": {}, "seed": 1, "n": 0,
            "soilAt": 0.0, "sacrificeLeft": 0.0, "sacrificeRest": 0.0}


def fresh_perks() -> dict:
    return {"scarecrow": 0, "startTier": 0, "resproutCap": 0, "cap": {}, "longEars": 0, "clickFrenzy": 0}


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
        self.shed: dict = {}           # Potting Shed item id -> level (R15); survives prestige
        self.prestiges: int = 0        # world counters (R15): deeds since records began
        self.rabbits: int = 0
        self.sprouts_spent: int = 0
        self.tins: int = 0             # R19 visitor counters: clanks, gambles, rains
        self.stalls: int = 0
        self.weathers: int = 0
        self.almanac: dict = {}        # Almanac page id -> True; latches forever (R16)
        self.season: str = "homestead"  # R17: the server owns the calendar
        self.season_start: float = 0.0  # epoch of the current season's dawn
        self.honey: int = 0             # R21: the calendar currency — deeds, never cps
        self.bee_t: float = 0.0         # seconds toward the Bee Cooperative's next drop
        self.hands_bonus: float = 1.0   # R21 Many Hands: presence-boxed, set by the server
        self.market_hour: bool = False  # R21: the weekly window, set by the server
        # Trials (R22): one rule for one spring; what they paid survives everything
        self.trial: dict | None = None   # {id, goal, t} while a Trial spring runs
        self.trials_done: dict[str, int] = {}
        self.trial_best: dict[str, float] = {}
        self.run_best: float = 0.0       # the best plain spring on record — the Trial goal's memory
        self.run_t: float = 0.0          # seconds since this spring began
        self.perks: dict = fresh_perks()
        self.halt_t: float = 0.0         # Late Frost: seconds of stillness left
        self.sc_t: float = 0.0           # Scarecrow clock
        # the Seed Bed (R23): the world's shared bed; the log outlives everything
        self.bed: dict = fresh_bed(data)
        self.bed_t: float = 0.0
        self.sacrifices: int = 0
        # Lie Fallow (R24): the second prestige; Loam buys rules, never numbers
        self.loam: int = 0
        self.cellar: dict[str, int] = {}
        self.charms: dict[str, int] = {}   # Honey Stall id -> count; cosmetics survive everything (R25)
        self.charms_bought: int = 0
        self.fallows: int = 0
        self.rehearsed: bool = False
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
            return self.shed_level(c["shed"]) >= 1
        # world counters (R15) — records begin the day counters ship
        if "prestiges" in c:
            return self.prestiges >= c["prestiges"]
        if "rabbits" in c:
            return self.rabbits >= c["rabbits"]
        if "sproutsSpent" in c:
            return self.sprouts_spent >= c["sproutsSpent"]
        if "shedLv" in c:
            return self.shed_level(c["shedLv"]) >= c.get("n", 1)
        if "upgradesOwned" in c:
            return len(self.bought) >= c["upgradesOwned"]
        if "tins" in c:
            return self.tins >= c["tins"]
        if "stalls" in c:
            return self.stalls >= c["stalls"]
        if "weathers" in c:
            return self.weathers >= c["weathers"]
        if "heirloomEvery" in c:
            return all(self.shed_level(u["id"]) >= c["heirloomEvery"]
                       for u in self.d["shed"] if u.get("resprout"))
        # Trials (R22)
        if "trial" in c:
            return self.trial_done(c["trial"]) >= c.get("n", 1)
        if "trialMax" in c:
            mx = self.d.get("trial", {}).get("maxDone", 5)
            return sum(1 for t in self.d.get("trials", []) if self.trial_done(t["id"]) >= mx) >= c["trialMax"]
        # the Seed Bed (R23)
        if "logTier" in c:
            return self.log_tier(c["logTier"])
        if "logFull" in c:
            return self.log_full()
        if "sacrifices" in c:
            return self.sacrifices >= c["sacrifices"]
        # Lie Fallow (R24)
        if "fallows" in c:
            return self.fallows >= c["fallows"]
        if "loam" in c:
            return self.loam >= c["loam"]
        if "cellar" in c:
            return self.cellar_level(c["cellar"]) >= c.get("n", 1)
        if "cellarAny" in c:
            return any(self.cellar_level(x["id"]) >= 1 for x in self.d.get("cellar", []))
        if "cellarFull" in c:
            return all(self.cellar_maxed(x) for x in self.d.get("cellar", []))
        if "rehearsed" in c:
            return self.rehearsed
        # the Honey Stall & the third shelf (R25)
        if "charm" in c:
            return self.charm_count(c["charm"]) >= c.get("n", 1)
        if "charmsAny" in c:
            return self.charms_bought >= c["charmsAny"]
        if "cellarTier" in c:
            return any((x.get("tier", 1)) >= c["cellarTier"] and self.cellar_level(x["id"]) >= 1
                       for x in self.d.get("cellar", []))
        return False

    # ---------- the Honey Stall (R25) — mirror of core.js ----------
    def charm_data(self, cid) -> dict | None:
        return next((c for c in self.d.get("charms", []) if c["id"] == cid), None)

    def charm_count(self, cid) -> int:
        return self.charms.get(cid, 0)

    def charm_busy(self, cid) -> bool:
        return any(b.get("charm") == cid for b in self.buffs)

    def buy_charm(self, cid) -> bool:
        c = self.charm_data(cid)
        if not c or self.honey < c["cost"] or self.charm_busy(cid):
            return False
        if c.get("once") and self.charm_count(cid):
            return False
        if c.get("store") and self.charm_count(cid) >= c["store"]:
            return False
        self.honey -= c["cost"]
        self.charms_bought += 1
        if c.get("once") or c.get("store"):
            self.charms[cid] = self.charm_count(cid) + 1
        if c.get("dur"):
            self.buffs.append({"name": c["name"], "mult": 1, "left": float(c["dur"]), "keep": True, "charm": cid})
        elif c.get("cd"):
            # keep: the rest is a wall-clock cadence — a spring must not forgive it
            self.buffs.append({"name": c["name"], "mult": 1, "left": float(c["cd"]), "keep": True, "charm": cid})
        # no instant latch: the tick's _latch_pages(events) announces charm pages
        return True

    def use_candle(self) -> bool:
        if not self.charm_count("candle"):
            return False
        self.charms["candle"] -= 1
        if not self.charms["candle"]:
            del self.charms["candle"]
        return True

    # ---------- Lie Fallow & the Root Cellar (R24) — mirror of core.js ----------
    def bed_w(self) -> int:
        return (self.d.get("bed") or {"w": 4})["w"] + self.cellar_level("beds")

    def bed_h(self) -> int:
        return (self.d.get("bed") or {"h": 4})["h"] + self.cellar_level("beds")

    def bed_resize(self, old_w: int, old_h: int) -> None:
        w, h = self.bed_w(), self.bed_h()
        if (old_w, old_h) == (w, h):
            return
        old, nxt = self.bed["plots"], [None] * (w * h)
        for y in range(min(old_h, h)):
            for x in range(min(old_w, w)):
                nxt[y * w + x] = old[y * old_w + x] or None
        self.bed["plots"] = nxt

    def cellar_data(self, cid) -> dict | None:
        return next((c for c in self.d.get("cellar", []) if c["id"] == cid), None)

    def cellar_visible(self, c: dict) -> bool:
        """The tree (R25): a perk shows itself when its requirements hold level 1."""
        return all(self.cellar_level(r) >= 1 for r in c.get("req", []))

    def cellar_level(self, cid) -> int:
        return self.cellar.get(cid, 0)

    def cellar_cost(self, cid) -> int:
        return (self.d.get("fallow") or {}).get("cellarStep", 8) * (self.cellar_level(cid) + 1)

    def cellar_maxed(self, c: dict) -> bool:
        return self.cellar_level(c["id"]) >= c["cap"]

    def buy_cellar(self, cid) -> bool:
        c = self.cellar_data(cid)
        if not c or not self.cellar_visible(c) or self.cellar_maxed(c) or self.loam < self.cellar_cost(cid):
            return False
        w, h = self.bed_w(), self.bed_h()
        self.loam -= self.cellar_cost(cid)
        self.cellar[cid] = self.cellar_level(cid) + 1
        if cid == "beds":
            self.bed_resize(w, h)
        return True

    def loam_pending(self) -> int:
        return int(math.floor(math.log10(self.seeds) ** 2)) if self.seeds >= 10 else 0

    def fallow_available(self) -> bool:
        f = self.d.get("fallow")
        return bool(f) and self.loam_pending() >= f["minLoam"]

    def tilth_mult(self) -> float:
        return self.tilth_pct() / 100

    def tilth_pct(self) -> int:
        """Integer percent, so gain × mint × tilth is exact before the floor."""
        f = self.d.get("fallow")
        return 100 + round(f["tilthPerFallow"] * 100) * min(self.fallows, f["tilthCap"]) if f else 100

    def scarecrow_every(self) -> float:
        per = (self.cellar_data("pace") or {"per": 10})["per"]
        return max(10, self.d.get("trial", {}).get("scarecrowEvery", 60) - per * self.cellar_level("pace"))

    def gate_rate(self) -> float:
        return 1 + (self.cellar_data("gate") or {"per": 0.05})["per"] * self.cellar_level("gate")

    def fallow(self) -> int:
        """The world lies fallow — mirror of core.js fallow()."""
        if not self.fallow_available():
            return 0
        self._latch_pages()
        gain = self.loam_pending()
        self.loam += gain
        self.fallows += 1
        mem = self.cellar_level("memory")
        self.bank = 0.0
        self.total_run = 0.0
        self._lifetime_base = float(10 ** (2 * mem + 6)) if mem > 0 else 0.0
        self.seeds = 10 ** mem if mem > 0 else 0
        self.sprouts = 0
        self.bought = {}
        for u in self.d["shed"]:
            if u.get("repeat"):
                self.shed.pop(u["id"], None)
        self.buffs = [b for b in self.buffs if b.get("keep")]
        self.trial = None
        self.halt_t = 0.0
        self.run_best = 0.0
        self.run_t = 0.0
        self.owned = [0] * len(self.owned)
        self.spring_start()
        self._ribbon_seen = len(self.ribbons())
        return gain

    def spring_start(self) -> None:
        cap = (self.d.get("trial", {}).get("resproutCapBase", 100) + self.perks["resproutCap"]
               + 25 * self.cellar_level("beds"))
        for u in self.d["shed"]:
            if u.get("resprout") and "building" in u:
                self.owned[u["building"]] = max(self.owned[u["building"]], min(self.shed_level(u["id"]), cap))
        quick = (self.cellar_data("quick") or {"per": 10})["per"] * self.cellar_level("quick")
        if quick > 0:
            for i in range(len(self.owned)):
                self.owned[i] = max(self.owned[i], quick)
        for ti in range(self.perks["startTier"]):
            for i in range(len(self.owned)):
                self.bought[f"b{i}t{ti}"] = True
        self._bumper_seen = [self.bumper_count(i) for i in range(len(self.owned))]

    # ---------- the Seed Bed (R23) — mirror of core.js ----------
    def bed_rand(self) -> float:
        """The same 32-bit LCG as core.js bedRand, bit for bit."""
        self.bed["seed"] = (self.bed["seed"] * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.bed["seed"] / 4294967296

    def plant_data(self, pid) -> dict | None:
        return next((p for p in self.d.get("plants", []) if p["id"] == pid), None)

    def soil_data(self) -> dict:
        soils = self.d.get("soils") or [{"id": "dirt", "every": 1, "effect": 1, "mutation": 1}]
        return next((x for x in soils if x["id"] == self.bed["soil"]), soils[0])

    def plot_mature(self, pl) -> bool:
        p = self.plant_data(pl["sp"]) if pl else None
        return bool(p) and pl["age"] >= p["mature"]

    def plot_life(self, p: dict) -> int:
        """Cold Frames (R25): every plant lives a little longer — but a weed
        under glass is still a weed."""
        if p.get("wild"):
            return p["life"]
        return p["life"] + (self.cellar_data("coldframe") or {"per": 2})["per"] * self.cellar_level("coldframe")

    def bed_cps_ref(self) -> float:
        return max(10.0, self.base_cps(True) * self.season_mult())

    def bed_price(self, sp) -> dict | None:
        p = self.plant_data(sp)
        if not p or p.get("wild"):
            return None
        if p["tier"] == 1:
            return {"carrots": self.bed_cps_ref() * p["cost"] * 60}
        if self.bed["log"].get(sp):
            costs = self.d["bed"].get("honeyTierCost") or []
            return {"honey": costs[p["tier"]] if p["tier"] < len(costs) else 100}
        return None

    def bed_plant(self, i: int, sp) -> bool:
        if not (0 <= i < len(self.bed["plots"])) or self.bed["plots"][i]:
            return False
        price = self.bed_price(sp)
        if not price:
            return False
        if "carrots" in price:
            if self.bank < price["carrots"]:
                return False
            self.bank -= price["carrots"]
        else:
            if self.honey < price["honey"]:
                return False
            self.honey -= price["honey"]
        self.bed["plots"][i] = {"sp": sp, "age": 0}
        return True

    def bed_harvest(self, i: int) -> dict | None:
        pl = self.bed["plots"][i] if 0 <= i < len(self.bed["plots"]) else None
        if not self.plot_mature(pl):
            return None
        p = self.plant_data(pl["sp"])
        soil = self.soil_data()
        gain = 0.0
        if p.get("payout"):
            gain = min(self.bed_cps_ref() * p["payout"] * 60 * soil["effect"],
                       self.bank * self.d["bed"]["payoutCapPct"] + self.bed_cps_ref() * 60)
            self.earn(gain)
        # floor(x + 0.5), not round(): Python rounds halves to even, JS Math.round up
        honey = int(math.floor(p["honey"] * soil["effect"] + 0.5)) if p.get("honey") else 0
        self.honey += honey
        first = not self.bed["log"].get(pl["sp"])
        self.bed["log"][pl["sp"]] = self.bed["log"].get(pl["sp"], 0) + 1
        self.bed["plots"][i] = None
        return {"sp": pl["sp"], "gain": gain, "honey": honey, "first": first}

    def bed_soil(self, sid, now: float) -> bool:
        if not any(x["id"] == sid for x in self.d.get("soils", [])) or sid == self.bed["soil"]:
            return False
        if now - self.bed["soilAt"] < self.d["bed"]["soilCooldown"]:
            return False
        self.bed["soil"] = sid
        self.bed["soilAt"] = now
        return True

    def log_full(self) -> bool:
        return all(self.bed["log"].get(p["id"]) for p in self.d.get("plants", []))

    def log_tier(self, n: int) -> bool:
        return any(p["tier"] == n and self.bed["log"].get(p["id"]) for p in self.d.get("plants", []))

    def bed_sacrifice(self) -> bool:
        if not self.log_full() or self.bed["sacrificeLeft"] > 0 or self.bed.get("sacrificeRest", 0) > 0:
            return False
        self.bed["sacrificeLeft"] = float(self.d["bed"].get("sacrificeWait", 21600))
        return True

    def bed_cancel(self) -> bool:
        """A cancelled sacrifice rests a while: cancel/re-fire cannot ping-pong."""
        was = self.bed["sacrificeLeft"] > 0
        self.bed["sacrificeLeft"] = 0.0
        if was:
            self.bed["sacrificeRest"] = float(self.d["bed"].get("sacrificeRest", 600))
        return was

    def _mature_plants(self):
        for pl in self.bed["plots"]:
            if pl and self.plot_mature(pl):
                yield self.plant_data(pl["sp"])

    def bed_mult(self) -> float:
        e = self.soil_data()["effect"]
        m = 1.0
        for p in self._mature_plants():
            if p.get("mult"):
                m *= 1 + (p["mult"] - 1) * e
        return max(0.5, min(self.d["bed"]["multCap"], m))

    def bed_rabbit(self) -> float:
        m = 1.0
        for p in self._mature_plants():
            if p.get("rabbit"):
                m *= p["rabbit"]
        return min(self.d["bed"]["rabbitCap"], m)

    def bed_weather(self) -> float:
        m = 1.0
        for p in self._mature_plants():
            if p.get("weather"):
                m *= p["weather"]
        return min(self.d["bed"]["weatherCap"], m)

    def bed_neighbors(self, i: int) -> list[int]:
        w, h = self.bed_w(), self.bed_h()
        x, y = i % w, i // w
        out = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not dx and not dy:
                    continue
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h:
                    out.append(ny * w + nx)
        return out

    def bed_tick(self) -> list[dict]:
        events: list[dict] = []
        bed, soil = self.bed, self.soil_data()
        bed["n"] += 1
        if bed["n"] % soil["every"] != 0:
            return events
        for i, pl in enumerate(bed["plots"]):
            if not pl:
                continue
            p = self.plant_data(pl["sp"])
            if not p:
                bed["plots"][i] = None
                continue
            pl["age"] += 1
            if pl["age"] >= self.plot_life(p):
                bed["plots"][i] = None
                events.append({"type": "bedDied", "i": i, "sp": pl["sp"]})
        for i in range(len(bed["plots"])):
            if bed["plots"][i]:
                continue
            near = [bed["plots"][j]["sp"] for j in self.bed_neighbors(i) if self.plot_mature(bed["plots"][j])]
            born = None
            for p in self.d.get("plants", []):
                if p.get("wild"):
                    if self.bed_rand() < p["wild"]:
                        born = p["id"]
                        break
                    continue
                if not p.get("parents"):
                    continue
                a, b = p["parents"]
                ok = near.count(a) >= 2 if a == b else (a in near and b in near)
                if ok and self.bed_rand() < p["chance"] * soil["mutation"]:
                    born = p["id"]
                    break
            if born:
                bed["plots"][i] = {"sp": born, "age": 0}
                events.append({"type": "bedSprout", "i": i, "sp": born})
        return events

    # ---------- Trials (R22) — mirror of core.js ----------
    def trial_data(self, tid: str | None = None) -> dict | None:
        if tid is None:
            tid = self.trial["id"] if self.trial else None
        return next((t for t in self.d.get("trials", []) if t["id"] == tid), None)

    def rule(self, k: str):
        t = self.trial_data()
        return t["rule"].get(k) if t else None

    def trial_done(self, tid: str) -> int:
        return self.trials_done.get(tid, 0)

    def plain_run(self) -> float:
        return self.total_run if not self.trial and self.run_t >= self.d.get("trial", {}).get("minSpringSec", 3600) else 0.0

    def rule_handicap(self, tid: str) -> float:
        """How much of a plain spring's income the rule leaves, measured on
        THIS garden. Mirror of core.js ruleHandicap."""
        t = self.trial_data(tid)
        if not t:
            return 1.0
        saved, saved_halt = self.trial, self.halt_t
        self.trial, self.halt_t = None, 0.0
        plain = self.cps()
        self.trial = {"id": tid, "goal": 0.0, "t": 0.0}
        under = (self.click_power() * self.d.get("trial", {}).get("refClicks", 5)
                 if t["rule"].get("buildingsOff") else self.cps())
        self.trial, self.halt_t = saved, saved_halt
        if not plain > 0:
            return t["rule"].get("mulAll") or 1.0  # a bare garden: a flat rule still counts
        return max(1e-6, min(1.0, under / plain))  # Short Rows on a 700-plot world is well under 0.1 %

    def trial_goal(self, tid: str) -> float:
        """The best plain spring on record (or the one ending now), scaled by
        the rule's handicap, doubling per completion."""
        best = max(1e6, self.run_best, self.plain_run())
        return best * self.rule_handicap(tid) * self.d.get("trial", {}).get("step", 2) ** self.trial_done(tid)

    def row_count(self, i: int) -> int:
        return self.owned[i] if self.row_exists(i) else 0

    def trial_available(self, tid: str) -> bool:
        t = self.trial_data(tid)
        return bool(t) and self.trial_done(tid) < self.d.get("trial", {}).get("maxDone", 5)

    def halt_mult(self) -> float:
        h = self.rule("haltOnBuy")
        return max(0.0, 1 - self.halt_t / h) if h and self.halt_t > 0 else 1.0

    def touch_halt(self) -> None:
        h = self.rule("haltOnBuy")
        if h:
            self.halt_t = float(h)

    def row_exists(self, i: int) -> bool:
        m = self.rule("buildingsMax")
        return m is None or i < m

    def row_room(self, i: int) -> float:
        if not self.row_exists(i):
            return 0
        if self.rule("chain") and i > 0:
            return max(0, self.owned[i - 1] - self.owned[i])
        return math.inf

    def apply_reward(self, r: dict) -> None:
        p = self.perks
        if r.get("scarecrow"):
            p["scarecrow"] = min(5, p["scarecrow"] + r["scarecrow"])
        if r.get("startTier"):
            p["startTier"] = min(len(self.d["tiers"]), p["startTier"] + r["startTier"])
        if r.get("resproutCap"):
            p["resproutCap"] = min(100, p["resproutCap"] + r["resproutCap"])
        if r.get("cap"):
            p["cap"][r["cap"]] = min(10, p["cap"].get(r["cap"], 0) + r.get("n", 1))
        if r.get("longEars"):
            p["longEars"] = min(5, p["longEars"] + r["longEars"])
        if r.get("clickFrenzy"):
            p["clickFrenzy"] = min(5, p["clickFrenzy"] + r["clickFrenzy"])
        if r.get("honey"):
            self.honey += int(r["honey"])

    def upgrade_visible(self, u: dict) -> bool:
        if self.bought.get(u["id"]):
            return False
        if u["type"] == "building" and not self.row_exists(u["b"]):
            return False  # Short Rows
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
        self.touch_halt()  # Late Frost: an upgrade is a purchase too
        return True

    # ---------- production ----------
    def building_mult(self, i: int) -> float:
        m = 1.0
        for ti in range(len(self.d["tiers"])):
            if self.bought.get(f"b{i}t{ti}"):
                m *= 2
        for u in self.d["synergyUpgrades"]:
            if u["target"] == i and self.bought.get(u["id"]):
                m *= 1 + u["pct"] * self.row_count(u["per"])
        for u in self.d["shed"]:
            if u.get("building") == i and u.get("bmult"):
                m *= u["bmult"] ** self.shed_level(u["id"])
        return m

    def bumper_count(self, i: int) -> int:
        return sum(1 for at in self.d["milestones"] if self.row_count(i) >= at)

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
            if u.get("mult"):
                m *= u["mult"] ** self.shed_level(u["id"])
        m *= self.almanac_mult()
        m *= self.d["milestoneMult"] ** self.bumper_total()
        k = self.rule("mulAll")  # Drought: every blessing shrinks to a quarter (scale-free)
        return m * k if k else m

    def almanac_count(self) -> int:
        return len(self.almanac)

    def almanac_mult(self) -> float:
        return self.d["almanacMult"] ** self.almanac_count()

    def buff_mult(self) -> float:
        m = 1.0
        for b in self.buffs:
            m *= b["mult"]
        return m

    # seasons (R17): time-boxed world modifiers; unknown ids are homestead
    def season_data(self) -> dict | None:
        return next((s for s in self.d.get("seasons", []) if s["id"] == self.season), None)

    def season_mult(self) -> float:
        s = self.season_data()
        return (s or {}).get("mult") or 1

    def base_cps(self, raw: bool = False) -> float:
        """`raw` ignores Hands Only (clicks keep their share of what the plots
        WOULD make); Short Rows cuts the field for both. Mirror of core.js."""
        if not raw and self.rule("buildingsOff"):
            return 0.0
        c = sum(self.owned[i] * b["cps"] * self.building_mult(i)
                for i, b in enumerate(self.d["buildings"]) if self.row_exists(i))
        return c * self.global_mult()

    def cps(self) -> float:
        return (self.base_cps() * self.buff_mult() * self.season_mult() * self.hands_bonus
                * self.halt_mult() * self.bed_mult())

    def price_disc(self) -> float:
        """Every price discount in play: a priceOff season and Market Hour
        stack multiplicatively (R17/R21). Mirror of core.js priceDisc."""
        s = self.season_data()
        m = self.d.get("marketHour", {}).get("priceOff", 0) if self.market_hour else 0
        return (1 - ((s or {}).get("priceOff") or 0)) * (1 - (m or 0))

    def mint_honey(self, kind: str) -> int:
        """Honey (R21): minted by deeds, never by production."""
        n = self.d.get("honey", {}).get(kind, 0) or 0
        if n > 0:
            self.honey += n
        return n

    def click_power(self) -> float:
        base, pct = 1.0, 0.0
        for u in self.d["clickUpgrades"]:
            if not self.bought.get(u["id"]):
                continue
            if u.get("mult"):
                base *= u["mult"]
            if u.get("cpsPct"):
                pct += u["cpsPct"]
        for u in self.d["shed"]:
            if u.get("cpsPct"):
                pct += u["cpsPct"] * self.shed_level(u["id"])
        # Click Frenzy (R22 perk): a Rabbit Frenzy also multiplies clicks ×(1+2·lv)
        cf = (1 + 2 * self.perks["clickFrenzy"]
              if self.perks["clickFrenzy"] and any(b["name"] == "Rabbit Frenzy" for b in self.buffs) else 1)
        # Late Frost stills the harvest share of a click too; the bare hand never stills
        return ((base + pct * self.base_cps(True) * self.halt_mult()) * self.buff_mult() * self.season_mult()
                * self.hands_bonus * cf * self.bed_mult())

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
        return c0 * (r ** count - 1) / (r - 1) * self.price_disc()

    def buy(self, i: int, count: int = 1) -> int:
        """Buy exactly `count` or nothing, at the summed geometric price —
        matching core.js buy() and the ×N price the shop row displays.
        Returns the number bought (count or 0)."""
        if count < 1 or count > self.row_room(i):
            return 0
        cost = self.cost_of(i, count)
        if self.bank < cost:
            return 0
        self.bank -= cost
        self.owned[i] += count
        self.touch_halt()
        return count

    def max_affordable(self, i: int) -> int:
        """Largest count the bank affords right now (R20 "Max"): invert the
        geometric sum, verify ±1 against cost_of so float drift can never
        overcharge; capped at 5000. Mirror of core.js maxAffordable."""
        r = 1.15
        c0 = self.d["buildings"][i]["cost"] * (r ** self.owned[i]) * self.price_disc()
        if self.bank < c0:
            return 0
        m = min(5000, int(math.log(1 + self.bank * (r - 1) / c0) / math.log(r)))
        while m > 0 and self.cost_of(i, m) > self.bank:
            m -= 1
        while m < 5000 and self.cost_of(i, m + 1) <= self.bank:
            m += 1
        return int(min(m, self.row_room(i)))

    # ---------- the Potting Shed (R13/R15) ----------
    # Levels: a one-shot item goes 0->1; a `repeat` item climbs forever (or
    # to `max`) at ceil(cost*costGrowth^level) sprouts. Pre-R15 saves stored
    # True, which reads as level 1 — never rewrite the map, just read it.
    def shed_level(self, uid: str) -> int:
        v = self.shed.get(uid, 0)
        return 1 if v is True else int(v)

    def shed_cost(self, uid: str) -> float:
        u = next((u for u in self.d["shed"] if u["id"] == uid), None)
        if not u:
            return math.inf
        if u.get("repeat"):
            return math.ceil(u["cost"] * u["costGrowth"] ** self.shed_level(uid))
        return u["cost"]

    def shed_cap(self, u: dict) -> int:
        """Highest level a ladder can hold without costGrowth**level leaving
        double range. Per item: a 1.04 ladder climbs far past a 1.45 one — a
        flat 800 once clamped the live world's 1045-turn compost on reload.
        Mirror of core.js shedCap."""
        if "max" in u:
            return u["max"] + self.perks.get("cap", {}).get(u["id"], 0)  # Trial perk (R22)
        if not u.get("repeat") or not (u.get("costGrowth", 0) > 1):
            return 1
        return int(600 / math.log(u["costGrowth"]))  # e^600 ≈ 1e260

    def shed_maxed(self, u: dict) -> bool:
        lv = self.shed_level(u["id"])
        if u.get("repeat"):
            return "max" in u and lv >= self.shed_cap(u)  # cap perks count (R22)
        return lv >= 1

    def shed_visible(self, u: dict) -> bool:
        if u.get("unlock"):
            return all(self.cond_met(c) for c in u["unlock"])
        return True

    def mint_mult(self) -> int:
        # sprouts minted per seed at prestige: doublers stack (R15)
        m = 1
        for u in self.d["shed"]:
            if u.get("mintMult"):
                m *= u["mintMult"] ** self.shed_level(u["id"])
        return m

    def buy_shed(self, uid: str) -> bool:
        u = next((u for u in self.d["shed"] if u["id"] == uid), None)
        if not u or self.shed_maxed(u) or not self.shed_visible(u):
            return False
        cost = self.shed_cost(uid)
        if self.sprouts < cost:
            return False
        self.sprouts -= cost
        self.sprouts_spent += cost
        self.shed[uid] = self.shed_level(uid) + 1
        return True

    def rabbit_reward(self, rng=random.random) -> dict:
        self.rabbits += 1
        if rng() < 0.55:
            self.buffs.append({"name": "Rabbit Frenzy", "mult": 7, "left": 30.0})
            return {"kind": "frenzy", "text": "RABBIT FRENZY! Production ×7 for 30 seconds!"}
        gain = max(self.click_power() * 20,
                   min(self.bank * 0.15, self.cps() * 600) + self.cps() * 60)
        self.earn(gain)
        return {"kind": "lucky", "gain": gain, "text": f"Lucky bundle! +{fmt(gain)} carrots!"}

    def visitor_reward(self, kind: str, rng=random.random) -> dict:
        """One reward dispatch for every patch visitor (R19); mirror of
        core.js visitorReward. The tin rabbit pays nothing but the Almanac
        remembers; the Parsnip Man's stall is the world's shared gamble."""
        self.mint_honey("stall" if kind == "parsnip" else "tin" if kind == "tin" else "rabbit")
        if kind == "tin":
            self.tins += 1
            return {"kind": "tin"}
        if kind == "parsnip":
            self.stalls += 1
            if rng() < 0.4:
                self.buffs.append({"name": "Parsnip Embargo", "mult": 0.5, "left": 45.0})
                return {"kind": "embargo"}
            # same floor as the rabbit's bundle: a coup right after a world
            # prestige must never pay a humiliating +0 (review)
            gain = max(self.click_power() * 20,
                       min(self.bank * 0.25, self.cps() * 900) + self.cps() * 90)
            self.earn(gain)
            return {"kind": "coup", "gain": gain}
        return self.rabbit_reward(rng)  # the golden classic

    # ---------- prestige ----------
    def seeds_earned_total(self) -> int:
        return int(math.sqrt(self.total_all_time / 1e6))

    def pending_seeds(self) -> int:
        return max(0, self.seeds_earned_total() - self.seeds)

    def next_seed_at(self) -> float:
        return (self.seeds_earned_total() + 1) ** 2 * 1e6

    def prestige(self, trial_id: str | None = None) -> int:
        gain = self.pending_seeds()
        if gain < 1:
            return 0
        # a deed done in the dying second of a spring still counts (review F3)
        self._latch_pages()
        # Trials (R22): remember this spring, then maybe open the next one
        # under a rule. Going to seed mid-Trial abandons it.
        goal = (self.trial_goal(trial_id)
                if trial_id and self.trial_available(trial_id) and not self.trial else 0)
        self.run_best = max(self.run_best, self.plain_run())  # only an honest plain spring raises the bar
        self.run_t = 0.0
        self.trial = {"id": trial_id, "goal": goal, "t": 0.0} if goal > 0 else None
        self.halt_t = 0.0
        self.seeds += gain
        self.sprouts += int(gain * self.mint_mult() * self.tilth_pct() // 100)  # every seed sprouts (R13); doublers (R15); Tilth (R24)
        self.prestiges += 1
        self.mint_honey("spring")
        self.bank = 0.0
        self._lifetime_base += self.total_run  # fold the run before resetting it
        self.total_run = 0.0
        self.owned = [0] * len(self.owned)
        self.bought = {}
        # a spring clears the weather, never a Parish reward (R21)
        self.buffs = [b for b in self.buffs if b.get("keep")]
        # resprouts (R15), Quick Spring (R24), free tiers (R22) — and the
        # bumper pre-seed, so a resprouted row never fires a toast storm
        self.spring_start()
        return gain

    # ---------- tick ----------
    def tick(self, dt: float) -> list[dict]:
        events: list[dict] = []
        self.earn(self.cps() * dt)
        for b in self.buffs:
            b["left"] -= dt
        # the Bee Cooperative (p5) produces honey on the clock (R21)
        hd = self.d.get("honey")
        if hd and self.shed_level("p5") >= 1:
            # Warm Hives (R25): the cooperative works a longer day
            per = 86400 / (hd["beePerDay"] + (self.cellar_data("hives") or {"per": 6})["per"] * self.cellar_level("hives"))
            self.bee_t += dt
            while self.bee_t >= per:
                self.bee_t -= per
                self.honey += 1
        expired = [b for b in self.buffs if b["left"] <= 0]
        self.buffs = [b for b in self.buffs if b["left"] > 0]
        for b in expired:
            events.append({"type": "buffEnd", "name": b["name"]})
        # Trials (R22): the thaw, the clock, the goal
        self.run_t += dt
        if self.halt_t > 0:
            self.halt_t = max(0.0, self.halt_t - dt)
        if self.trial:
            tr = self.trial
            tr["t"] += dt
            td = self.d.get("trial", {})
            if self.total_run >= tr["goal"]:
                t = self.trial_data()
                n = self.trial_done(tr["id"]) + 1
                self.trials_done[tr["id"]] = n
                if not (self.trial_best.get(tr["id"], math.inf) <= tr["t"]):
                    self.trial_best[tr["id"]] = tr["t"]
                if t and t.get("reward"):
                    self.apply_reward(t["reward"])
                events.append({"type": "trial", "id": tr["id"], "won": True, "n": n, "t": tr["t"]})
                self.trial = None
                self.halt_t = 0.0
            elif tr["t"] >= td.get("hours", 48) * 3600:
                events.append({"type": "trial", "id": tr["id"], "won": False,
                               "n": self.trial_done(tr["id"]), "t": tr["t"]})
                self.trial = None
                self.halt_t = 0.0
        # the Seed Bed (R23): its own clock; a pending sacrifice counts down
        bd = self.d.get("bed")
        if bd:
            self.bed_t += dt
            while self.bed_t >= bd["tick"]:
                self.bed_t -= bd["tick"]
                events.extend(self.bed_tick())
            if self.bed.get("sacrificeRest", 0) > 0:
                self.bed["sacrificeRest"] = max(0.0, self.bed["sacrificeRest"] - dt)
            if self.bed["sacrificeLeft"] > 0:
                self.bed["sacrificeLeft"] -= dt
                if self.bed["sacrificeLeft"] <= 0:
                    self.bed["sacrificeLeft"] = 0.0
                    if self.log_full():
                        self.honey += int(bd["sacrificeHoney"])
                        self.sacrifices += 1
                        self.bed["log"] = {}
                        events.append({"type": "sacrifice", "honey": int(bd["sacrificeHoney"])})
        # the Scarecrow (R22 perk): every minute, one of the cheapest
        # affordable building among its rows, if ≤ 1% of the bank; it rests
        # during Late Frost. Mirror of core.js.
        if self.perks["scarecrow"] > 0 and not self.rule("haltOnBuy"):
            td = self.d.get("trial", {})
            self.sc_t += dt
            if self.sc_t >= self.scarecrow_every():
                self.sc_t = 0.0
                pick, best = -1, math.inf
                for i in range(min(len(self.owned), 2 * self.perks["scarecrow"])):
                    if self.row_room(i) < 1:
                        continue
                    c = self.cost_of(i, 1)
                    if c <= self.bank * td.get("scarecrowPct", 0.01) and c < best:
                        best, pick = c, i
                if pick >= 0 and self.buy(pick, 1):
                    events.append({"type": "scarecrow", "b": pick})
                # the Seed Drill (R25): it reads the packets too
                if self.cellar_level("drill") >= 1:
                    u = next((u for u in sorted((u for u in self.all_upgrades() if self.upgrade_visible(u)),
                                                key=lambda u: u["cost"])
                              if u["cost"] <= self.bank * td.get("scarecrowPct", 0.01)), None)
                    if u and self.buy_upgrade(u["id"]):
                        events.append({"type": "upgrade", "id": u["id"], "scarecrow": True})

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
        # Almanac pages latch the moment their deed is done — forever (R16)
        self._latch_pages(events)
        return events

    def _latch_pages(self, events: list | None = None) -> None:
        """Latch every satisfied unwritten page; silent without `events`
        (loads, prestige-instant deeds). Mirror of core.js latchPages."""
        for pg in self.d["almanac"]:
            if not self.almanac.get(pg["id"]) and all(self.cond_met(c) for c in pg["unlock"]):
                self.almanac[pg["id"]] = True
                if events is not None:
                    events.append({"type": "almanac", "id": pg["id"]})

    # ---------- persistence ----------
    def serialize(self) -> dict:
        return {
            "v": 1, "bank": self.bank, "totalAllTime": self.total_all_time,
            "totalRun": self.total_run, "clicks": self.clicks, "owned": self.owned,
            "bought": self.bought, "seeds": self.seeds, "buffs": self.buffs,
            "sprouts": self.sprouts, "shed": self.shed,
            "prestiges": self.prestiges, "rabbits": self.rabbits,
            "sproutsSpent": self.sprouts_spent, "almanac": self.almanac,
            "tins": self.tins, "stalls": self.stalls, "weathers": self.weathers,
            "honey": self.honey, "beeT": self.bee_t,
            "trial": dict(self.trial) if self.trial else None, "trialsDone": self.trials_done,
            "trialBest": self.trial_best, "runBest": self.run_best, "runT": self.run_t, "perks": self.perks,
            "haltT": self.halt_t,
            "bed": {"soil": self.bed["soil"], "plots": [dict(p) if p else None for p in self.bed["plots"]],
                    "log": dict(self.bed["log"]), "seed": self.bed["seed"], "n": self.bed["n"],
                    "soilAt": self.bed["soilAt"], "sacrificeLeft": self.bed["sacrificeLeft"],
                    "sacrificeRest": self.bed.get("sacrificeRest", 0.0)},
            "bedT": self.bed_t, "sacrifices": self.sacrifices,
            "loam": self.loam, "cellar": self.cellar, "charms": self.charms, "charmsBought": self.charms_bought,
            "fallows": self.fallows, "rehearsed": self.rehearsed,
            "season": self.season, "seasonStart": self.season_start,
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
        self.sprouts = max(0, s["sprouts"] if "sprouts" in s else s.get("seeds", 0))
        # a save is data, not authority (review F1): unknown shed ids are
        # dropped, levels forced to sane ints — a forged 1e9 "level" raises
        # OverflowError in every cost/effect pow and would kill the server
        # Trial perks first: a cap perk raises a ladder's cap, and the shed clamp below must see it (R22 review)
        pk = s.get("perks") if isinstance(s.get("perks"), dict) else {}

        def cnt(v, hi):
            return min(hi, _cnt(v))
        self.perks = {
            "scarecrow": cnt(pk.get("scarecrow"), 5), "startTier": cnt(pk.get("startTier"), len(self.d["tiers"])),
            "resproutCap": cnt(pk.get("resproutCap"), 100), "longEars": cnt(pk.get("longEars"), 5),
            "clickFrenzy": cnt(pk.get("clickFrenzy"), 5), "cap": {},
        }
        raw_cap = pk.get("cap") if isinstance(pk.get("cap"), dict) else {}
        for u in self.d["shed"]:
            v = cnt(raw_cap.get(u["id"]), 10)
            if v > 0 and "max" in u:
                self.perks["cap"][u["id"]] = v
        self.shed = {}
        raw_shed = s.get("shed") or {}
        for u in self.d["shed"]:
            v = raw_shed.get(u["id"], 0)
            if v is True:
                lv = 1
            elif isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                lv = int(v)
            else:
                lv = 0
            if lv > 0:
                self.shed[u["id"]] = min(lv, self.shed_cap(u))
        self.prestiges = _cnt(s.get("prestiges", 0))
        self.rabbits = _cnt(s.get("rabbits", 0))
        self.sprouts_spent = _cnt(s.get("sproutsSpent", 0))
        self.tins = _cnt(s.get("tins", 0))
        self.stalls = _cnt(s.get("stalls", 0))
        self.weathers = _cnt(s.get("weathers", 0))
        self.honey = _cnt(s.get("honey", 0))
        raw_bee = s.get("beeT", 0)
        self.bee_t = (min(float(raw_bee), 86400.0)
                      if isinstance(raw_bee, (int, float)) and not isinstance(raw_bee, bool)
                      and math.isfinite(raw_bee) and raw_bee > 0 else 0.0)
        # Trials (R22): ids must exist, counts stay inside the ladder, the
        # goal must be a real number — a forged inf goal would never end
        td = self.d.get("trial", {"maxDone": 5, "runLog": 5, "hours": 48})
        self.trials_done = {}
        self.trial_best = {}
        raw_td, raw_tb = s.get("trialsDone") or {}, s.get("trialBest") or {}
        for t in self.d.get("trials", []):
            n = _cnt(raw_td.get(t["id"], 0)) if isinstance(raw_td, dict) else 0
            if n > 0:
                self.trials_done[t["id"]] = min(n, td.get("maxDone", 5))
            b = raw_tb.get(t["id"]) if isinstance(raw_tb, dict) else None
            if isinstance(b, (int, float)) and not isinstance(b, bool) and math.isfinite(b) and b > 0:
                self.trial_best[t["id"]] = float(b)
        tr = s.get("trial")
        self.trial = None
        if (isinstance(tr, dict) and self.trial_data(tr.get("id"))
                and isinstance(tr.get("goal"), (int, float)) and not isinstance(tr.get("goal"), bool)
                and math.isfinite(tr["goal"]) and tr["goal"] > 0):
            raw_t = tr.get("t", 0)
            tt = (float(raw_t) if isinstance(raw_t, (int, float)) and not isinstance(raw_t, bool)
                  and math.isfinite(raw_t) and raw_t > 0 else 0.0)
            self.trial = {"id": tr["id"], "goal": float(tr["goal"]),
                          "t": min(tt, td.get("hours", 48) * 3600.0)}
        # pre-fix saves carried a five-entry runLog: its best seeds the high-water mark
        raw_log = s.get("runLog")
        old_log = ([float(x) for x in raw_log if isinstance(x, (int, float)) and not isinstance(x, bool)
                    and math.isfinite(x) and x >= 0] if isinstance(raw_log, list) else [])
        raw_rb = s.get("runBest", 0)
        rb_ok = isinstance(raw_rb, (int, float)) and not isinstance(raw_rb, bool) and math.isfinite(raw_rb) and raw_rb > 0
        self.run_best = max([0.0, float(raw_rb) if rb_ok else 0.0] + old_log)
        # a save from before runT existed is a spring of unknown age: call it old
        # enough to count, or the first Trial after a deploy would ask for 1e6
        raw_rt = s.get("runT", td.get("minSpringSec", 3600))
        self.run_t = (min(float(raw_rt), 1e9) if isinstance(raw_rt, (int, float)) and not isinstance(raw_rt, bool)
                      and math.isfinite(raw_rt) and raw_rt > 0 else 0.0)
        raw_h = s.get("haltT", 0)
        self.halt_t = (min(float(raw_h), 3600.0) if isinstance(raw_h, (int, float))
                       and not isinstance(raw_h, bool) and math.isfinite(raw_h) and raw_h > 0 else 0.0)
        # the Seed Bed (R23): species must exist, ages are ints, the seed is
        # a uint32, the log holds counts — a forged plot never grows a None

        def num(v, hi, lo=0.0):
            return (min(float(v), hi) if isinstance(v, (int, float)) and not isinstance(v, bool)
                    and math.isfinite(v) and v > lo else lo)
        # the Cellar first: the bed's size depends on it (R24)
        self.loam = _cnt(s.get("loam", 0))
        self.fallows = _cnt(s.get("fallows", 0))
        self.rehearsed = bool(s.get("rehearsed", False))
        self.cellar = {}
        raw_cel = s.get("cellar") if isinstance(s.get("cellar"), dict) else {}
        for cd in self.d.get("cellar", []):
            lv = _cnt(raw_cel.get(cd["id"], 0))
            if lv > 0:
                self.cellar[cd["id"]] = min(lv, cd["cap"])
        # charms (R25): known ids, counts clamped to their store (or 1 for a once)
        self.charms = {}
        raw_ch = s.get("charms") if isinstance(s.get("charms"), dict) else {}
        for cd in self.d.get("charms", []):
            n = _cnt(raw_ch.get(cd["id"], 0))
            if n > 0:
                self.charms[cd["id"]] = min(n, cd.get("store") or 1)
        self.charms_bought = _cnt(s.get("charmsBought", 0))
        bdd = {"w": self.bed_w(), "h": self.bed_h(), "tick": (self.d.get("bed") or {}).get("tick", 300)}
        rb = s.get("bed") if isinstance(s.get("bed"), dict) else {}
        fresh = fresh_bed(self.d, bdd["w"], bdd["h"])
        self.bed = fresh
        if any(x["id"] == rb.get("soil") for x in self.d.get("soils", [])):
            fresh["soil"] = rb["soil"]
        plots = rb.get("plots") if isinstance(rb.get("plots"), list) else []
        for i in range(bdd["w"] * bdd["h"]):
            pl = plots[i] if i < len(plots) else None
            p = self.plant_data(pl.get("sp")) if isinstance(pl, dict) else None
            if p:
                fresh["plots"][i] = {"sp": p["id"], "age": min(_cnt(pl.get("age", 0)), int(self.plot_life(p)))}
        raw_log = rb.get("log") if isinstance(rb.get("log"), dict) else {}
        for p in self.d.get("plants", []):
            n = _cnt(raw_log.get(p["id"], 0))
            if n > 0:
                fresh["log"][p["id"]] = min(n, 10 ** 9)
        fresh["seed"] = (_cnt(rb.get("seed", 1)) & 0xFFFFFFFF) or 1
        fresh["n"] = _cnt(rb.get("n", 0))
        fresh["soilAt"] = num(rb.get("soilAt", 0), 1e12)
        fresh["sacrificeLeft"] = num(rb.get("sacrificeLeft", 0), float((self.d.get("bed") or {}).get("sacrificeWait", 21600)))
        fresh["sacrificeRest"] = num(rb.get("sacrificeRest", 0), 3600.0)
        self.bed_t = num(s.get("bedT", 0), float(bdd.get("tick", 300)))
        self.sacrifices = _cnt(s.get("sacrifices", 0))
        # known page ids are historical fact and stay latched; junk ids
        # would mint ×1.02 each forever — dropped
        self.almanac = {}
        raw_al = s.get("almanac") or {}
        for pg in self.d["almanac"]:
            if raw_al.get(pg["id"]):
                self.almanac[pg["id"]] = True
        known_seasons = {x["id"] for x in self.d.get("seasons", [])}
        raw_season = s.get("season")
        # isinstance first: a forged list/dict is unhashable and `in set` raises
        self.season = (raw_season if isinstance(raw_season, str) and raw_season in known_seasons
                       else "homestead")
        raw_ss = s.get("seasonStart", 0)
        self.season_start = (min(float(raw_ss), time.time())
                             if isinstance(raw_ss, (int, float)) and not isinstance(raw_ss, bool)
                             and math.isfinite(raw_ss) and raw_ss > 0 else 0.0)
        # pages already satisfied by an older save latch silently (R16):
        # the load is not the deed, so it gets no toast storm
        self._latch_pages()
        self.buffs = s.get("buffs", [])
        self._ribbon_seen = len(self.ribbons())
        self._bumper_seen = [self.bumper_count(i) for i in range(len(self.owned))]
        # the garden keeps growing while the server is down (full rate, capped 24h)
        away = min(max(0.0, time.time() - s.get("saved", time.time())), 24 * 3600)
        for b in self.buffs:  # buffs kept ticking while we were down
            b["left"] -= away
        self.buffs = [b for b in self.buffs if b["left"] > 0]
        if self.trial:  # a Trial's 48 h is wall time; downtime counts against it
            self.trial["t"] += away
        if away > 1:
            self.earn(self.base_cps() * away)
            # the bed kept growing too (R23): same clock, same rolls
            bd = self.d.get("bed")
            if bd:
                self.bed_t += away
                while self.bed_t >= bd["tick"]:
                    self.bed_t -= bd["tick"]
                    self.bed_tick()

    def snapshot(self) -> dict:
        """Wire-format state pushed to every client."""
        return {
            "bank": self.bank, "totalAllTime": self.total_all_time,
            "totalRun": self.total_run, "clicks": self.clicks,
            "owned": self.owned, "bought": self.bought, "seeds": self.seeds,
            "sprouts": self.sprouts, "shed": self.shed,
            "prestiges": self.prestiges, "rabbits": self.rabbits,
            "sproutsSpent": self.sprouts_spent,  # clients gate keystone visibility on these
            "tins": self.tins, "stalls": self.stalls, "weathers": self.weathers,
            "honey": self.honey, "handsBonus": self.hands_bonus, "marketHour": self.market_hour,
            "trial": self.trial, "trialsDone": self.trials_done, "trialBest": self.trial_best,
            "runBest": self.run_best, "runT": self.run_t, "perks": self.perks, "haltT": self.halt_t,
            "bed": self.bed, "bedT": self.bed_t, "sacrifices": self.sacrifices,
            "loam": self.loam, "cellar": self.cellar, "charms": self.charms, "charmsBought": self.charms_bought,
            "fallows": self.fallows, "rehearsed": self.rehearsed,
            "almanac": self.almanac,
            "season": self.season,
            "seasonEnds": (self.season_start + self.d.get("seasonDays", 14) * 86400.0
                           if self.season_start else 0),
            # keep/charm ride the wire: the stall's busy state and the chip
            # styling key on them (R25 review)
            "buffs": [{k: b[k] for k in ("name", "mult", "left", "keep", "charm") if k in b}
                      for b in self.buffs],
        }


def _fx(v: float, d: int) -> str:
    """Format exactly like JS toFixed: round the EXACT binary value of v,
    half away from zero on true ties. python's format() rounds half-even,
    and multiply-then-floor mints false ties (1.075*100 == 107.5 exactly),
    so this goes through Decimal, which converts doubles losslessly."""
    return str(Decimal(v).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP))


def fmt(n: float) -> str:
    if n < 1000:
        # mirror CC.fmt: one decimal for small non-integers, ties rounding up
        # like toFixed (5.25 -> "5.3"), not python's round-half-even ("5.2")
        if n < 10 and n % 1:
            return _fx(n, 1)
        return str(int(n))
    units = ["k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc",
             "Ud", "Dd", "Td", "Qad", "Qid",
             "Sxd", "Spd", "Ocd", "Nod", "Vg"]  # Ud..Vg: R14/R17, mirror of CC.fmt
    u = -1
    while n >= 1000 and u < len(units) - 1:
        n /= 1000
        u += 1
    if n >= 999.5 and u < len(units) - 1:  # /1000 drift guard, mirror of CC.fmt
        n /= 1000
        u += 1
    return f"{_fx(n, 0)}{units[u]}" if n >= 100 else f"{_fx(n, 1)}{units[u]}" if n >= 10 else f"{_fx(n, 2)}{units[u]}"
