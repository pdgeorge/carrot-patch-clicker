"""Tender registry — persistent per-player recognition (DESIGN R11).

Recognition, never resources (P1): a name and its tallies have zero
gameplay effect. Lives in SQLite rather than the world-state JSON so an
unbounded stream of one-click visitors can't bloat or endanger the
30-second atomic world save. Seeds are deliberately never tracked here —
going to seed stays anonymous.
"""
from __future__ import annotations

import sqlite3
import time
from datetime import date, timedelta
from pathlib import Path

NAME_MIN = 2
NAME_MAX = 20
LEGACY_DAY = "2026-07-17"   # the rebuild: anyone on the board before R21 was here before it
HANDS_MAX = 50              # presence board: names listed per day (the count is always exact)


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
        # presence (R21): a board a bot cannot own — first planting, last day
        # seen, and the longest run of consecutive days. Migrates old dbs.
        cols = {r[1] for r in self.db.execute("PRAGMA table_info(tenders)")}
        for col, decl in (("first_seen", "TEXT"), ("last_day", "TEXT"),
                          ("streak", "INTEGER NOT NULL DEFAULT 0"),
                          ("best_streak", "INTEGER NOT NULL DEFAULT 0")):
            if col not in cols:
                self.db.execute(f"ALTER TABLE tenders ADD COLUMN {col} {decl}")
        # tenders who signed before the presence columns existed were here
        # first by definition: date them before R21, or the restart day
        # would make founders of whoever reconnected first (review R21)
        self.db.execute("UPDATE tenders SET first_seen = ? WHERE first_seen IS NULL", (LEGACY_DAY,))
        self.db.execute("CREATE INDEX IF NOT EXISTS tenders_last_day ON tenders(last_day)")
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

    def bump(self, name: str, clicks: int = 0, buildings: int = 0, today: str | None = None) -> None:
        today = today or time.strftime("%Y-%m-%d", time.gmtime())
        self.db.execute(
            "INSERT INTO tenders(name, clicks, buildings, first_seen, last_day, streak, best_streak) "
            "VALUES(?, ?, ?, ?, ?, 1, 1) "
            "ON CONFLICT(name) DO UPDATE SET"
            "  clicks = clicks + excluded.clicks,"
            "  buildings = buildings + excluded.buildings,"
            "  first_seen = COALESCE(first_seen, excluded.first_seen)",
            (name, clicks, buildings, today, today))
        # streak bookkeeping: consecutive UTC days with at least one intent
        row = self.db.execute("SELECT last_day, streak, best_streak FROM tenders WHERE name = ?",
                              (name,)).fetchone()
        last, streak, best = row[0], row[1] or 0, row[2] or 0
        if last != today:
            yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
            streak = streak + 1 if last == yesterday else 1
            best = max(best, streak)
            self.db.execute("UPDATE tenders SET last_day = ?, streak = ?, best_streak = ? WHERE name = ?",
                            (today, streak, best, name))
        self.db.commit()

    def presence(self, today: str | None = None) -> dict:
        """The board a bot cannot own (R21): who was here today (unordered),
        the longest tending streaks (names ≥ 7 days old), and the founders.
        A sybil account gains one presence-day each — nothing to farm."""
        today = today or time.strftime("%Y-%m-%d", time.gmtime())
        yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
        week_ago = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
        count = self.db.execute("SELECT COUNT(*) FROM tenders WHERE last_day = ?", (today,)).fetchone()[0]
        hands = [r[0] for r in self.db.execute(
            "SELECT name FROM tenders WHERE last_day = ? ORDER BY clicks DESC, name LIMIT ?", (today, HANDS_MAX))]
        # a streak is LIVE only if it reached yesterday or today; a run that
        # ended last month is a best, not "days running" (review R21)
        streaks = [{"name": r[0], "streak": r[1], "best": r[2]} for r in self.db.execute(
            "SELECT name, CASE WHEN last_day >= ? THEN streak ELSE 0 END AS live, best_streak "
            "FROM tenders WHERE first_seen <= ? ORDER BY live DESC, best_streak DESC, clicks DESC, name LIMIT 5",
            (yesterday, week_ago))]
        founders = [{"name": r[0], "since": r[1]} for r in self.db.execute(
            "SELECT name, first_seen FROM tenders WHERE first_seen IS NOT NULL "
            "ORDER BY first_seen, clicks DESC, name LIMIT 5")]
        return {"hands_today": hands, "hands_count": count, "streaks": streaks, "founders": founders}

    def names_active(self, days: int = 7) -> int:
        """Distinct names seen in the last N days — Many Hands' second term."""
        since = time.strftime("%Y-%m-%d", time.gmtime(time.time() - days * 86400))
        return self.db.execute("SELECT COUNT(*) FROM tenders WHERE last_day >= ?", (since,)).fetchone()[0]

    def top(self, n: int = 10) -> list[dict]:
        rows = self.db.execute(
            "SELECT name, clicks, buildings FROM tenders "
            "ORDER BY clicks DESC, name LIMIT ?", (n,))
        return [{"name": r[0], "clicks": r[1], "buildings": r[2]} for r in rows]
