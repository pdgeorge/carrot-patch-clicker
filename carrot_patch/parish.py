"""The Parish (R21): the world's clocks and appointments.

Server-only systems (DESIGN P2) — the engine pair only learns honey, Many
Hands and the Market Hour price:

- Chronicle: an append-only, day-bucketed world event log beside the save
  (`<state>_events.jsonl`). Backs /api/chronicle, "while you were away",
  and the Today's Patch share card.
- OrderBook: Parish Orders — a weekly three-tier deadline the world can
  MISS. Targets are relative to the world at posting; the deadline is the
  end of the next Market Hour. Rotation follows CC.ORDERS; a human can hold
  the pen with `orders_override.json` beside the save.
- Quiet: a garden untouched for hours stirs when someone returns.

State that must survive restarts (the live order, its history, the quiet
clock) lives in `<state>_parish.json`, not the world save — it is parish
business, not economy (the "blobs in JSON, ledgers in SQLite" doctrine).
"""
from __future__ import annotations

import json
import math
import time
from collections import deque
from pathlib import Path

from .economy import Economy, market_hour_at

DAY = 86400.0
NOTABLE = {"prestige", "season", "order_posted", "order_resolved", "order_skipped", "ribbon",
           "almanac", "quiet", "fallow", "trial"}
KINDS = {"harvest", "visitors", "stalls", "pages", "springs", "sprouts", "quilt", "trials"}


def utc_day(epoch: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(epoch))


RING = 20000          # events kept in memory: a week at ~1k/day with room to spare
TAIL_BYTES = 4 << 20  # how much of an old file is read back at startup
DAYS_TTL = 60.0       # /api/chronicle day summaries are memoised this long


class Chronicle:
    """Append-only on disk (the durable record); a bounded ring in memory
    (what the endpoints read). The file is touched once at startup and
    then only ever appended — a GET never rescans it (review R21)."""

    def __init__(self, path: Path):
        self.path = path
        self.recent: deque = deque(maxlen=RING)
        self._days: tuple[float, list] | None = None
        try:
            with open(self.path, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - TAIL_BYTES))
                chunk = f.read().decode("utf-8", "replace")
            lines = chunk.split("\n")
            if size > TAIL_BYTES:
                lines = lines[1:]  # the first line of a tail read is a torn one
            for line in lines:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(ev, dict) and isinstance(ev.get("t"), (int, float)) and ev.get("type"):
                    self.recent.append(ev)
        except OSError:
            pass

    def log(self, ev: dict) -> None:
        rec = {"t": round(time.time(), 1), **ev}
        self.recent.append(rec)
        self._days = None
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError:
            pass  # the chronicle is a record, never a gate

    def read(self, since: float = 0.0) -> list[dict]:
        return [ev for ev in self.recent if ev["t"] >= since]

    def count(self, kind: str, seconds: float) -> int:
        since = time.time() - seconds
        return sum(1 for ev in self.recent if ev["type"] == kind and ev["t"] >= since)

    def days(self, n: int = 7) -> list[dict]:
        """Per-UTC-day summaries for the last n days, newest first: counts
        by event type plus the notable events in order. Memoised: every
        client polls this, and the answer changes at most once a second."""
        now = time.time()
        if self._days and now - self._days[0] < DAYS_TTL:
            return self._days[1]
        buckets: dict[str, dict] = {}
        for ev in self.read(now - n * DAY):
            d = utc_day(ev["t"])
            b = buckets.setdefault(d, {"day": d, "counts": {}, "notable": []})
            b["counts"][ev["type"]] = b["counts"].get(ev["type"], 0) + 1
            if ev["type"] in NOTABLE:
                b["notable"].append(ev)
        out = sorted(buckets.values(), key=lambda b: b["day"], reverse=True)
        self._days = (now, out)
        return out


