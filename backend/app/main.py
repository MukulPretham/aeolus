"""FastAPI application: the JSON surface the React portal consumes.

Design choices worth defending in review:

* Every endpoint is a **pure function of (date range, cutoff hour)** and is
  cached with ``lru_cache``. The underlying data is a static month, so the
  analytical answer for a given question never changes; caching turns repeated
  dashboard loads into sub-millisecond dict lookups.
* No ORM. The queries are three lines of SQL against a 2 MB SQLite file.
* The API is versioned under ``/api`` and the built frontend is served from the
  same origin, so there is no CORS surface in production and one container is
  the whole deployment.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import analytics, config, db, util

app = FastAPI(
    title="Aeolus API",
    version="1.0.0",
    description=(
        "Day-ahead wind generation intelligence for the GB market: reconstructs the "
        "forecast a trading desk could actually have seen at gate closure, and measures "
        "how wrong it was."
    ),
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# --- Helpers -----------------------------------------------------------------


def _connect() -> sqlite3.Connection:
    return db.connect()


def _parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD") from exc


def _energy_gwh(comparisons: list[analytics.Comparison], attr: str) -> float:
    values = [getattr(c, attr) for c in comparisons if getattr(c, attr) is not None]
    return round(sum(values) * 0.5 / 1000, 2)  # half-hourly MW -> MWh -> GWh


# --- Cached computations -----------------------------------------------------


@lru_cache(maxsize=32)
def _decision(start_iso: str, end_iso: str, cutoff_hour: int) -> dict:
    start, end = date.fromisoformat(start_iso), date.fromisoformat(end_iso)
    conn = _connect()
    try:
        comparisons = analytics.build_comparisons(conn, start, end, cutoff_hour)
        overall = analytics.summarise(
            [(c.forecast_mw, c.actual_mw) for c in comparisons
             if c.forecast_mw is not None and c.actual_mw is not None]
        )
        return {
            "comparisons": comparisons,
            "overall": overall,
            "buffer": _calibration(cutoff_hour),
        }
    finally:
        conn.close()


@lru_cache(maxsize=32)
def _accuracy(start_iso: str, end_iso: str, cutoff_hour: int) -> dict:
    start, end = date.fromisoformat(start_iso), date.fromisoformat(end_iso)
    conn = _connect()
    try:
        comparisons = analytics.build_comparisons(conn, start, end, cutoff_hour)
    finally:
        conn.close()

    pairs = [
        (c.forecast_mw, c.actual_mw)
        for c in comparisons
        if c.forecast_mw is not None and c.actual_mw is not None
    ]
    daily = analytics.by_day(comparisons)
    ranked = sorted(
        [d for d in daily if d["mae_mw"] is not None], key=lambda d: d["mae_mw"], reverse=True
    )
    return {
        "start": start_iso,
        "end": end_iso,
        "cutoff_hour": cutoff_hour,
        "overall": analytics.summarise(pairs),
        "by_lead_bucket": analytics.by_lead_bucket(comparisons),
        "by_day": daily,
        "histogram": analytics.histogram(comparisons),
        "buffer": analytics.buffer_recommendation(comparisons, cutoff_hour),
        "worst_days": ranked[:5],
        "best_days": ranked[-5:][::-1],
        "energy": {
            "forecast_gwh": _energy_gwh(comparisons, "forecast_mw"),
            "actual_gwh": _energy_gwh(comparisons, "actual_mw"),
        },
        "coverage": {
            "half_hours": len(comparisons),
            "with_forecast": sum(1 for c in comparisons if c.forecast_mw is not None),
            "with_actual": sum(1 for c in comparisons if c.actual_mw is not None),
            "scored": len(pairs),
        },
    }


@lru_cache(maxsize=8)
def _calibration(cutoff_hour: int) -> dict:
    """Procurement headroom, calibrated on the whole stored month.

    Calibrating on a single delivery day would give a noisy quantile (48
    points); the bias and the tail are properties of the forecast *system*, so
    they are estimated on everything we hold. This is an ex-post calibration
    and the UI labels it as such.
    """
    conn = _connect()
    try:
        comparisons = analytics.build_comparisons(
            conn, config.PERIOD_START, config.PERIOD_END, cutoff_hour
        )
    finally:
        conn.close()
    payload = analytics.buffer_recommendation(comparisons, cutoff_hour)
    payload["calibration_period"] = {
        "start": config.PERIOD_START.isoformat(),
        "end": config.PERIOD_END.isoformat(),
    }
    payload["method"] = "ex_post"
    return payload


# --- Routes ------------------------------------------------------------------


@app.get("/api/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "time": util.iso(datetime.now(tz=timezone.utc))}


@app.get("/api/meta", tags=["read"])
def meta() -> dict:
    """What data do we actually hold? Drives the UI's date pickers and badges."""
    conn = _connect()
    try:
        actual = conn.execute(
            "SELECT COUNT(*) n, MIN(start_time) first, MAX(start_time) last FROM actuals"
        ).fetchone()
        forecast = conn.execute(
            "SELECT COUNT(*) n, MIN(publish_time) first, MAX(publish_time) last, "
            "COUNT(DISTINCT publish_time) vintages FROM forecasts"
        ).fetchone()
        dates = [
            r["settlement_date"]
            for r in conn.execute(
                "SELECT DISTINCT settlement_date FROM actuals ORDER BY settlement_date"
            ).fetchall()
        ]
        ingested_at = db.get_meta(conn, "ingested_at")
    finally:
        conn.close()

    return {
        "product": "Aeolus",
        "period": {"start": config.PERIOD_START.isoformat(), "end": config.PERIOD_END.isoformat()},
        "delivery_dates": dates,
        "default_cutoff_hour": config.DEFAULT_CUTOFF_HOUR,
        "data": {
            "actuals": {
                "rows": actual["n"],
                "first": actual["first"],
                "last": actual["last"],
            },
            "forecasts": {
                "rows": forecast["n"],
                "vintages": forecast["vintages"],
                "first_publish": forecast["first"],
                "last_publish": forecast["last"],
            },
            "ingested_at": ingested_at,
        },
        "source": {
            "actuals": f"{config.ELEXON_BASE_URL}/datasets/{config.ACTUALS_DATASET}/stream",
            "forecasts": f"{config.ELEXON_BASE_URL}/datasets/{config.FORECASTS_DATASET}/stream",
            "licence": "Elexon BMRS open data",
        },
        "assumptions": [
            "WINDFOR values are treated as MW; upstream documentation does not state units.",
            "Hourly WINDFOR values are compared with the mean of the two half-hours they span.",
            "Delivery times are UTC; January is GMT so no clock change applies.",
        ],
    }


