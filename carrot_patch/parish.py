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
import time
from collections import deque
from pathlib import Path

from .economy import Economy, market_hour_at

DAY = 86400.0
NOTABLE = {"prestige", "season", "order_posted", "order_resolved", "ribbon",
           "almanac", "quiet", "fallow", "trial"}


def utc_day(epoch: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(epoch))


class Chronicle:
    def __init__(self, path: Path):
        self.path = path

    def log(self, ev: dict) -> None:
        rec = {"t": round(time.time(), 1), **ev}
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError:
            pass  # the chronicle is a record, never a gate

    def read(self, since: float = 0.0, max_lines: int = 20000) -> list[dict]:
        if not self.path.exists():
            return []
        out: list[dict] = []
        with open(self.path, encoding="utf-8") as f:
            for line in deque(f, maxlen=max_lines):
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if ev.get("t", 0) >= since:
                    out.append(ev)
        return out

    def days(self, n: int = 7) -> list[dict]:
        """Per-UTC-day summaries for the last n days, newest first: counts
        by event type plus the notable events in order."""
        buckets: dict[str, dict] = {}
        for ev in self.read(time.time() - n * DAY):
            d = utc_day(ev["t"])
            b = buckets.setdefault(d, {"day": d, "counts": {}, "notable": []})
            b["counts"][ev["type"]] = b["counts"].get(ev["type"], 0) + 1
            if ev["type"] in NOTABLE:
                b["notable"].append(ev)
        return sorted(buckets.values(), key=lambda b: b["day"], reverse=True)


class OrderBook:
    def __init__(self, data: dict, state_path: Path, chronicle: Chronicle):
        self.d = data
        self.path = state_path
        self.chronicle = chronicle
        self.order: dict | None = None
        self.history: list[dict] = []     # last outcomes, newest last
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
            self.override_used = int(s.get("overrideUsed", 0) or 0)
            self.last_intent = float(s.get("lastIntent", 0) or 0)
            self.effects = {k: float(v) for k, v in (s.get("effects") or {}).items()}

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps({
                "order": self.order, "history": self.history[-20:],
                "overrideUsed": self.override_used, "lastIntent": self.last_intent,
                "effects": self.effects,
            }))
            tmp.replace(self.path)
        except OSError:
            pass

    # ---------- the override file: a human holds the pen ----------
    def override_spec(self) -> dict | None:
        path = self.path.with_name("orders_override.json")
        try:
            raw = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None
        specs = raw if isinstance(raw, list) else [raw]
        specs = [x for x in specs if isinstance(x, dict) and x.get("kind") and x.get("tiers")]
        if self.override_used < len(specs):
            spec = dict(specs[self.override_used])
            spec.setdefault("id", f"override{self.override_used}")
            spec.setdefault("name", "A Special Order")
            spec["authored"] = True
            return spec
        return None

    # ---------- posting ----------
    def baseline(self, eco: Economy) -> dict:
        return {
            "lifetime": eco.total_all_time, "visitors": eco.rabbits + eco.tins + eco.stalls,
            "stalls": eco.stalls, "pages": len(eco.almanac), "springs": eco.prestiges,
            "sproutsSpent": eco.sprouts_spent, "cps": eco.cps(), "sprouts": eco.sprouts,
        }

    def targets(self, spec: dict, base: dict) -> list[float]:
        """Relative targets: harvest tiers are weeks of the cps at posting,
        grounds tiers a share of the sprouts held. A dead-still world (cps 0,
        no sprouts) would post a free order — floor the scale so tier 1 is
        always a deed, never a formality."""
        k = spec["kind"]
        scale = {"harvest": max(base["cps"], 1.0) * 7 * DAY,
                 "sprouts": max(base["sprouts"], 1)}.get(k, 1)
        return [max(1.0, float(t) * scale) for t in spec["tiers"]]

    def post(self, eco: Economy, now: float) -> dict:
        spec = self.override_spec()
        if spec:
            self.override_used += 1
        else:
            table = self.d.get("orders") or []
            spec = table[len(self.history) % len(table)] if table else {
                "id": "harvest", "name": "The Parish Harvest", "kind": "harvest", "tiers": [1, 2, 4]}
        mh = market_hour_at(now, self.d)
        deadline = mh["end"]
        if deadline - now < DAY:           # never post an order due in under a day
            deadline += 7 * DAY
        base = self.baseline(eco)
        self.order = {
            "id": spec["id"], "name": spec["name"], "kind": spec["kind"],
            "line": spec.get("line", ""), "unit": spec.get("unit", ""),
            "authored": bool(spec.get("authored")),
            "postedAt": now, "deadline": deadline, "base": base,
            "targets": self.targets(spec, base),
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
