"""The analytical core: "what did we know, and how wrong was it?"

Two ideas do all the work here.

1. **Decision-time reconstruction.** A forecast vintage is only usable if it had
   been published by the moment the desk had to commit. For delivery day D with
   a decision cutoff of D-1 12:00 UTC, every half-hour of D is matched to the
   *latest* vintage with ``publish_time <= cutoff``. This is what makes the
   historical data honest: no look-ahead, no picking the run that turned out
   best.

2. **Error as a quantity you can trade on.** Every comparison carries a lead
   time (delivery - publish), so accuracy can be reported as a function of how
   far ahead we were looking. That curve is the thing the desk actually needs:
   it converts "the forecast is imperfect" into "hold N MW of headroom".

Everything is plain Python over lists of dataclasses -- no pandas, no numpy --
so the whole analytical surface is readable in one sitting and trivially
unit-testable.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Iterable

from . import config, util

# Lead-time buckets, in hours. The day-ahead decision lands almost entirely in
# the 12-36h band, which is why those buckets are 12h wide and the tails are not.
LEAD_BUCKETS: list[tuple[float, float, str]] = [
    (0.0, 12.0, "0-12h (intraday)"),
    (12.0, 24.0, "12-24h (D-1 PM)"),
    (24.0, 36.0, "24-36h (D-1 AM)"),
    (36.0, 48.0, "36-48h (D-2)"),
    (48.0, 96.0, "48h+ (D-3)"),
]


@dataclass(frozen=True, slots=True)
class Vintage:
    publish_time: datetime
    generation_mw: float


class ForecastIndex:
    """In-memory index of the vintaged forecast set, keyed by delivery hour.

    For each delivery hour we keep the vintages sorted by publish time, so
    "what was the latest forecast available at T?" is a bisect rather than a
    scan. With ~18k rows this is instant, but the structure is the part worth
    explaining: it encodes the rule that *later publication wins*.
    """

    __slots__ = ("_by_start", "_publish_times")

    def __init__(self, rows: Iterable[tuple[datetime, datetime, float]]):
        by_start: dict[datetime, list[Vintage]] = defaultdict(list)
        for start_time, publish_time, generation_mw in rows:
            by_start[start_time].append(Vintage(publish_time, generation_mw))
        for start_time in by_start:
            by_start[start_time].sort(key=lambda v: v.publish_time)
        self._by_start = dict(by_start)
        self._publish_times = {
            start: [v.publish_time for v in vintages] for start, vintages in self._by_start.items()
        }

    def latest(self, start_time: datetime, cutoff: datetime) -> Vintage | None:
        """Newest vintage for ``start_time`` published at or before ``cutoff``."""
        vintages = self._by_start.get(start_time)
        if not vintages:
            return None
        times = self._publish_times[start_time]
        # bisect_right -> index of first publish_time > cutoff; step back one.
        lo, hi = 0, len(times)
        while lo < hi:
            mid = (lo + hi) // 2
            if times[mid] <= cutoff:
                lo = mid + 1
            else:
                hi = mid
        return vintages[lo - 1] if lo > 0 else None

    def vintages_for(self, start_time: datetime) -> list[Vintage]:
        return list(self._by_start.get(start_time, ()))

    def __len__(self) -> int:
        return len(self._by_start)


@dataclass(slots=True)
class Comparison:
    """One half-hour of delivery, forecast versus outturn."""

    start_time: datetime
    settlement_period: int
    forecast_mw: float | None
    forecast_publish_time: datetime | None
    actual_mw: float | None
    lead_hours: float | None
    cutoff: datetime

    @property
    def error_mw(self) -> float | None:
        """Signed error, forecast - actual. Positive means we over-bought."""
        if self.forecast_mw is None or self.actual_mw is None:
            return None
        return self.forecast_mw - self.actual_mw

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["start_time"] = util.iso(self.start_time)
        payload["cutoff"] = util.iso(self.cutoff)
        payload["forecast_publish_time"] = (
            util.iso(self.forecast_publish_time) if self.forecast_publish_time else None
        )
        payload["error_mw"] = None if self.error_mw is None else round(self.error_mw, 1)
        if self.lead_hours is not None:
            payload["lead_hours"] = round(self.lead_hours, 2)
        return payload


# --- Loading -----------------------------------------------------------------


def load_actuals(conn, start: date, end: date) -> dict[datetime, tuple[int, float]]:
    rows = conn.execute(
        "SELECT start_time, settlement_period, generation_mw FROM actuals "
        "WHERE start_time >= ? AND start_time < ? ORDER BY start_time",
        (util.iso(util.day_start(start)), util.iso(util.day_end(end))),
    ).fetchall()
    return {
        util.parse_ts(row["start_time"]): (row["settlement_period"], row["generation_mw"])
        for row in rows
    }


def load_forecasts(conn, start: date, end: date, max_cutoff: datetime) -> ForecastIndex:
    rows = conn.execute(
        "SELECT start_time, publish_time, generation_mw FROM forecasts "
        "WHERE start_time >= ? AND start_time < ? AND publish_time <= ?",
        (util.iso(util.day_start(start)), util.iso(util.day_end(end)), util.iso(max_cutoff)),
    ).fetchall()
    return ForecastIndex(
        (util.parse_ts(r["start_time"]), util.parse_ts(r["publish_time"]), r["generation_mw"])
        for r in rows
    )


def cutoff_for(delivery_day: date, cutoff_hour: int) -> datetime:
    """Decision deadline for a delivery day: ``cutoff_hour`` on the previous day."""
    return util.day_start(delivery_day - timedelta(days=1)) + timedelta(hours=cutoff_hour)


def build_comparisons(
    conn,
    start: date,
    end: date,
    cutoff_hour: int = config.DEFAULT_CUTOFF_HOUR,
) -> list[Comparison]:
    """Reconstruct, half-hour by half-hour, what the desk saw and what happened."""
    actuals = load_actuals(conn, start, end)
    # One query covers the range: the largest cutoff in the range is the last
    # day's, and per-day filtering then happens in memory.
    max_cutoff = cutoff_for(end, cutoff_hour)
    index = load_forecasts(conn, start, end, max_cutoff)

    comparisons: list[Comparison] = []
    for day in util.daterange(start, end):
        cutoff = cutoff_for(day, cutoff_hour)
        for period, start_time in enumerate(util.half_hour_starts(day), start=1):
            vintage = index.latest(util.floor_to_hour(start_time), cutoff)
            actual = actuals.get(start_time)
            lead = None
            if vintage is not None:
                lead = (start_time - vintage.publish_time).total_seconds() / 3600.0
            comparisons.append(
                Comparison(
                    start_time=start_time,
                    settlement_period=actual[0] if actual else period,
                    forecast_mw=vintage.generation_mw if vintage else None,
                    forecast_publish_time=vintage.publish_time if vintage else None,
                    actual_mw=actual[1] if actual else None,
                    lead_hours=lead,
                    cutoff=cutoff,
                )
            )
    return comparisons


# --- Statistics --------------------------------------------------------------


def percentile(values: list[float], q: float) -> float | None:
    """Linear-interpolated percentile. ``q`` in [0, 1]."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[int(position)]
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def summarise(pairs: list[tuple[float, float]]) -> dict:
    """Error metrics from (forecast, actual) pairs, MW throughout.

    We report nMAE (MAE as a % of mean outturn) rather than MAPE: national wind
    can sit near zero, and MAPE detonates there, which is exactly when you least
    want a number that says "9,000% error".
    """
    if not pairs:
        return {
            "n": 0,
            "mae_mw": None,
            "rmse_mw": None,
            "bias_mw": None,
            "bias_ratio": None,
            "nmae_pct": None,
            "mae_debiased_mw": None,
            "rmse_debiased_mw": None,
            "mae_improvement_pct": None,
            "mean_actual_mw": None,
            "mean_forecast_mw": None,
            "p90_abs_error_mw": None,
            "max_abs_error_mw": None,
            "p10_shortfall_mw": None,
            "p90_shortfall_mw": None,
        }

    errors = [f - a for f, a in pairs]
    abs_errors = [abs(e) for e in errors]
    n = len(pairs)
    mae = sum(abs_errors) / n
    rmse = math.sqrt(sum(e * e for e in errors) / n)
    bias = sum(errors) / n
    mean_actual = sum(a for _, a in pairs) / n
    mean_forecast = sum(f for f, _ in pairs) / n
    shortfalls = [a - f for f, a in pairs]

    # What the error would look like if you removed the average miss. This is
    # the value of simply de-biasing a series, and it is the single most
    # useful decomposition for the desk: random error vs. systematic error.
    centred = [e - bias for e in errors]
    mae_centred = sum(abs(e) for e in centred) / n
    rmse_centred = math.sqrt(sum(e * e for e in centred) / n)

    return {
        "n": n,
        "mae_mw": round(mae, 1),
        "rmse_mw": round(rmse, 1),
        "bias_mw": round(bias, 1),
        "bias_ratio": round(mean_forecast / mean_actual, 4) if mean_actual else None,
        "nmae_pct": round(mae / mean_actual * 100, 2) if mean_actual else None,
        "mae_debiased_mw": round(mae_centred, 1),
        "rmse_debiased_mw": round(rmse_centred, 1),
        "mae_improvement_pct": (
            round((mae - mae_centred) / mae * 100, 1) if mae else None
        ),
        "mean_actual_mw": round(mean_actual, 1),
        "mean_forecast_mw": round(mean_forecast, 1),
        "p90_abs_error_mw": round(percentile(abs_errors, 0.90) or 0, 1),
        "max_abs_error_mw": round(max(abs_errors), 1),
        "p10_shortfall_mw": round(percentile(shortfalls, 0.10) or 0, 1),
        "p90_shortfall_mw": round(percentile(shortfalls, 0.90) or 0, 1),
    }


