"""Unit tests for the analytical core.

These are deliberately dependency-free: no fixtures beyond a throwaway SQLite
file, no network. The point is that the two rules the product's credibility
rests on -- "latest vintage before cutoff" and "error metrics from paired
values" -- are pinned by tests rather than by vibes.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app import analytics, db, util


def utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


# --- ForecastIndex -----------------------------------------------------------


def test_latest_vintage_is_the_newest_one_before_the_cutoff():
    index = analytics.ForecastIndex(
        [
            (utc(2026, 1, 2, 12), utc(2025, 12, 31, 2, 30), 1000.0),
            (utc(2026, 1, 2, 12), utc(2025, 12, 31, 11, 30), 1200.0),
            (utc(2026, 1, 2, 12), utc(2026, 1, 1, 15, 30), 1400.0),  # after the cutoff
        ]
    )
    vintage = index.latest(utc(2026, 1, 2, 12), utc(2026, 1, 1, 12))
    assert vintage is not None
    assert vintage.generation_mw == 1200.0


def test_a_run_published_exactly_at_the_cutoff_is_usable():
    index = analytics.ForecastIndex([(utc(2026, 1, 2, 0), utc(2026, 1, 1, 12), 900.0)])
    assert index.latest(utc(2026, 1, 2, 0), utc(2026, 1, 1, 12)) is not None


def test_a_run_published_after_the_cutoff_is_invisible():
    index = analytics.ForecastIndex([(utc(2026, 1, 2, 0), utc(2026, 1, 1, 12, 25), 900.0)])
    assert index.latest(utc(2026, 1, 2, 0), utc(2026, 1, 1, 12)) is None


def test_unknown_delivery_hour_returns_none():
    index = analytics.ForecastIndex([(utc(2026, 1, 2, 0), utc(2026, 1, 1, 2), 900.0)])
    assert index.latest(utc(2026, 1, 5, 0), utc(2026, 1, 1, 12)) is None


# --- Statistics --------------------------------------------------------------


def test_percentile_uses_linear_interpolation():
    assert analytics.percentile([1, 2, 3, 4], 0.5) == pytest.approx(2.5)
    assert analytics.percentile([1, 2, 3, 4], 0.0) == 1
    assert analytics.percentile([1, 2, 3, 4], 1.0) == 4
    assert analytics.percentile([], 0.5) is None


def test_summarise_decomposes_bias_from_random_error():
    # Every forecast is 100 MW high: all error is systematic.
    stats = analytics.summarise([(1100.0, 1000.0), (1200.0, 1100.0)])
    assert stats["n"] == 2
    assert stats["mae_mw"] == pytest.approx(100.0)
    assert stats["bias_mw"] == pytest.approx(100.0)
    assert stats["rmse_mw"] == pytest.approx(100.0)
    assert stats["nmae_pct"] == pytest.approx(9.52, abs=0.01)
    assert stats["mae_debiased_mw"] == pytest.approx(0.0, abs=1e-6)
    assert stats["mae_improvement_pct"] == pytest.approx(100.0)


def test_summarise_handles_empty_input():
    stats = analytics.summarise([])
    assert stats["n"] == 0
    assert stats["mae_mw"] is None


def test_day_ahead_window_follows_the_cutoff():
    assert analytics.day_ahead_window(12) == (12.0, 36.0)
    assert analytics.day_ahead_window(18) == (6.0, 30.0)
    assert analytics.day_ahead_window(0) == (24.0, 48.0)


# --- Deterministic reconstruction against a tiny warehouse -------------------


@pytest.fixture()
def conn(tmp_path):
    connection = db.connect(tmp_path / "test.db")
    db.init_schema(connection)
    yield connection
    connection.close()


def seed(conn, actual_mw: float = 1000.0) -> None:
    """48 half-hours of outturn plus two vintages, one either side of the cutoff."""
    for start in util.half_hour_starts(date(2026, 1, 2)):
        db.insert_actuals(
            conn,
            [
                (
                    util.iso(start),
                    util.iso(start),
                    "2026-01-02",
                    (start.hour * 2 + (1 if start.minute else 0)) + 1,
                    "WIND",
                    actual_mw,
                )
            ],
        )
    rows = []
    for hour in range(24):
        start = utc(2026, 1, 2, hour)
        rows.append((util.iso(start), util.iso(utc(2026, 1, 1, 11, 30)), 900.0))  # before cutoff
        rows.append((util.iso(start), util.iso(utc(2026, 1, 1, 15, 30)), 5000.0))  # after cutoff
    db.insert_forecasts(conn, rows)


def test_comparisons_use_the_vintage_available_at_gate_closure(conn):
    seed(conn)
    rows = analytics.build_comparisons(conn, date(2026, 1, 2), date(2026, 1, 2), cutoff_hour=12)

    assert len(rows) == 48
    assert all(row.forecast_mw == 900.0 for row in rows), "the post-cutoff run must never be used"
    assert all(row.error_mw == pytest.approx(-100.0) for row in rows)
    # 00:00 delivery against an 11:30 previous-day publish is a 12.5h lead.
    assert rows[0].lead_hours == pytest.approx(12.5)


def test_second_half_hour_reuses_the_hourly_forecast(conn):
    seed(conn)
    rows = analytics.build_comparisons(conn, date(2026, 1, 2), date(2026, 1, 2), cutoff_hour=12)
    first, second = rows[0], rows[1]
    assert first.start_time.minute == 0
    assert second.start_time.minute == 30
    assert first.forecast_publish_time == second.forecast_publish_time


def test_missing_actuals_are_reported_not_invented(conn):
    seed(conn)
    conn.execute("DELETE FROM actuals WHERE start_time = ?", (util.iso(utc(2026, 1, 2, 0)),))
    conn.commit()
    rows = analytics.build_comparisons(conn, date(2026, 1, 2), date(2026, 1, 2), cutoff_hour=12)
    missing = next(row for row in rows if row.start_time == utc(2026, 1, 2, 0))
    assert missing.actual_mw is None
    assert missing.error_mw is None
    assert analytics.summarise(analytics._pairs(rows))["n"] == 47


def test_lead_buckets_partition_the_day(conn):
    seed(conn)
    rows = analytics.build_comparisons(conn, date(2026, 1, 2), date(2026, 1, 2), cutoff_hour=12)
    buckets = analytics.by_lead_bucket(rows)
    assert sum(bucket["n"] for bucket in buckets) == 48
    assert any(bucket["n"] > 0 for bucket in buckets)
