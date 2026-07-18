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
        for u in self.d["shed"]:
            if u.get("building") == i and u.get("bmult"):
                m *= u["bmult"] ** self.shed_level(u["id"])
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
            if u.get("mult"):
                m *= u["mult"] ** self.shed_level(u["id"])
        m *= self.almanac_mult()
        m *= self.d["milestoneMult"] ** self.bumper_total()
        return m

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

    def base_cps(self) -> float:
        c = sum(self.owned[i] * b["cps"] * self.building_mult(i)
                for i, b in enumerate(self.d["buildings"]))
        return c * self.global_mult()

    def cps(self) -> float:
        return self.base_cps() * self.buff_mult() * self.season_mult()

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
        return (base + pct * self.base_cps()) * self.buff_mult() * self.season_mult()

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
        s = self.season_data()
        return c0 * (r ** count - 1) / (r - 1) * (1 - ((s or {}).get("priceOff") or 0))

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

    def shed_maxed(self, u: dict) -> bool:
        lv = self.shed_level(u["id"])
        if u.get("repeat"):
            return "max" in u and lv >= u["max"]
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

    def prestige(self) -> int:
        gain = self.pending_seeds()
        if gain < 1:
            return 0
        # a deed done in the dying second of a spring still counts (review F3)
        self._latch_pages()
        self.seeds += gain
        self.sprouts += gain * self.mint_mult()  # every seed sprouts (R13); doublers stack (R15)
        self.prestiges += 1
        self.bank = 0.0
        self._lifetime_base += self.total_run  # fold the run before resetting it
        self.total_run = 0.0
        self.owned = [0] * len(self.owned)
        self.bought = {}
        self.buffs = []
        # resprout (R15): heirloom strains regrow themselves each spring
        for u in self.d["shed"]:
            if u.get("resprout") and "building" in u:
                self.owned[u["building"]] = min(self.shed_level(u["id"]), 100)
        # pre-seed, silently: resprouted rows must not fire a bumper toast storm
        self._bumper_seen = [self.bumper_count(i) for i in range(len(self.owned))]
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
                self.shed[u["id"]] = min(lv, u.get("max", 800))
        self.prestiges = _cnt(s.get("prestiges", 0))
        self.rabbits = _cnt(s.get("rabbits", 0))
        self.sprouts_spent = _cnt(s.get("sproutsSpent", 0))
        self.tins = _cnt(s.get("tins", 0))
        self.stalls = _cnt(s.get("stalls", 0))
        self.weathers = _cnt(s.get("weathers", 0))
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
        if away > 1:
            self.earn(self.base_cps() * away)

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
            "almanac": self.almanac,
            "season": self.season,
            "seasonEnds": (self.season_start + self.d.get("seasonDays", 14) * 86400.0
                           if self.season_start else 0),
            "buffs": [{"name": b["name"], "mult": b["mult"], "left": b["left"]} for b in self.buffs],
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
