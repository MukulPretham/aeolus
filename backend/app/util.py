"""Small time helpers.

The whole product is deliberately UTC-internal: Elexon publishes in UTC, the
delivery period we model (January) sits entirely in GMT, so there is no
clock-change ambiguity to trap us. Formatting to a human timezone happens in
the browser, never here.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

HALF_HOUR = timedelta(minutes=30)


def parse_ts(value: str) -> datetime:
    """Parse an Elexon ISO-8601 timestamp into an aware UTC datetime."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    """Canonical UTC string; lexically sortable, which matters for SQLite."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_start(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def day_end(day: date) -> datetime:
    """Exclusive upper bound: 00:00 on the following day."""
    return day_start(day) + timedelta(days=1)


def floor_to_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def half_hour_starts(day: date) -> list[datetime]:
    """The 48 settlement-period start times for a normal (non-DST) day."""
    start = day_start(day)
    return [start + HALF_HOUR * i for i in range(48)]


def daterange(start: date, end: date):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)
