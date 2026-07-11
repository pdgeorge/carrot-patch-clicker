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
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .economy import Economy, dist_dir, fmt, load_data

MAX_CLICKS_PER_MSG = 40      # per connection per flush (~40 cps ceiling)
MIN_MSG_INTERVAL = 0.75      # seconds between click batches per connection
MAX_MSGS_PER_SEC = 10        # any message type, per connection
SNAPSHOT_INTERVAL = 1.0
SAVE_INTERVAL = 30.0


def state_file() -> Path:
    """World-state save location (CARROT_PATCH_STATE overrides, e.g. a volume)."""
    return Path(os.getenv("CARROT_PATCH_STATE",
                          Path(__file__).resolve().parent / "patch_state.json"))


class Patch:
    def __init__(self) -> None:
        self.eco = Economy(load_data())
        if state_file().exists():
            try:
                self.eco.deserialize(json.loads(state_file().read_text()))
            except (json.JSONDecodeError, OSError):
                pass  # corrupt or unreadable save: start a fresh garden
        self.clients: set[WebSocket] = set()
        self.click_window = 0          # clicks landed in the current snapshot window
        self.click_rate = 0            # last window's global clicks/sec, for display
        self.rabbit: dict | None = None
        self.next_rabbit = time.monotonic() + random.uniform(60, 150)
        self._pending: list[dict] = []  # extra events to broadcast with next snapshot

    # ---------- persistence ----------
    def save(self) -> None:
        target = state_file()
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.eco.serialize()))
        tmp.replace(target)

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

    # ---------- main loop ----------
    async def run(self) -> None:
        last = time.monotonic()
        last_save = last
        while True:
            await asyncio.sleep(SNAPSHOT_INTERVAL)
            now = time.monotonic()
            dt = now - last
            last = now

            events = self.eco.tick(dt)
            self._pending.extend(events)

            # golden rabbit lifecycle (global!)
            if self.rabbit and now > self.rabbit["until"]:
                self.rabbit = None
                self.next_rabbit = now + random.uniform(90, 240)
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
    def handle(self, msg: dict, conn: dict) -> None:
        kind = msg.get("type")
        eco = self.eco
        now = time.monotonic()

        if kind == "clicks":
            if now - conn["last_click_msg"] < MIN_MSG_INTERVAL:
                return  # too chatty; batch harder
            conn["last_click_msg"] = now
            n = max(0, min(int(msg.get("n", 0)), MAX_CLICKS_PER_MSG))
            if n:
                eco.do_clicks(n)
                self.click_window += n

        elif kind == "buy":
            b = msg.get("b")
            n = 10 if msg.get("n") == 10 else 1
            if isinstance(b, int) and 0 <= b < len(eco.owned):
                eco.buy(b, n)

        elif kind == "upgrade":
            uid = str(msg.get("id", ""))[:16]
            if eco.buy_upgrade(uid):
                u = next(u for u in eco.all_upgrades() if u["id"] == uid)
                self.announce(f"🛠 Someone bought {u['name']}!")

        elif kind == "catch":
            if self.rabbit and now <= self.rabbit["until"]:
                self.rabbit = None
                self.next_rabbit = now + random.uniform(90, 240)
                r = eco.rabbit_reward()
                self.announce(f"🐇 Caught by a gardener somewhere on Earth — {r['text']}")

        elif kind == "prestige":
            gained = eco.prestige()
            if gained:
                self.announce(
                    f"🌸 SOMEONE SENT THE WHOLE GARDEN TO SEED. +{fmt(gained)} seeds "
                    f"(+{gained * 8}% forever) for everyone. A new spring begins.")
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
                    patch.handle(msg, conn)
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
