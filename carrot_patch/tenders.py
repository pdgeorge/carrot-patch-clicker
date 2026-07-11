"""Tender registry — persistent per-player recognition (DESIGN R11).

Recognition, never resources (P1): a name and its tallies have zero
gameplay effect. Lives in SQLite rather than the world-state JSON so an
unbounded stream of one-click visitors can't bloat or endanger the
30-second atomic world save. Seeds are deliberately never tracked here —
going to seed stays anonymous.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

NAME_MIN = 2
NAME_MAX = 20


class TenderBook:
    def __init__(self, db_path: Path, blocklist_path: Path):
        # check_same_thread=False: all access is serialized through the
        # server's single event loop; the flag only matters for TestClient,
        # which drives the app from a different thread than construction
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS tenders ("
            "  name TEXT PRIMARY KEY,"
            "  clicks INTEGER NOT NULL DEFAULT 0,"
            "  buildings INTEGER NOT NULL DEFAULT 0)")
        self.db.commit()
        try:
            lines = blocklist_path.read_text(encoding="utf-8").splitlines()
            self.blocked = [w.strip().casefold() for w in lines
                            if w.strip() and not w.startswith("#")]
        except OSError:
            self.blocked = []

    def clean(self, raw: object) -> str | None:
        """Validated display name, or None if it won't fit on the board.
        Basic contains-check against the blocklist — crude by design;
        shiitake casualties accepted (DESIGN R11)."""
        name = " ".join(str(raw).split())[:NAME_MAX]
        if len(name) < NAME_MIN or not name.isprintable():
            return None
        low = name.casefold()
        if any(w in low for w in self.blocked):
            return None
        return name

    def bump(self, name: str, clicks: int = 0, buildings: int = 0) -> None:
        self.db.execute(
            "INSERT INTO tenders(name, clicks, buildings) VALUES(?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET"
            "  clicks = clicks + excluded.clicks,"
            "  buildings = buildings + excluded.buildings",
            (name, clicks, buildings))
        self.db.commit()

    def top(self, n: int = 10) -> list[dict]:
        rows = self.db.execute(
            "SELECT name, clicks, buildings FROM tenders "
            "ORDER BY clicks DESC, name LIMIT ?", (n,))
        return [{"name": r[0], "clicks": r[1], "buildings": r[2]} for r in rows]
