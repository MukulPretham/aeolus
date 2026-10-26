"""Build the local warehouse from Elexon.

Usage
-----
    python -m app.ingest            # incremental: skips days already stored
    python -m app.ingest --force    # re-download everything

The script is idempotent. Every response is upserted on its natural key, so a
half-finished run can simply be re-run, and revised outturn values (Elexon does
revise FUELHH) get overwritten rather than duplicated.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone

import httpx

from . import config, db, elexon, util

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
log = logging.getLogger("ingest")


def _actual_rows(payload: list[dict]) -> list[tuple]:
    rows = []
    for row in payload:
        rows.append(
            (
                util.iso(util.parse_ts(row["startTime"])),
                util.iso(util.parse_ts(row["publishTime"])) if row.get("publishTime") else None,
                row["settlementDate"],
                row.get("settlementPeriod"),
                row["fuelType"],
                float(row["generation"]),
            )
        )
    return rows


def _forecast_rows(payload: list[dict]) -> list[tuple[str, str, float]]:
    rows = []
    for row in payload:
        rows.append(
            (
                util.iso(util.parse_ts(row["startTime"])),
                util.iso(util.parse_ts(row["publishTime"])),
                float(row["generation"]),
            )
        )
    return rows


def ingest_actuals(conn, client: httpx.Client, force: bool) -> int:
    total = 0
    for day in util.daterange(config.PERIOD_START, config.PERIOD_END):
        key = day.isoformat()
        if not force and db.count_actuals_for_date(conn, key) > 0:
            log.info("actuals %s  skipped (cached)", key)
            continue
        payload = elexon.fetch_actuals_for_day(client, day)
        total += db.insert_actuals(conn, _actual_rows(payload))
        log.info("actuals %s  %3d half-hours", key, len(payload))
    return total


def ingest_forecasts(conn, client: httpx.Client, force: bool) -> int:
    total = 0
    for day in util.daterange(config.FORECAST_PUBLISH_START, config.FORECAST_PUBLISH_END):
        key = day.isoformat()
        if not force and db.count_forecasts_for_publish_date(conn, key) > 0:
            log.info("forecast %s skipped (cached)", key)
            continue
        payload = elexon.fetch_forecasts_for_publish_day(client, day)
        total += db.insert_forecasts(conn, _forecast_rows(payload))
        vintages = len({row["publishTime"] for row in payload})
        log.info("forecast %s %5d rows, %d vintages", key, len(payload), vintages)
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest Elexon wind actuals and forecasts.")
    parser.add_argument("--force", action="store_true", help="re-download days already stored")
    parser.add_argument("--db", default=str(config.DB_PATH), help="sqlite file to write")
    args = parser.parse_args(argv)

    conn = db.connect(args.db)
    db.init_schema(conn)

    started = datetime.now(timezone.utc)
    with httpx.Client(timeout=config.HTTP_TIMEOUT_SECONDS) as client:
        try:
            n_actuals = ingest_actuals(conn, client, args.force)
            n_forecasts = ingest_forecasts(conn, client, args.force)
        except elexon.ElexonError as exc:
            log.error("ingest aborted: %s", exc)
            return 1

    counts = conn.execute(
        "SELECT (SELECT COUNT(*) FROM actuals) AS a, (SELECT COUNT(*) FROM forecasts) AS f"
    ).fetchone()
    db.set_meta(conn, "ingested_at", util.iso(started))
    db.set_meta(conn, "actual_rows", str(counts["a"]))
    db.set_meta(conn, "forecast_rows", str(counts["f"]))
    conn.commit()

    log.info("done: +%d actuals, +%d forecast rows", n_actuals, n_forecasts)
    log.info("warehouse now holds %d actuals and %d forecast rows", counts["a"], counts["f"])

    # A quick integrity gate: the whole point of the app is that these are the
    # right months, so fail loudly if the range drifted.
    span = conn.execute(
        "SELECT MIN(start_time) a, MAX(start_time) b, "
        "MIN(publish_time) c, MAX(publish_time) d FROM forecasts"
    ).fetchone()
    log.info("forecast startTimes  %s .. %s", span["a"], span["b"])
    log.info("forecast publishTimes %s .. %s", span["c"], span["d"])

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
