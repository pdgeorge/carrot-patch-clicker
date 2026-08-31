"""Carrot Patch — one shared garden for the whole world.

Run standalone:
    uvicorn carrot_patch.main:app --host 0.0.0.0 --port 8420

Or mount into an existing FastAPI site:
    from carrot_patch.main import create_app
    site.mount("/carrot-patch", create_app())

Every connected client sees and spends the same global carrot bank.
Clients batch clicks into one message per second; the server clamps
per-connection click rates, so auto-clickers cost the same bandwidth
as a patient human.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import random
import sys
import time
import traceback
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .economy import Economy, dist_dir, fmt, load_data, market_hour_at
from .parish import Chronicle, OrderBook, Quilt
from .tenders import TenderBook

MAX_CLICKS_PER_MSG = 1000    # anti-flood only, never game balance (DESIGN P4/R2):
                             # autoclickers are welcome (raised 250→1000, 2026-07)—
                             # this ceiling only stops forged clicks-you-never-made
                             # packets, not enthusiasm; the economy makes clicks fade
MIN_MSG_INTERVAL = 0.75      # seconds between click batches per connection
MAX_MSGS_PER_SEC = 10        # any message type, per connection
NAME_INTERVAL = 5.0          # seconds between accepted signatures per connection (R21)
SNAPSHOT_INTERVAL = 1.0
SAVE_INTERVAL = 30.0


def clamp_int(v: object, hi: int) -> int:
    """Best-effort wire integer in [0, hi]. json.loads happily produces NaN,
    Infinity, null, strings and lists — none of which may ever raise here,
    because an exception would kill that client's websocket. Garbage is 0."""
    try:
        n = int(v)  # bools are ints, floats truncate, junk raises
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, min(n, hi))


def state_file() -> Path:
    """World-state save location (CARROT_PATCH_STATE overrides, e.g. a volume)."""
    return Path(os.getenv("CARROT_PATCH_STATE",
                          Path(__file__).resolve().parent / "patch_state.json"))


def tenders_file() -> Path:
    """Tender registry (SQLite), kept beside the world save."""
    return state_file().with_name(state_file().stem + "_tenders.db")


def parish_file() -> Path:
    """Parish business (the live Order, its history, the quiet clock) beside
    the save; `orders_override.json` in the same folder holds the pen (R21)."""
    return state_file().with_name(state_file().stem + "_parish.json")


def chronicle_file() -> Path:
    return state_file().with_name(state_file().stem + "_events.jsonl")


def quilt_file() -> Path:
    return state_file().with_name(state_file().stem + "_quilt.json")