def _pairs(comparisons: Iterable[Comparison]) -> list[tuple[float, float]]:
    return [
        (c.forecast_mw, c.actual_mw)
        for c in comparisons
        if c.forecast_mw is not None and c.actual_mw is not None
    ]


def by_lead_bucket(comparisons: list[Comparison]) -> list[dict]:
    """Accuracy as a function of how far ahead the forecast was made."""
    out = []
    for low, high, label in LEAD_BUCKETS:
        subset = [
            (c.forecast_mw, c.actual_mw)
            for c in comparisons
            if c.forecast_mw is not None
            and c.actual_mw is not None
            and c.lead_hours is not None
            and low <= c.lead_hours < high
        ]
        stats = summarise(subset)
        stats["bucket"] = label
        stats["lead_from_h"] = low
        stats["lead_to_h"] = high
        out.append(stats)
    return out


def by_day(comparisons: list[Comparison]) -> list[dict]:
    """Daily roll-up, including the energy view the desk books against."""
    grouped: dict[date, list[Comparison]] = defaultdict(list)
    for c in comparisons:
        grouped[c.start_time.date()].append(c)

    out = []
    for day in sorted(grouped):
        rows = grouped[day]
        pairs = _pairs(rows)
        stats = summarise(pairs)
        # Half-hourly MW averages -> MWh -> GWh. 0.5 h per settlement period.
        forecast_gwh = sum(f for f, _ in pairs) * 0.5 / 1000
        actual_gwh = sum(a for _, a in pairs) * 0.5 / 1000
        out.append(
            {
                "date": day.isoformat(),
                **stats,
                "forecast_gwh": round(forecast_gwh, 2),
                "actual_gwh": round(actual_gwh, 2),
                "energy_error_gwh": round(forecast_gwh - actual_gwh, 2),
                "coverage_pct": round(len(pairs) / len(rows) * 100, 1) if rows else 0.0,
            }
        )
    return out