class Quilt:
    """The Patchwork Quilt (R22): w×h cells, a palette index each (0 = bare
    cloth). One pixel per connection per cooldown, costing a second of the
    world's cps. Survives Go to Seed; framed into the chronicle and cleared
    at Lie Fallow (R24). Lives in `<state>_quilt.json`."""

    def __init__(self, data: dict, path: Path):
        q = data.get("quilt") or {"w": 48, "h": 48, "cooldown": 30, "costSeconds": 1, "palette": ["#fff"] * 16}
        self.w, self.h = int(q["w"]), int(q["h"])
        self.colors = len(q.get("palette") or []) or 16
        self.cooldown = float(q.get("cooldown", 30))
        self.cost_seconds = float(q.get("costSeconds", 1))
        self.path = path
        self.cells = bytearray(self.w * self.h)
        self.version = 0
        self.painted = 0
        self.load()

    def load(self) -> None:
        try:
            s = json.loads(self.path.read_text())
            raw = bytes.fromhex(s.get("cells", ""))
        except (OSError, ValueError, TypeError, AttributeError):
            return
        if len(raw) == self.w * self.h:
            self.cells = bytearray(min(b, self.colors - 1) for b in raw)
            self.version = int(s.get("version", 0) or 0)
            self.painted = int(s.get("painted", 0) or 0)

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({"cells": self.cells.hex(), "version": self.version,
                                       "painted": self.painted}))
            tmp.replace(self.path)
        except OSError:
            pass

    def paint(self, i: int, c: int) -> bool:
        if not (0 <= i < self.w * self.h and 0 <= c < self.colors):
            return False
        if self.cells[i] == c:
            return False  # painting the same colour is not a stitch
        self.cells[i] = c
        self.version += 1
        self.painted += 1
        return True

    def fill(self) -> float:
        """Share of the quilt that is not bare cloth — the Order's reading."""
        return sum(1 for b in self.cells if b) / max(1, self.w * self.h)

    def clear(self) -> str:
        """Frame the quilt (returns its hex) and start a fresh one."""
        framed = self.cells.hex()
        self.cells = bytearray(self.w * self.h)
        self.version += 1
        self.save()
        return framed

    def snapshot(self) -> dict:
        return {"w": self.w, "h": self.h, "v": self.version, "cells": self.cells.hex(), "painted": self.painted}