@app.get("/api/decision", tags=["read"])
def decision(
    delivery_date: str = Query(..., description="YYYY-MM-DD, the delivery day"),
    cutoff_hour: int = Query(config.DEFAULT_CUTOFF_HOUR, ge=0, le=23),
) -> dict:
    """What the desk would have seen for one delivery day, and how it turned out."""
    day = _parse_date(delivery_date, "delivery_date")
    payload = _decision(day.isoformat(), day.isoformat(), cutoff_hour)
    comparisons: list[analytics.Comparison] = payload["comparisons"]

    if not any(c.actual_mw is not None for c in comparisons):
        raise HTTPException(status_code=404, detail=f"No actuals stored for {delivery_date}")

    rows = [c.to_dict() for c in comparisons]
    vintage_counts: dict[str, int] = {}
    for c in comparisons:
        if c.forecast_publish_time:
            key = util.iso(c.forecast_publish_time)
            vintage_counts[key] = vintage_counts.get(key, 0) + 1

    dominant = (
        max(vintage_counts.items(), key=lambda kv: kv[1])[0] if vintage_counts else None
    )
    summary = payload["overall"]
    forecast_gwh = _energy_gwh(comparisons, "forecast_mw")
    actual_gwh = _energy_gwh(comparisons, "actual_mw")

    return {
        "delivery_date": day.isoformat(),
        "cutoff": util.iso(analytics.cutoff_for(day, cutoff_hour)),
        "cutoff_hour": cutoff_hour,
        "status": "published" if dominant else "no_forecast",
        "dominant_vintage": dominant,
        "vintages_used": [
            {"publish_time": k, "half_hours": v}
            for k, v in sorted(vintage_counts.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "rows": rows,
        "summary": summary,
        "energy": {
            "forecast_gwh": forecast_gwh,
            "actual_gwh": actual_gwh,
            "delta_gwh": round(forecast_gwh - actual_gwh, 2),
            "buffer_p90_mw": payload["buffer"]["net_adjustment_mw"],
            # Procurement view: forecast energy plus the calibrated headroom.
            "recommended_gwh_p90": round(
                (sum(c.forecast_mw for c in comparisons if c.forecast_mw is not None) * 0.5
                 + payload["buffer"]["net_adjustment_mw"] * 24) / 1000,
                2,
            ),
        },
        "buffer": payload["buffer"],
    }


@app.get("/api/accuracy", tags=["read"])
def accuracy(
    start: str = Query(config.PERIOD_START.isoformat(), description="YYYY-MM-DD"),
    end: str = Query(config.PERIOD_END.isoformat(), description="YYYY-MM-DD"),
    cutoff_hour: int = Query(config.DEFAULT_CUTOFF_HOUR, ge=0, le=23),
) -> dict:
    """Quantified forecast error over a delivery window."""
    start_day, end_day = _parse_date(start, "start"), _parse_date(end, "end")
    if end_day < start_day:
        raise HTTPException(status_code=422, detail="end must be on or after start")
    if (end_day - start_day).days > 62:
        raise HTTPException(status_code=422, detail="range is limited to 62 days")
    return _accuracy(start_day.isoformat(), end_day.isoformat(), cutoff_hour)


@app.get("/api/vintages", tags=["read"])
def vintages(
    delivery_date: str = Query(..., description="YYYY-MM-DD"),
    cutoff_hour: int = Query(config.DEFAULT_CUTOFF_HOUR, ge=0, le=23),
) -> dict:
    """Every forecast run that covered this delivery day, and whether it was usable."""
    day = _parse_date(delivery_date, "delivery_date")
    cutoff = analytics.cutoff_for(day, cutoff_hour)

    conn = _connect()
    try:
        # A vintage covers this day if it has at least one point inside it.
        rows = conn.execute(
            "SELECT publish_time, COUNT(*) n, MIN(start_time) first_start, "
            "MAX(start_time) last_start, AVG(generation_mw) mean_mw "
            "FROM forecasts WHERE start_time >= ? AND start_time < ? "
            "GROUP BY publish_time ORDER BY publish_time",
            (util.iso(util.day_start(day)), util.iso(util.day_end(day))),
        ).fetchall()
    finally:
        conn.close()

    runs = [
        {
            "publish_time": row["publish_time"],
            "hours_covered": row["n"],
            "first_start": row["first_start"],
            "last_start": row["last_start"],
            "mean_mw": round(row["mean_mw"], 0),
            "hours_before_cutoff": round(
                (cutoff - util.parse_ts(row["publish_time"])).total_seconds() / 3600, 1
            ),
            "available": util.parse_ts(row["publish_time"]) <= cutoff,
        }
        for row in rows
    ]
    return {
        "delivery_date": day.isoformat(),
        "cutoff": util.iso(cutoff),
        "cutoff_hour": cutoff_hour,
        "runs": runs,
        "selected": next((r["publish_time"] for r in reversed(runs) if r["available"]), None),
    }


# --- Static frontend (production image) --------------------------------------

if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="ui")
else:

    @app.get("/", include_in_schema=False)
    def dev_root() -> JSONResponse:
        return JSONResponse(
            {
                "service": "Aeolus API",
                "docs": "/docs",
                "note": "Frontend bundle not built; run the Vite dev server on :5173.",
            }
        )