class Patch:
    def __init__(self) -> None:
        self.eco = Economy(load_data())
        if state_file().exists():
            try:
                self.eco.deserialize(json.loads(state_file().read_text()))
            except (json.JSONDecodeError, OSError):
                pass  # corrupt or unreadable save: start a fresh garden
        self.tenders = TenderBook(tenders_file(),
                                  Path(__file__).resolve().parent / "blocklist.txt")
        self.chronicle = Chronicle(chronicle_file())   # R21: the world's day-book
        self.quilt = Quilt(self.eco.d, quilt_file())   # R22: the canvas the world paints
        self.orders = OrderBook(self.eco.d, parish_file(), self.chronicle, self.quilt)
        self._names_7d = 0                              # Many Hands: distinct names, 7 days
        self._names_at = 0.0
        self._paint_at: dict[str, float] = {}           # quilt cooldown per ADDRESS — sockets are free (R22 review)
        self._plant_at: dict[str, float] = {}           # the trowel, per address (R24 review)
        self._harvest_at: dict[str, float] = {}         # the basket, per address
        self._plant_plots: dict[str, set] = {}          # address -> plots it planted that are still immature
        self._quilt_sent_v = 0                          # the quilt version whose diffs every client has seen
        self.clients: set[WebSocket] = set()
        self._conns: list[dict] = []       # the per-connection dicts, for the bell's electorate
        self.click_window = 0          # clicks landed in the current snapshot window
        self.click_rate = 0            # last window's global clicks/sec, for display
        self.visitor: dict | None = None  # R19: {kind, until} — one guest at a time
        self.next_visitor = time.monotonic() + self.visitor_wait(
            *self.eco.d.get("visitorFirst", [60, 150]))
        self.next_weather = time.monotonic() + random.uniform(
            *self.eco.d.get("weatherGap", [600, 1500]))
        self._pending: list[dict] = []  # extra events to broadcast with next snapshot
        if not self.eco.season_start:  # R17: the calendar starts the day it ships
            self.eco.season_start = time.time()
        # the Parish clocks are transient (never saved): read them before the
        # first tick, or a restart inside Market Hour would re-ring the bell
        self.eco.market_hour = market_hour_at(time.time(), self.eco.d)["active"]
        self.eco.hands_bonus = self.hands_bonus()

    def visitor_wait(self, lo: float, hi: float) -> float:
        """Seconds until the next visitor — Fair season, the Market Hour and
        a won Order all liven the garden; every factor is time-boxed (R21)."""
        rate = (self.eco.season_data() or {}).get("rabbitRate", 1)
        if self.eco.market_hour:
            rate *= (self.eco.d.get("marketHour") or {}).get("visitorRate", 1)
        rate *= self.orders.visitor_rate(time.time())
        rate *= self.eco.bed_rabbit()  # the Seed Bed (R23): clover draws rabbits
        rate *= self.eco.gate_rate()   # Open Gate (R24 Cellar)
        return random.uniform(lo, hi) / rate

    def weather_wait(self) -> float:
        lo, hi = self.eco.d.get("weatherGap", [600, 1500])
        div = (self.eco.d.get("marketHour") or {}).get("weatherDiv", 1) if self.eco.market_hour else 1
        return random.uniform(lo, hi) / div * self.orders.weather_gap_mult(time.time())

    # ---------- the Parish (R21) ----------
    def hands_bonus(self) -> float:
        """Many Hands: +perOnline per tender online now, +perName per distinct
        name on the board this week — presence, never resources (P1)."""
        h = self.eco.d.get("hands")
        if not h:
            return 1.0
        wall = time.time()
        if wall - self._names_at > 60:
            self._names_at = wall
            self._names_7d = self.tenders.names_active(h.get("nameDays", 7))
        return (1 + min(len(self.clients), h["onlineCap"]) * h["perOnline"]
                + min(self._names_7d, h["nameCap"]) * h["perName"])

    def parish_tick(self, wall: float) -> None:
        eco = self.eco
        eco.hands_bonus = self.hands_bonus()
        mh = market_hour_at(wall, eco.d)
        if mh["active"] != eco.market_hour:
            eco.market_hour = mh["active"]
            self.emit({"type": "market", "open": mh["active"]})
            self.chronicle.log({"type": "market_open" if mh["active"] else "market_close"})
            if mh["active"]:  # the stalls open: guests and weather pick up at once
                self.next_visitor = min(self.next_visitor, time.monotonic() + self.visitor_wait(
                    *eco.d.get("visitorGap", [90, 240])))
        done = self.orders.maybe_resolve(eco, wall)
        if done:
            self.emit({"type": "order", "phase": "resolved", **done})
            self.save()
        if eco.d.get("orders") and not self.orders.held(eco):
            while len(self.orders.live) < self.orders.slots(eco):  # Wider Orders (R24)
                o = self.orders.post(eco, wall)
                self.emit({"type": "order", "phase": "posted", "id": o["id"], "name": o["name"],
                           "deadline": o["deadline"]})
        # Lie Fallow's bell (R24): on a Fallow the world is saved FIRST, then
        # the quilt is framed and cleared, then the parish file — the three
        # files can never disagree about whether the Fallow happened
        for ev in self.orders.bell_tick(eco, wall, self.quilt):
            if ev["type"] == "fallow":
                self.save()                      # world → parish → quilt
                self.orders.frame_quilt(ev, self.quilt)
                self.orders.save()
            elif ev["type"] in ("rehearsed", "silence", "bell"):
                self.save()
            self.emit(ev)

    def online_addrs(self) -> int:
        """Distinct client addresses connected right now (the bell's electorate)."""
        return len({c.get("addr") or "?" for c in self._conns}) or 1

    def touch(self, conn: dict) -> None:
        """An intent arrived. A quiet garden stirs for whoever came back."""
        woke = self.orders.touch(self.eco, time.time())
        if woke is not None:
            self.emit({"type": "quiet", "hours": round(woke["hours"], 1), "boost": woke["boost"],
                       "bh": woke["boostHours"], "candle": woke["candle"], "who": conn.get("name") or ""})

    def snapshot_msg(self, now: float) -> dict:
        vttl = max(0.0, self.visitor["until"] - now) if self.visitor else 0
        wall = time.time()
        mh = market_hour_at(wall, self.eco.d)
        return {
            "type": "snapshot",
            "state": self.eco.snapshot(),
            "online": len(self.clients),
            "clickRate": self.click_rate,
            "visitor": {"kind": self.visitor["kind"], "ttl": vttl} if self.visitor else None,
            # legacy field: stale tabs only understand golden rabbits (tin
            # rides along — the decoy fools them exactly as intended)
            "rabbitTtl": vttl if self.visitor and self.visitor["kind"] in ("rabbit", "tin") else 0,
            # the Parish (R21): the order on the board and the market clock
            "order": self.orders.snapshot(self.eco, wall),
            "orders": self.orders.snapshot_all(self.eco),   # Wider Orders (R24): every card on the board
            # Lie Fallow's bell (R24): the votes as a COUNT — never the voters' addresses
            "bell": ({k: v for k, v in self.orders.bell.items() if k != "silences"}
                     | {"votes": len(self.orders.bell.get("silences", {}))}) if self.orders.bell else None,
            "bellRest": self.orders.bell_rest,
            "market": {"active": mh["active"], "next": mh["next"], "end": mh["end"]},
            "now": wall,  # server wall clock so deadlines render without trusting the tab
            "quiltV": self._quilt_sent_v,  # R22: the version whose diffs have been broadcast; a client behind it refetches
        }

    # ---------- persistence ----------
    def save(self) -> None:
        target = state_file()
        tmp = target.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(self.eco.serialize()))
            tmp.replace(target)
        except OSError as e:  # a full disk must not kill the world loop; the next autosave retries
            print(f"carrot-patch: save failed: {e}", file=sys.stderr)
        self.orders.save()
        self.quilt.save()

    def save_soon(self) -> None:
        """Durable-ish save for hot paths: at most one write per 5 s — a
        launch-day shed spree is hundreds of purchases, and a synchronous
        atomic write per purchase stalls the loop (review). The 30 s
        autosave, prestige saves and shutdown cover the gaps."""
        now = time.monotonic()
        if now - getattr(self, "_last_soon", 0.0) > 5.0:
            self._last_soon = now
            self.save()

    # ---------- broadcast ----------
    async def broadcast(self, msg: dict) -> None:
        dead = []
        data = json.dumps(msg)
        for ws in self.clients:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def announce(self, text: str) -> None:
        self._pending.append({"type": "toast", "text": text})

    def emit(self, ev: dict) -> None:
        """Broadcast a structured event (F1) plus legacy prose for pre-F1
        clients — stale tabs reconnect with old JS and only understand
        `toast`. Drop the prose once a post-F1 build has been live (R12)."""
        self._pending.append({"type": "event", "ev": ev})
        text = self.legacy_text(ev)
        if text:
            self.announce(text)

    def legacy_text(self, ev: dict) -> str | None:
        d = self.eco.d
        if ev["type"] == "ribbon":
            r = d["ribbons"][ev["i"]]
            return f"🎀 {r['name']}! {r['flavor']} (+{round((r['mult'] - 1) * 100)}% production)"
        if ev["type"] == "bumper":
            return f"🌾 Bumper crop! {ev['at']}× {d['buildings'][ev['b']]['name']} — +1% to everything."
        if ev["type"] == "upgrade":
            u = next((u for u in self.eco.all_upgrades() if u["id"] == ev["id"]), None)
            return f"🛠 Someone bought {u['name']}!" if u else None
        if ev["type"] == "rabbitCaught":
            what = ("RABBIT FRENZY! Production ×7 for 30 seconds!" if ev["kind"] == "frenzy"
                    else f"Lucky bundle! +{fmt(ev['gain'])} carrots!")
            return f"🐇 Caught by a tender somewhere on Earth — {what}"
        if ev["type"] == "prestige":
            boost = ev.get("boost")
            if boost is None or boost < 1.0005:  # at 100M+ seeds the ratio rounds to 1
                what = "the seeds stack deeper"
            elif boost < 2:
                what = f"seed bonus ×{boost:.3f}"
            elif boost < 1000:
                what = f"seed bonus ×{boost:.2f}"
            else:
                what = f"seed bonus ×{fmt(boost)}"
            return (f"🌸 SOMEONE SENT THE WHOLE GARDEN TO SEED. +{fmt(ev['gained'])} seeds "
                    f"({what}) for everyone. A new spring begins.")
        if ev["type"] == "weather":
            w = next((x for x in d.get("weather", []) if x["id"] == ev["id"]), None)
            return (f"🌦 {w['name']} drifts across the whole garden — "
                    f"×{w['mult']} production for {w['dur']}s.") if w else None
        if ev["type"] == "visitorCaught":
            out = ev.get("out")
            if out == "tin":
                return "🥫 Clank. The tin rabbit. Somewhere, the parsnip man giggles."
            if out == "coup":
                return (f"🥕📈 Market coup! The Parsnip Man's stall folds — "
                        f"+{fmt(ev.get('gain', 0))} carrots for everyone!")
            if out == "embargo":
                return "🥀 Parsnip embargo! Production ×0.5 for 45 seconds. He got us this time."
            return None
        if ev["type"] == "fallow":
            return (f"🔔 THE WORLD LIES FALLOW. +{ev.get('loam', 0)} loam; seeds, plots and ladders return to the "
                    f"ground. Fallow Year {ev.get('fallows', 1)}.")
        if ev["type"] == "bell":
            return (f"🔔 The bell rings ({ev.get('ring', 1)} of {ev.get('of', 4)})"
                    f"{' — a rehearsal' if ev.get('rehearsal') else ''}. Anyone may silence it.")
        if ev["type"] == "charm":
            c = next((x for x in d.get("charms", []) if x["id"] == ev["id"]), None)
            return f"🍯 {ev.get('who') or 'A tender'} bought {c['name']} at the stall. {c['flavor']}" if c else None
        if ev["type"] == "bedSprout":
            p = next((x for x in d.get("plants", []) if x["id"] == ev["sp"]), None)
            return f"🌱 Something new sprouted in the bed: {p['name']}." if p else None
        if ev["type"] == "sacrifice":
            return f"🍯 The seed log was given up for {ev.get('honey', 0)} honey. The bed begins again."
        if ev["type"] == "trial":
            t = next((x for x in d.get("trials", []) if x["id"] == ev["id"]), None)
            name = t["name"] if t else "the Trial"
            return (f"🧪 {name} — won! The world gets back to where it was. ({ev.get('n', 1)}/5)"
                    if ev.get("won") else f"🧪 {name} — the clock ran out. The spring carries on.")
        if ev["type"] == "season":
            s = next((x for x in d.get("seasons", []) if x["id"] == ev["id"]), None)
            return f"🎪 A new season begins: {s['name']}! {s['bonus']}." if s else None
        if ev["type"] == "almanac":
            pg = next((p for p in d["almanac"] if p["id"] == ev["id"]), None)
            return (f"📖 A page is written in the Almanac: {pg['name']}. "
                    f"(+{round((d['almanacMult'] - 1) * 100)}% production, forever)") if pg else None
        if ev["type"] == "shed":
            u = next((u for u in d["shed"] if u["id"] == ev["id"]), None)
            if not u:
                return None
            lv = ev.get("lv", 1)
            what = f" → Lv {lv}!" if u.get("repeat") else "!"
            eff = (f" +{round((u['mult'] - 1) * 100)}% production, forever."
                   if u.get("mult") else "")
            return f"🌱 A sprout was planted: {u['name']}{what}{eff}"
        return None

    # ---------- main loop ----------
    async def run(self) -> None:
        last = time.monotonic()
        last_save = last
        while True:
            await asyncio.sleep(SNAPSHOT_INTERVAL)
            now = time.monotonic()
            dt = now - last
            last = now

            wall = time.time()
            self.parish_tick(wall)
            for ev in self.eco.tick(dt):
                if ev["type"] == "scarecrow":
                    continue  # a patient hand, once a minute — the snapshot shows it; no toast
                self.emit(ev)
                if ev["type"] in ("ribbon", "almanac", "bumper", "trial", "bedSprout", "sacrifice"):
                    self.chronicle.log(ev)
                if ev["type"] == "trial":
                    self.save()

            # seasons rotate on real time (R17); the server owns the calendar
            period = self.eco.d.get("seasonDays", 14) * 86400.0
            if self.eco.season_start and wall - self.eco.season_start >= period:
                steps = int((wall - self.eco.season_start) // period)
                seasons = self.eco.d.get("seasons", [])
                if seasons:
                    idx = next((i for i, s in enumerate(seasons)
                                if s["id"] == self.eco.season), 0)
                    prev = self.eco.season
                    self.eco.season = seasons[(idx + steps) % len(seasons)]["id"]
                    self.eco.season_start += steps * period
                    if self.eco.season != prev:  # a 42-day catch-up can lap the wheel
                        self.emit({"type": "season", "id": self.eco.season})
                        self.chronicle.log({"type": "season", "id": self.eco.season})
                    self.save()

            # visitor lifecycle (R19, global): rabbits golden and tin, the
            # Parsnip Man's stall — one data table, one clock
            gap = self.eco.d.get("visitorGap", [90, 240])
            if self.visitor and now > self.visitor["until"]:
                self.visitor = None
                self.next_visitor = now + self.visitor_wait(*gap)
            if not self.visitor and now >= self.next_visitor and self.eco.rule("noVisitors"):
                self.next_visitor = now + self.visitor_wait(*gap)  # Quiet Hedge (R22): nobody comes
            if not self.visitor and now >= self.next_visitor:
                vs = self.eco.d.get("visitors") or [{"id": "rabbit", "ttl": 12}]
                # A Four-Leaf Clover (R25): while it hangs, no tin — every gold is true
                if self.eco.charm_busy("clover4"):
                    vs = [x for x in vs if x["id"] != "tin"] or vs
                v = random.choices(vs, weights=[x.get("weight", 1) for x in vs])[0]
                # Long Ears (R22) and A Picnic Blanket (R25): guests linger a few seconds more
                ttl = (float(v.get("ttl", 12)) + self.eco.perks.get("longEars", 0) * (
                    self.eco.d.get("trial") or {}).get("longEarsSec", 3)
                    + (6 if self.eco.charm_busy("picnic") else 0))
                self.visitor = {"kind": v["id"], "until": now + ttl}
                self._pending.append({"type": "visitor", "kind": v["id"], "ttl": ttl})
                if v["id"] in ("rabbit", "tin"):  # stale tabs see gold — tin fools them too
                    self._pending.append({"type": "rabbit", "ttl": ttl})

            # weather (R19): it simply happens to everyone at once
            if now >= self.next_weather:
                self.next_weather = now + self.weather_wait()
                ws = self.eco.d.get("weather") or []
                if ws:
                    w = random.choices(ws, weights=[x.get("weight", 1) for x in ws])[0]
                    # the Seed Bed (R23): bluebells make the rain last
                    self.eco.buffs.append(
                        {"name": w["name"], "mult": w["mult"], "left": float(w["dur"]) * self.eco.bed_weather()})
                    self.eco.weathers += 1
                    self.eco.mint_honey("rain")  # R21: weather is a deed of the sky
                    self.emit({"type": "weather", "id": w["id"]})
                    self.chronicle.log({"type": "weather", "id": w["id"]})

            self.click_rate = round(self.click_window / max(dt, 0.001))
            self.click_window = 0

            await self.broadcast(self.snapshot_msg(now))
            for ev in self._pending:
                await self.broadcast(ev)
            self._pending = []
            self._quilt_sent_v = self.quilt.version  # every stitch up to here has now been broadcast

            if now - last_save > SAVE_INTERVAL:
                last_save = now
                self.save()

    # ---------- per-client messages ----------
    def handle(self, msg: dict, conn: dict) -> dict | None:
        """Apply one intent. May return a reply to send only to this client."""
        kind = msg.get("type")
        eco = self.eco
        now = time.monotonic()
        if kind in ("clicks", "buy", "upgrade", "shed", "catch", "prestige"):
            self.touch(conn)  # R21: the Quiet state — a returning tender wakes the garden

        if kind == "clicks":
            if now - conn["last_click_msg"] < MIN_MSG_INTERVAL:
                return None  # too chatty; batch harder
            conn["last_click_msg"] = now
            n = clamp_int(msg.get("n", 0), MAX_CLICKS_PER_MSG)
            if n:
                eco.do_clicks(n)
                self.click_window += n
                if conn.get("name"):
                    self.tenders.bump(conn["name"], clicks=n)

        elif kind == "buy":
            b = msg.get("b")
            if isinstance(b, int) and not isinstance(b, bool) and 0 <= b < len(eco.owned):
                raw_n = msg.get("n")
                if raw_n == "max":
                    # Max resolves HERE, against the bank as it is now —
                    # the shared bank moves between click and arrival (R20)
                    n = eco.max_affordable(b)
                elif raw_n in (5, 10) and not isinstance(raw_n, bool):
                    n = int(raw_n)
                else:
                    n = 1
                bought = eco.buy(b, n) if n else 0
                if bought and conn.get("name"):
                    self.tenders.bump(conn["name"], buildings=bought)

        elif kind == "name":
            # sign the noticeboard (R11): recognition, never resources. One
            # signature per socket per NAME_INTERVAL: a board row is permanent,
            # and ten a second would be a sybil's whole day in a minute (R21)
            if now - conn.get("last_name", -1e9) < NAME_INTERVAL:
                return {"type": "name", "ok": False, "name": ""}
            conn["last_name"] = now
            name = self.tenders.clean(msg.get("name", ""))
            if name:
                conn["name"] = name
                self.tenders.bump(name)  # appear on the board immediately
            return {"type": "name", "ok": name is not None, "name": name or ""}

        elif kind == "upgrade":
            uid = str(msg.get("id", ""))[:16]
            if eco.buy_upgrade(uid):
                self.emit({"type": "upgrade", "id": uid})
                self.chronicle.log({"type": "upgrade", "id": uid, "who": conn.get("name") or ""})

        elif kind == "shed":
            # the Potting Shed (R13/R15): spend the world's sprouts on a perk level
            uid = str(msg.get("id", ""))[:16]
            if eco.buy_shed(uid):
                lv = eco.shed_level(uid)
                item = next((u for u in eco.d["shed"] if u["id"] == uid), None)
                # ladders announce milestones only (level 1 and every 10th) —
                # a spree must not paint ten toasts a second on every screen;
                # levels stay visible to everyone through the snapshot anyway
                if not (item and item.get("repeat")) or lv == 1 or lv % 10 == 0:
                    self.emit({"type": "shed", "id": uid, "lv": lv})
                    self.chronicle.log({"type": "shed", "id": uid, "lv": lv,
                                        "who": conn.get("name") or ""})
                self.save_soon()

        elif kind == "catch":
            if self.visitor and now <= self.visitor["until"]:
                v = self.visitor["kind"]
                self.visitor = None
                self.next_visitor = now + self.visitor_wait(
                    *eco.d.get("visitorGap", [90, 240]))
                r = eco.visitor_reward(v)
                if v == "rabbit":
                    self.emit({"type": "rabbitCaught", "kind": r["kind"], "gain": r.get("gain", 0)})
                else:
                    self.emit({"type": "visitorCaught", "v": v, "out": r["kind"], "gain": r.get("gain", 0)})
                self.chronicle.log({"type": "catch", "v": v, "out": r["kind"],
                                    "who": conn.get("name") or ""})

        elif kind == "prestige":
            before = eco.seed_mult()
            # Trials (R22): "go to seed… into a Trial" — one rule for the
            # whole planet's next spring; junk ids fall back to a plain spring
            tid = msg.get("trial")
            tid = tid if isinstance(tid, str) and eco.trial_available(tid) and not eco.trial else None
            was = dict(eco.trial) if eco.trial else None
            gained = eco.prestige(tid)
            if gained and was:  # going to seed mid-Trial abandons it — for everyone, on the record
                self.emit({"type": "trial", "id": was["id"], "won": False, "abandoned": True,
                           "n": eco.trial_done(was["id"]), "t": was["t"], "who": conn.get("name") or ""})
                self.chronicle.log({"type": "trial", "id": was["id"], "won": False, "abandoned": True, "t": was["t"]})
            if gained:
                # boost = the world's actual seed-bonus change; the old
                # "+8N% forever" copy overstated it by orders of magnitude
                self.emit({"type": "prestige", "gained": gained,
                           "boost": eco.seed_mult() / before,
                           "trial": eco.trial["id"] if eco.trial else None})
                # no `who`: the modal promises "your name will not be recorded" (R11)
                self.chronicle.log({"type": "prestige", "gained": gained,
                                    "trial": eco.trial["id"] if eco.trial else None})
                self.save()

        elif kind == "plant":
            # the Seed Bed (R23): one seed per ADDRESS per cooldown, into an
            # empty plot, paid in steady-cps minutes or honey (P1: no uproot) —
            # and no address may hold more than a share of the bed immature,
            # or one trowel could lock every plot forever (R24 review). The
            # sender always gets an answer, so a refused seed never locks its
            # trowel for nothing.
            bd = self.eco.d.get("bed", {})
            key = conn.get("addr") or "?"
            raw_i, sp = msg.get("i"), msg.get("sp")
            if (isinstance(raw_i, bool) or not isinstance(raw_i, (int, float)) or not math.isfinite(raw_i)
                    or not isinstance(sp, str) or len(sp) > 24):
                return {"type": "plant", "ok": False, "why": "garbage"}
            i = int(raw_i)
            if now - self._plant_at.get(key, -1e9) < bd.get("plantCooldown", 60):
                return {"type": "plant", "ok": False, "i": i, "why": "trowel"}
            mine = self._plant_plots.setdefault(key, set())
            mine.intersection_update({j for j in mine if 0 <= j < len(eco.bed["plots"])
                                      and eco.bed["plots"][j] and not eco.plot_mature(eco.bed["plots"][j])})
            cap = max(1, math.ceil(len(eco.bed["plots"]) * bd.get("immatureShare", 0.25)))
            if len(mine) >= cap:
                return {"type": "plant", "ok": False, "i": i, "why": "share", "cap": cap}
            if eco.bed_plant(i, sp):
                self._plant_at[key] = now
                mine.add(i)
                self.emit({"type": "bedPlant", "i": i, "sp": sp, "who": conn.get("name") or ""})
                self.save_soon()
                return {"type": "plant", "ok": True, "i": i}
            return {"type": "plant", "ok": False, "i": i, "why": "refused"}

        elif kind == "harvest":
            raw_i = msg.get("i")
            if isinstance(raw_i, bool) or not isinstance(raw_i, (int, float)) or not math.isfinite(raw_i):
                return None
            key = conn.get("addr") or "?"
            if now - self._harvest_at.get(key, -1e9) < self.eco.d.get("bed", {}).get("harvestCooldown", 15):
                return None  # the basket, per address: a loop cannot strip every parent at maturity
            r = eco.bed_harvest(int(raw_i))
            if r:
                self._harvest_at[key] = now
                self.emit({"type": "bedHarvest", "i": int(raw_i), "sp": r["sp"], "gain": r["gain"],
                           "honey": r["honey"], "first": r["first"], "who": conn.get("name") or ""})
                if r["first"]:
                    self.chronicle.log({"type": "bedFound", "sp": r["sp"], "who": conn.get("name") or ""})
                self.save_soon()

        elif kind == "soil":
            sid = msg.get("id")
            if isinstance(sid, str) and eco.bed_soil(sid, time.time()):
                self.emit({"type": "soil", "id": sid, "who": conn.get("name") or ""})
                self.chronicle.log({"type": "soil", "id": sid})
                self.save_soon()

        elif kind == "sacrifice":
            if eco.bed_sacrifice():
                self.emit({"type": "sacrificeStart", "left": eco.bed["sacrificeLeft"], "who": conn.get("name") or ""})
                self.save_soon()

        elif kind == "cancelSacrifice":
            if eco.bed_cancel():
                self.emit({"type": "sacrificeCancel", "who": conn.get("name") or ""})
                self.save_soon()

        elif kind == "ring":
            # Lie Fallow's bell (R24): anyone may ring it once the loam is there
            b = self.orders.ring(eco, time.time(), conn.get("name") or "", conn.get("addr") or "")
            if b:
                self.emit({"type": "bell", "ring": 1, "of": eco.d["fallow"]["rings"], "rehearsal": b["rehearsal"],
                           "next": b["at"] + eco.d["fallow"]["ringGap"], "who": b["who"]})
                self.save()

        elif kind == "silence":
            # a voice for quiet: half the addresses online must agree (R24 review)
            r = self.orders.silence(conn.get("name") or "", conn.get("addr") or "", self.online_addrs(), time.time())
            if r and r["silenced"]:
                self.emit({"type": "silence", "who": conn.get("name") or ""})
            elif r:
                self.emit({"type": "silenceVote", "who": conn.get("name") or "", "votes": r["votes"], "needed": r["needed"]})

        elif kind == "charm":
            # the Honey Stall (R25): honey buys a charm; the engine takes the
            # honey and hangs the buff, the server performs the instant part
            cid = str(msg.get("id", ""))[:16]
            cd = eco.charm_data(cid)
            if cd and eco.buy_charm(cid):
                if cid == "sugar" and not self.visitor:
                    self.next_visitor = min(self.next_visitor, now + random.uniform(5, 60))
                elif cid == "rainjar":
                    ws = [w for w in (eco.d.get("weather") or []) if w["id"] == "rain"]
                    if ws:
                        w = ws[0]
                        eco.buffs.append({"name": w["name"], "mult": w["mult"], "left": float(w["dur"])
                                          * eco.bed_weather()})
                        eco.weathers += 1
                        eco.mint_honey("rain")
                        self.emit({"type": "weather", "id": w["id"]})
                self.emit({"type": "charm", "id": cid, "who": conn.get("name") or "",
                           "cosmetic": bool(cd.get("cosmetic"))})
                if cd.get("cosmetic"):
                    self.chronicle.log({"type": "charm", "id": cid, "who": conn.get("name") or ""})
                self.save_soon()

        elif kind == "cellar":
            # the Root Cellar (R24): loam buys a rule
            cid = str(msg.get("id", ""))[:16]
            if eco.buy_cellar(cid):
                self.emit({"type": "cellar", "id": cid, "lv": eco.cellar_level(cid)})
                self.chronicle.log({"type": "cellar", "id": cid, "lv": eco.cellar_level(cid)})
                self.save()

        elif kind == "paint":
            # the Quilt (R22): one stitch per connection per cooldown, for a
            # second of the world's harvest — bots painting are welcome (P4)
            key = conn.get("addr") or "?"
            if now - self._paint_at.get(key, -1e9) < self.quilt.cooldown:
                return None
            raw_i, raw_c = msg.get("i"), msg.get("c")
            if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
                       for x in (raw_i, raw_c)):
                return None  # garbage is not a stitch (and never a crash)
            i, c = int(raw_i), int(raw_c)
            if self.quilt.paint(i, c):
                self._paint_at[key] = now
                if len(self._paint_at) > 5000:  # a flood of addresses: forget the cold ones
                    self._paint_at = {k: v for k, v in self._paint_at.items() if now - v < self.quilt.cooldown}
                eco.bank = max(0.0, eco.bank - eco.cps() * self.quilt.cost_seconds)
                self._pending.append({"type": "event", "ev": {"type": "paint", "i": i, "c": c,
                                                              "v": self.quilt.version}})
                self.chronicle.log({"type": "paint", "who": conn.get("name") or ""})
                self.save_soon()


