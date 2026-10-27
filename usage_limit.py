"""Small rolling-window usage limiter (per browser + per IP), stored in SQLite.

Used to cap how many PDFs a visitor can create per day and how many AI requests
they can make, so a public deployment can't be drained by one person.

A "day" here is a rolling 24 hours: once a visitor's oldest use is 24 h old, it
stops counting. Counts survive server restarts (SQLite file).
"""
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

WINDOW_SECONDS = 24 * 60 * 60
_DEFAULT_DB = Path(__file__).with_name("usage.db")


@dataclass
class Result:
    ok: bool
    used: int          # uses inside the window (including this one if ok)
    limit: int
    reset_in: int      # seconds until one more use becomes available (0 if not blocked)
    row_id: int = 0
    scope: str = "client"   # which limit blocked the request: "client" or "ip"

    @property
    def remaining(self):
        return max(0, self.limit - self.used)

    def public(self):
        return {"used": self.used, "limit": self.limit, "remaining": self.remaining, "reset_in": self.reset_in}


class UsageLimiter:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("USAGE_DB") or _DEFAULT_DB)
        self._lock = threading.Lock()
        with self._connect() as con:
            con.execute(
                "CREATE TABLE IF NOT EXISTS usage ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, "
                "client TEXT NOT NULL, ip TEXT NOT NULL, ts INTEGER NOT NULL)"
            )
            con.execute("CREATE INDEX IF NOT EXISTS usage_client ON usage (kind, client, ts)")
            con.execute("CREATE INDEX IF NOT EXISTS usage_ip ON usage (kind, ip, ts)")

    def _connect(self):
        con = sqlite3.connect(self.path, timeout=10, isolation_level=None)  # autocommit; we BEGIN manually
        return con

    # ------------------------------------------------------------------ queries
    @staticmethod
    def _reset_in(stamps, limit, now):
        """Seconds until the count drops below `limit` (stamps sorted ascending)."""
        if len(stamps) < limit:
            return 0
        pivot = stamps[len(stamps) - limit]          # the use that must expire first
        return max(1, pivot + WINDOW_SECONDS - now)

    def peek(self, kind, client, ip, limit, ip_limit, now=None):
        """Current standing, without using anything up."""
        now = int(now if now is not None else time.time())
        cutoff = now - WINDOW_SECONDS
        with self._connect() as con:
            mine = [r[0] for r in con.execute(
                "SELECT ts FROM usage WHERE kind=? AND client=? AND ts>? ORDER BY ts", (kind, client, cutoff))]
            theirs = [r[0] for r in con.execute(
                "SELECT ts FROM usage WHERE kind=? AND ip=? AND ts>? ORDER BY ts", (kind, ip, cutoff))]
        blocked_ip = len(theirs) >= ip_limit
        reset = max(self._reset_in(mine, limit, now), self._reset_in(theirs, ip_limit, now))
        used = max(len(mine), limit if blocked_ip else 0)
        return Result(ok=not (len(mine) >= limit or blocked_ip), used=min(used, limit) if blocked_ip else len(mine),
                      limit=limit, reset_in=reset, scope="ip" if blocked_ip else "client")

    def reserve(self, kind, client, ip, limit, ip_limit, now=None):
        """Atomically check the limits and, if allowed, record one use."""
        now = int(now if now is not None else time.time())
        cutoff = now - WINDOW_SECONDS
        with self._lock, self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            try:
                con.execute("DELETE FROM usage WHERE ts < ?", (now - 2 * WINDOW_SECONDS,))   # housekeeping
                mine = [r[0] for r in con.execute(
                    "SELECT ts FROM usage WHERE kind=? AND client=? AND ts>? ORDER BY ts", (kind, client, cutoff))]
                theirs = [r[0] for r in con.execute(
                    "SELECT ts FROM usage WHERE kind=? AND ip=? AND ts>? ORDER BY ts", (kind, ip, cutoff))]
                if len(mine) >= limit:
                    con.execute("ROLLBACK")
                    return Result(False, len(mine), limit, self._reset_in(mine, limit, now), scope="client")
                if len(theirs) >= ip_limit:   # shared-network safety net, much higher than the personal limit
                    con.execute("ROLLBACK")
                    return Result(False, limit, limit, self._reset_in(theirs, ip_limit, now), scope="ip")
                cur = con.execute("INSERT INTO usage (kind, client, ip, ts) VALUES (?,?,?,?)", (kind, client, ip, now))
                row_id = cur.lastrowid
                con.execute("COMMIT")
                return Result(True, len(mine) + 1, limit, 0, row_id=row_id)
            except Exception:
                con.execute("ROLLBACK")
                raise

    def refund(self, row_id):
        """Give a use back (e.g. the PDF/AI call failed through no fault of the visitor)."""
        if row_id:
            with self._lock, self._connect() as con:
                con.execute("DELETE FROM usage WHERE id=?", (row_id,))
