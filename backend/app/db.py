"""SQLite persistence.

We use SQLite rather than a "real" warehouse on purpose: the dataset is a
single month of national wind data (~1,500 actual half-hours and ~18,000
forecast vintages), it must run inside one small Docker container, and shipping
a pre-built file means the deployed demo never has to call Elexon on a cold
start. Swapping this module for Postgres later would not touch the analytics.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS actuals (
    start_time        TEXT NOT NULL,
    publish_time      TEXT,
    settlement_date   TEXT NOT NULL,
    settlement_period INTEGER,
    fuel_type         TEXT NOT NULL,
    generation_mw     REAL NOT NULL,
    PRIMARY KEY (start_time, fuel_type)
);

CREATE TABLE IF NOT EXISTS forecasts (
    start_time    TEXT NOT NULL,
    publish_time  TEXT NOT NULL,
    generation_mw REAL NOT NULL,
    PRIMARY KEY (start_time, publish_time)
);

CREATE INDEX IF NOT EXISTS idx_forecast_publish ON forecasts (publish_time);
CREATE INDEX IF NOT EXISTS idx_forecast_start   ON forecasts (start_time);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = Path(path or config.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def get_meta(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def count_actuals_for_date(conn: sqlite3.Connection, settlement_date: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM actuals WHERE settlement_date = ?", (settlement_date,)
    ).fetchone()
    return int(row["n"])


def count_forecasts_for_publish_date(conn: sqlite3.Connection, publish_date: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM forecasts WHERE substr(publish_time, 1, 10) = ?",
        (publish_date,),
    ).fetchone()
    return int(row["n"])


def insert_actuals(conn: sqlite3.Connection, rows: list[dict]) -> int:
    conn.executemany(
        "INSERT INTO actuals (start_time, publish_time, settlement_date, "
        "settlement_period, fuel_type, generation_mw) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(start_time, fuel_type) DO UPDATE SET "
        "publish_time = excluded.publish_time, generation_mw = excluded.generation_mw",
        rows,
    )
    conn.commit()
    return len(rows)


def insert_forecasts(conn: sqlite3.Connection, rows: list[tuple[str, str, float]]) -> int:
    conn.executemany(
        "INSERT INTO forecasts (start_time, publish_time, generation_mw) VALUES (?, ?, ?) "
        "ON CONFLICT(start_time, publish_time) DO UPDATE SET "
        "generation_mw = excluded.generation_mw",
        rows,
    )
    conn.commit()
    return len(rows)