def create_app() -> FastAPI:
    patch = Patch()
    app = FastAPI(title="Carrot Patch")
    app.state.patch = patch

    def ensure_loop() -> None:
        """Start the world tick loop. Called lazily from every entry point
        because mounted sub-apps never receive Starlette lifespan events —
        a plain `site.mount('/carrot-patch', create_app())` must still tick."""
        task = getattr(app.state, "loop_task", None)
        if task is None or task.done():
            app.state.loop_task = asyncio.create_task(patch.run())

    @app.on_event("startup")
    async def _start() -> None:  # fires when run standalone via uvicorn
        ensure_loop()

    @app.on_event("shutdown")
    async def _stop() -> None:
        task = getattr(app.state, "loop_task", None)
        if task:
            task.cancel()
        patch.save()

    @app.get("/")
    async def index() -> FileResponse:
        ensure_loop()
        return FileResponse(dist_dir() / "clicker.html")

    @app.get("/api/state")
    async def state() -> JSONResponse:
        ensure_loop()
        return JSONResponse({
            "state": patch.eco.snapshot(),
            "online": len(patch.clients),
            "cps": patch.eco.cps(),
        })

    @app.get("/api/board")
    async def board() -> JSONResponse:
        """Noticeboard tenders, top 10 by clicks (R11). Clients poll ~1/min."""
        ensure_loop()
        return JSONResponse({"tenders": patch.tenders.top(10),
                             "presence": patch.tenders.presence()})  # R21

    @app.get("/api/quilt")
    async def quilt() -> JSONResponse:
        """The whole quilt (R22): fetched on connect and whenever a client's
        version falls behind the snapshot's quiltV. Diffs ride as events."""
        ensure_loop()
        return JSONResponse(patch.quilt.snapshot())

    @app.get("/api/chronicle")
    async def chronicle(since: float = 0) -> JSONResponse:
        """The world's day-book, last 7 UTC days (R21): counts per event
        type and the notable events in order, plus the raw events since
        `since` (capped) for 'while you were away'. Clients fetch rarely."""
        ensure_loop()
        now = time.time()
        events = patch.chronicle.read(max(since, now - 7 * 86400))[-500:] if since else []
        return JSONResponse({"days": patch.chronicle.days(7), "events": events, "now": now})

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        ensure_loop()
        await ws.accept()
        patch.clients.add(ws)
        fwd = (ws.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        conn = {"last_click_msg": 0.0, "msg_times": [],
                "addr": fwd or (ws.client.host if ws.client else "")}
        patch._conns.append(conn)
        try:
            # the greeting must carry the live visitor too, or a reconnect
            # mid-visit makes the client walk it off and respawn it (review)
            await ws.send_text(json.dumps(patch.snapshot_msg(time.monotonic())))
            while True:
                raw = await ws.receive_text()
                if len(raw) > 512:
                    continue
                # flood guard: at most MAX_MSGS_PER_SEC messages per second
                now = time.monotonic()
                conn["msg_times"] = [t for t in conn["msg_times"] if now - t < 1.0]
                if len(conn["msg_times"]) >= MAX_MSGS_PER_SEC:
                    continue
                conn["msg_times"].append(now)
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict):
                    try:
                        reply = patch.handle(msg, conn)
                    except Exception:
                        # a bad intent must never kill the socket — but a real
                        # fault (save() I/O, sqlite) must never be invisible
                        traceback.print_exc()
                        continue
                    if reply:
                        await ws.send_text(json.dumps(reply))
        except WebSocketDisconnect:
            pass
        finally:
            patch.clients.discard(ws)
            if conn in patch._conns:
                patch._conns.remove(conn)

    return app


def __getattr__(name: str):
    """`uvicorn carrot_patch.main:app` still works, but importing this module for
    create_app() no longer eagerly builds a second world as a side effect."""
    if name == "app":
        return create_app()
    raise AttributeError(name)