class OrderBook:
    def __init__(self, data: dict, state_path: Path, chronicle: Chronicle, quilt: Quilt | None = None):
        self.d = data
        self.path = state_path
        self.chronicle = chronicle
        self.quilt = quilt
        self.order: dict | None = None
        self.history: list[dict] = []     # last outcomes, newest last
        self.rotation = 0                 # next table index — its own counter, not len(history)
        self.override_used = 0
        self.last_intent = 0.0
        self.effects: dict[str, float] = {}  # name -> until (epoch); visitorRate/weatherGap
        self.load()

    # ---------- persistence ----------
    def load(self) -> None:
        try:
            s = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return
        if isinstance(s, dict):
            self.order = s.get("order") if isinstance(s.get("order"), dict) else None
            self.history = [h for h in (s.get("history") or []) if isinstance(h, dict)][-20:]
            self.rotation = int(s.get("rotation", len(self.history)) or 0)
            self.override_used = int(s.get("overrideUsed", 0) or 0)
            self.last_intent = float(s.get("lastIntent", 0) or 0)
            self.effects = {k: float(v) for k, v in (s.get("effects") or {}).items()}

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({
                "order": self.order, "history": self.history[-20:], "rotation": self.rotation,
                "overrideUsed": self.override_used, "lastIntent": self.last_intent,
                "effects": self.effects,
            }))
            tmp.replace(self.path)
        except OSError:
            pass

    # ---------- the override file: a human holds the pen ----------
    @staticmethod
    def valid_spec(x) -> bool:
        """The documented shape, enforced at the pen: a known kind and exactly
        three finite, positive, ascending tiers. Anything else is skipped —
        a typo must never post an unwinnable order or stop the world loop."""
        if not isinstance(x, dict) or x.get("kind") not in KINDS:
            return False
        t = x.get("tiers")
        if not (isinstance(t, list) and len(t) == 3):
            return False
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in t):
            return False
        return t[0] <= t[1] <= t[2]

    def override_spec(self) -> dict | None:
        path = self.path.with_name("orders_override.json")
        try:
            raw = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None
        specs = raw if isinstance(raw, list) else [raw]
        while self.override_used < len(specs):
            x = specs[self.override_used]
            if self.valid_spec(x):
                spec = {"id": str(x.get("id", f"override{self.override_used}"))[:24],
                        "name": str(x.get("name", "A Special Order"))[:40], "kind": x["kind"],
                        "tiers": [float(v) for v in x["tiers"]], "line": str(x.get("line", ""))[:160],
                        "unit": str(x.get("unit", ""))[:40], "authored": True}
                return spec
            self.override_used += 1  # skip the bad one, remember that we did
            self.chronicle.log({"type": "order_skipped", "reason": "invalid override"})
        return None

    # ---------- posting ----------
    def baseline(self, eco: Economy) -> dict:
        """The world as it stands at posting. `cps` is the STEADY rate —
        buildings × season, no buffs, no Many Hands, no Late Frost — so the
        reward just applied (or a rain at the bell, or a crowd of sockets)
        can never set the bar for the next order (review R21)."""
        return {
            "lifetime": eco.total_all_time, "visitors": eco.rabbits + eco.tins + eco.stalls,
            "stalls": eco.stalls, "pages": len(eco.almanac), "springs": eco.prestiges,
            "sproutsSpent": eco.sprouts_spent, "cps": eco.base_cps() * eco.season_mult(),
            "sprouts": eco.sprouts, "trials": sum(eco.trials_done.values()),
            "weekSprings": self.chronicle.count("prestige", 7 * DAY),
        }

    def targets(self, spec: dict, base: dict, window: float) -> list[float]:
        """Relative targets, pro-rated to the ACTUAL window (a first-boot or
        post-restart order is due in 1–8 days, not always 7): harvest tiers
        are multiples of the steady cps × the seconds until the bell; guest
        tiers a share of the guests expected in the window (one per mean
        gap; stalls by their weight); springs a multiple of last week's;
        grounds a share of the sprouts held. Quilt fill and pages are
        absolute. A dead-still world is floored so tier 1 is always a deed."""
        k = spec["kind"]
        vs = self.d.get("visitors") or []
        gap = self.d.get("visitorGap") or [90, 240]
        guests = window / (sum(gap) / 2 + 12)
        wsum = sum(v.get("weight", 1) for v in vs) or 1
        stall_share = next((v.get("weight", 1) for v in vs if v["id"] == "parsnip"), 0) / wsum
        scale = {"harvest": max(base["cps"], 1.0) * window,
                 "sprouts": max(base["sprouts"], 1),
                 "visitors": max(guests, 1.0),
                 "stalls": max(guests * stall_share, 1.0),
                 "springs": max(base.get("weekSprings", 0), 1) * (window / (7 * DAY))}.get(k, 1)
        return [max(1.0, float(t) * scale) for t in spec["tiers"]]

    def reachable(self, spec: dict, eco: Economy) -> bool:
        """Some kinds can be dead on the live world: a full Almanac has no
        pages to write, a finished quilt has nothing to fill, maxed Trials
        cannot be entered. Those are skipped, not posted as sure Embargoes."""
        k = spec["kind"]
        if k == "pages":
            return len(self.d.get("almanac", [])) - len(eco.almanac) >= spec["tiers"][0]
        if k == "quilt":
            return (self.quilt.fill() if self.quilt else 0.0) < spec["tiers"][0]
        if k == "trials":
            return any(eco.trial_available(t["id"]) for t in self.d.get("trials", []))
        return True

    def post(self, eco: Economy, now: float) -> dict:
        fallback = {"id": "harvest", "name": "The Parish Harvest", "kind": "harvest", "tiers": [1, 2, 4]}
        spec = self.override_spec()
        if spec:
            self.override_used += 1
        else:
            table = [x for x in (self.d.get("orders") or []) if self.valid_spec(x)]
            spec = None
            for _ in range(len(table)):  # walk the rotation past the unwinnable
                cand = table[self.rotation % len(table)]
                self.rotation += 1
                if self.reachable(cand, eco):
                    spec = cand
                    break
                self.chronicle.log({"type": "order_skipped", "id": cand["id"], "reason": "unreachable"})
            spec = spec or fallback
        mh = market_hour_at(now, self.d)
        # the bell is the end of the next Market Hour; with no Market Hour in
        # the data, a plain week (a dead 1970 deadline would resolve every tick)
        deadline = mh["end"] if mh["end"] > now else now + 7 * DAY
        if deadline - now < DAY:           # never post an order due in under a day
            deadline += 7 * DAY
        base = self.baseline(eco)
        self.order = {
            "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
            "line": spec.get("line", ""), "unit": spec.get("unit", ""),
            "authored": bool(spec.get("authored")),
            "postedAt": now, "deadline": deadline, "base": base,
            "targets": self.targets(spec, base, deadline - now),
        }
        self.chronicle.log({"type": "order_posted", "id": spec["id"], "name": spec["name"],
                            "deadline": deadline})
        self.save()
        return self.order

    # ---------- progress & resolution ----------
    def value(self, eco: Economy) -> float:
        o, b = self.order, self.order["base"]
        k = o["kind"]
        if k == "harvest":
            return eco.total_all_time - b["lifetime"]
        if k == "visitors":
            return (eco.rabbits + eco.tins + eco.stalls) - b["visitors"]
        if k == "stalls":
            return eco.stalls - b["stalls"]
        if k == "pages":
            return len(eco.almanac) - b["pages"]
        if k == "springs":
            return eco.prestiges - b["springs"]
        if k == "sprouts":
            return eco.sprouts_spent - b["sproutsSpent"]
        if k == "trials":
            return sum(eco.trials_done.values()) - b.get("trials", 0)
        if k == "quilt":  # absolute, not relative: how full the quilt IS
            return self.quilt.fill() if self.quilt else 0.0
        return 0.0

    def tier(self, eco: Economy) -> int:
        v = self.value(eco)
        return sum(1 for t in self.order["targets"] if v >= t)

    def snapshot(self, eco: Economy, now: float) -> dict | None:
        if not self.order:
            return None
        v = self.value(eco)
        return {
            "id": self.order["id"], "name": self.order["name"], "kind": self.order["kind"],
            "line": self.order["line"], "unit": self.order["unit"], "authored": self.order["authored"],
            "deadline": self.order["deadline"], "targets": self.order["targets"],
            "value": v, "tier": sum(1 for t in self.order["targets"] if v >= t),
            "last": self.history[-1] if self.history else None,
        }

    def maybe_resolve(self, eco: Economy, now: float) -> dict | None:
        """At the deadline: apply the reached tier's rewards (or the failure
        effects), record the outcome, and clear the order. Returns the
        outcome for the caller to broadcast, else None."""
        if not self.order or now < self.order["deadline"]:
            return None
        o = self.order
        tier = self.tier(eco)
        rewards = (self.d.get("orderRewards") or {}).get(str(tier)) if tier else None
        effects = rewards if tier else (self.d.get("orderFail") or [])
        applied = self.apply(eco, effects or [], now)
        outcome = {"id": o["id"], "name": o["name"], "tier": tier, "value": self.value(eco),
                   "targets": o["targets"], "applied": applied, "at": now}
        self.history.append(outcome)
        self.chronicle.log({"type": "order_resolved", "id": o["id"], "name": o["name"],
                            "tier": tier, "won": tier > 0})
        self.order = None
        self.save()
        return outcome

    def apply(self, eco: Economy, effects: list[dict], now: float) -> list[str]:
        """Reward/failure shapes: {honey}, {buff:{name,mult,dur}},
        {visitorRate, dur}, {weatherGapMult, dur}. Time-boxed by construction."""
        applied = []
        for e in effects:
            if "honey" in e:
                eco.honey += int(e["honey"])
                applied.append(f"+{int(e['honey'])} honey")
            if "buff" in e:
                b = e["buff"]
                eco.buffs.append({"name": b["name"], "mult": b["mult"], "left": float(b["dur"]),
                                  "keep": True})
                applied.append(f"{b['name']} ×{b['mult']} for {round(b['dur'] / 3600)}h")
            if "visitorRate" in e:
                self.effects["visitorRate"] = now + float(e.get("dur", DAY))
                self.effects["visitorRateMult"] = float(e["visitorRate"])
                applied.append(f"visitors ×{e['visitorRate']} for {round(e.get('dur', DAY) / 3600)}h")
            if "weatherGapMult" in e:
                self.effects["weatherGap"] = now + float(e.get("dur", DAY))
                self.effects["weatherGapMult"] = float(e["weatherGapMult"])
                applied.append(f"weather gap ×{e['weatherGapMult']} for {round(e.get('dur', DAY) / 3600)}h")
        return applied

    # ---------- live modifiers for the schedulers ----------
    def visitor_rate(self, now: float) -> float:
        return self.effects.get("visitorRateMult", 1.0) if now < self.effects.get("visitorRate", 0) else 1.0

    def weather_gap_mult(self, now: float) -> float:
        return self.effects.get("weatherGapMult", 1.0) if now < self.effects.get("weatherGap", 0) else 1.0

    # ---------- the Quiet state ----------
    def touch(self, eco: Economy, now: float) -> float | None:
        """Record an intent. If the garden had been quiet for long enough
        (CC.QUIET.afterHours), the returning tender wakes it: a time-boxed
        Welcome Back buff for everyone. Returns the quiet hours, else None."""
        q = self.d.get("quiet") or {"afterHours": 6, "boostHours": 1, "boost": 2}
        gap = now - self.last_intent if self.last_intent else 0.0
        self.last_intent = now
        if gap >= q["afterHours"] * 3600:
            eco.buffs.append({"name": "Welcome Back", "mult": q["boost"],
                              "left": q["boostHours"] * 3600.0, "keep": True})
            self.chronicle.log({"type": "quiet", "hours": round(gap / 3600, 1)})
            self.save()
            return gap / 3600
        return None