def histogram(comparisons: list[Comparison], bins: int = 24) -> dict:
    """Error distribution, used to show whether misses are symmetric or skewed."""
    errors = [c.error_mw for c in comparisons if c.error_mw is not None]
    if not errors:
        return {"bins": [], "edge_mw": 0}

    limit = max(250.0, percentile([abs(e) for e in errors], 0.99) or 250.0)
    width = (2 * limit) / bins
    counts = [0] * bins
    for error in errors:
        index = int((error + limit) / width)
        counts[min(max(index, 0), bins - 1)] += 1

    return {
        "edge_mw": round(limit, 0),
        "bins": [
            {
                "from_mw": round(-limit + i * width, 0),
                "to_mw": round(-limit + (i + 1) * width, 0),
                "label": f"{round(-limit + i * width):+d}",
                "count": counts[i],
            }
            for i in range(bins)
        ],
    }


def day_ahead_window(cutoff_hour: int) -> tuple[float, float]:
    """Lead-time span a delivery day covers for a given gate-closure hour.

    A cutoff of 12:00 on D-1 means the 48 half-hours of D are bid 12h to 36h
    ahead. Move the cutoff and the window must move with it, otherwise the
    headroom is calibrated on leads the desk never actually had.
    """
    return 24.0 - cutoff_hour, 48.0 - cutoff_hour


