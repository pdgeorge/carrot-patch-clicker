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
import os
import random
import time
import traceback
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .economy import Economy, dist_dir, fmt, load_data
from .tenders import TenderBook

MAX_CLICKS_PER_MSG = 1000    # anti-flood only, never game balance (DESIGN P4/R2):
                             # autoclickers are welcome (raised 250→1000, 2026-07)—
                             # this ceiling only stops forged clicks-you-never-made
                             # packets, not enthusiasm; the economy makes clicks fade
MIN_MSG_INTERVAL = 0.75      # seconds between click batches per connection
MAX_MSGS_PER_SEC = 10        # any message type, per connection
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
        self.clients: set[WebSocket] = set()
        self.click_window = 0          # clicks landed in the current snapshot window
        self.click_rate = 0            # last window's global clicks/sec, for display
        self.rabbit: dict | None = None
        self.next_rabbit = time.monotonic() + self.rabbit_wait(60, 150)
        self._pending: list[dict] = []  # extra events to broadcast with next snapshot
        if not self.eco.season_start:  # R17: the calendar starts the day it ships
            self.eco.season_start = time.time()

    def rabbit_wait(self, lo: float, hi: float) -> float:
        """Seconds until the next golden rabbit — Fair season doubles the visits."""
        rate = (self.eco.season_data() or {}).get("rabbitRate", 1)
        return random.uniform(lo, hi) / rate

    # ---------- persistence ----------
    def save(self) -> None:
        target = state_file()
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.eco.serialize()))
        tmp.replace(target)

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

            for ev in self.eco.tick(dt):
                self.emit(ev)

            # seasons rotate on real time (R17); the server owns the calendar
            period = self.eco.d.get("seasonDays", 14) * 86400.0
            wall = time.time()
            if self.eco.season_start and wall - self.eco.season_start >= period:
                steps = int((wall - self.eco.season_start) // period)
                seasons = self.eco.d.get("seasons", [])
                if seasons:
                    idx = next((i for i, s in enumerate(seasons)
                                if s["id"] == self.eco.season), 0)
                    self.eco.season = seasons[(idx + steps) % len(seasons)]["id"]
                    self.eco.season_start += steps * period
                    self.emit({"type": "season", "id": self.eco.season})
                    self.save()

            # golden rabbit lifecycle (global!)
            if self.rabbit and now > self.rabbit["until"]:
                self.rabbit = None
                self.next_rabbit = now + self.rabbit_wait(90, 240)
            if not self.rabbit and now >= self.next_rabbit:
                self.rabbit = {"id": random.randrange(1 << 30), "until": now + 12.0}
                self._pending.append({"type": "rabbit", "ttl": 12.0})

            self.click_rate = round(self.click_window / max(dt, 0.001))
            self.click_window = 0

            snap = {
                "type": "snapshot",
                "state": self.eco.snapshot(),
                "online": len(self.clients),
                "clickRate": self.click_rate,
                "rabbitTtl": max(0.0, self.rabbit["until"] - now) if self.rabbit else 0,
            }
            await self.broadcast(snap)
            for ev in self._pending:
                await self.broadcast(ev)
            self._pending = []

            if now - last_save > SAVE_INTERVAL:
                last_save = now
                self.save()

    # ---------- per-client messages ----------
    def handle(self, msg: dict, conn: dict) -> dict | None:
        """Apply one intent. May return a reply to send only to this client."""
        kind = msg.get("type")
        eco = self.eco
        now = time.monotonic()

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
            n = 10 if msg.get("n") == 10 else 1
            if isinstance(b, int) and not isinstance(b, bool) and 0 <= b < len(eco.owned):
                bought = eco.buy(b, n)
                if bought and conn.get("name"):
                    self.tenders.bump(conn["name"], buildings=bought)

        elif kind == "name":
            # sign the noticeboard (R11): recognition, never resources
            name = self.tenders.clean(msg.get("name", ""))
            if name:
                conn["name"] = name
                self.tenders.bump(name)  # appear on the board immediately
            return {"type": "name", "ok": name is not None, "name": name or ""}

        elif kind == "upgrade":
            uid = str(msg.get("id", ""))[:16]
            if eco.buy_upgrade(uid):
                self.emit({"type": "upgrade", "id": uid})

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
                self.save_soon()

        elif kind == "catch":
            if self.rabbit and now <= self.rabbit["until"]:
                self.rabbit = None
                self.next_rabbit = now + self.rabbit_wait(90, 240)
                r = eco.rabbit_reward()
                self.emit({"type": "rabbitCaught", "kind": r["kind"], "gain": r.get("gain", 0)})

        elif kind == "prestige":
            before = eco.seed_mult()
            gained = eco.prestige()
            if gained:
                # boost = the world's actual seed-bonus change; the old
                # "+8N% forever" copy overstated it by orders of magnitude
                self.emit({"type": "prestige", "gained": gained,
                           "boost": eco.seed_mult() / before})
                self.save()


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
        return JSONResponse({"tenders": patch.tenders.top(10)})

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        ensure_loop()
        await ws.accept()
        patch.clients.add(ws)
        conn = {"last_click_msg": 0.0, "msg_times": []}
        try:
            await ws.send_text(json.dumps({
                "type": "snapshot", "state": patch.eco.snapshot(),
                "online": len(patch.clients), "clickRate": patch.click_rate,
                "rabbitTtl": 0,
            }))
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

    return app


def __getattr__(name: str):
    """`uvicorn carrot_patch.main:app` still works, but importing this module for
    create_app() no longer eagerly builds a second world as a side effect."""
    if name == "app":
        return create_app()
    raise AttributeError(name)