def buffer_recommendation(comparisons: list[Comparison], cutoff_hour: int) -> dict:
    """Turn measured error into a number the desk can put in a bid.

    Two corrections, in order:

    1. **Bias.** The raw forecast is systematically high, so buying it means
       systematically over-committing. Subtract the mean error.
    2. **Headroom.** Even after de-biasing, actual outturn lands above the
       adjusted forecast some of the time. Hold the p90 of the *centred*
       shortfall so that 9 half-hours in 10 are covered.

    ``net_adjustment_mw`` is the single number to apply to the raw forecast
    before bidding. It is deliberately simple -- an empirical quantile, no
    distributional assumption -- and deliberately *ex post*: it is calibrated
    on realised January errors, which is the right first step for a pilot but
    would need a walk-forward protocol in production. The UI says so.
    """
    low, high = day_ahead_window(cutoff_hour)
    leads = [c for c in comparisons if c.lead_hours is not None and low <= c.lead_hours < high]
    pairs = _pairs(leads)
    stats = summarise(pairs)
    if not pairs:
        return {
            "lead_window": f"{low:g}-{high:g}h (day-ahead)",
            "n": 0,
            "bias_mw": None,
            "headroom_p90_mw": None,
            "net_adjustment_mw": None,
            "net_adjustment_pct": None,
            "cutoff_hour": cutoff_hour,
        }

    bias = stats["bias_mw"]
    # shortfall = actual - forecast; centred shortfall = shortfall + bias.
    centred_shortfalls = [(a - f) + bias for f, a in pairs]
    headroom_p90 = percentile(centred_shortfalls, 0.90) or 0.0
    net = headroom_p90 - bias
    mean_forecast = stats["mean_forecast_mw"] or 0.0

    return {
        "lead_window": f"{low:g}-{high:g}h (day-ahead)",
        "n": len(pairs),
        "bias_mw": round(bias, 0),
        "headroom_p90_mw": round(headroom_p90, 0),
        "net_adjustment_mw": round(net, 0),
        "net_adjustment_pct": round(net / mean_forecast * 100, 1) if mean_forecast else None,
        "raw_p90_shortfall_mw": stats["p90_shortfall_mw"],
        "mean_forecast_mw": mean_forecast,
        "cutoff_hour": cutoff_hour,
    }
