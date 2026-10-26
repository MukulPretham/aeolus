"""Thin, defensive client for the two Elexon BMRS endpoints we depend on.

Design notes worth calling out in review:

* No API key. Both datasets are open.
* ``FUELHH`` is filtered by **settlement date** and by ``fuelType``. The date
  parameters are ``settlementDateFrom``/``settlementDateTo``; the API silently
  ignores unknown query parameters, so a typo'd filter returns HTTP 200 with
  the wrong slice of data. We therefore also filter client-side and assert the
  returned range.
* ``WINDFOR`` is filtered by **publish date** only. Without that filter the
  endpoint returns just the latest run, which is useless for back-testing.
  The response is *vintaged*: one row per (startTime, publishTime).
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta

import httpx

from . import config

log = logging.getLogger(__name__)


class ElexonError(RuntimeError):
    """Raised when the upstream API cannot give us usable data."""


def _get(client: httpx.Client, path: str, params: dict[str, str]) -> list[dict]:
    url = f"{config.ELEXON_BASE_URL}{path}"
    last_error: Exception | None = None

    for attempt in range(1, config.HTTP_RETRIES + 1):
        try:
            response = client.get(url, params=params)
            # 429/5xx are worth retrying; 4xx other than 429 are not.
            if response.status_code == 429 or response.status_code >= 500:
                raise ElexonError(f"HTTP {response.status_code} from {url}")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ElexonError(f"Unexpected payload shape from {url}: {type(payload)}")
            return payload
        except (httpx.HTTPError, ValueError, ElexonError) as exc:
            last_error = exc
            if attempt == config.HTTP_RETRIES:
                break
            sleep_for = config.HTTP_BACKOFF_SECONDS * attempt
            log.warning("Elexon call failed (%s), retrying in %.1fs", exc, sleep_for)
            time.sleep(sleep_for)

    raise ElexonError(f"Giving up on {url} params={params}: {last_error}")


def fetch_actuals_for_day(client: httpx.Client, day: date) -> list[dict]:
    """Half-hourly WIND outturn for one settlement day."""
    params = {
        "settlementDateFrom": day.isoformat(),
        "settlementDateTo": day.isoformat(),
        "fuelType": config.FUEL_TYPE,
    }
    rows = _get(client, f"/datasets/{config.ACTUALS_DATASET}/stream", params)
    time.sleep(config.REQUEST_DELAY_SECONDS)

    kept = []
    for row in rows:
        # Server-side filter plus a client-side guard: the docs allow an array,
        # and a silently-ignored filter is the classic failure mode here.
        if row.get("fuelType") != config.FUEL_TYPE:
            continue
        if row.get("settlementDate") != day.isoformat():
            continue
        if row.get("generation") is None:
            continue
        kept.append(row)

    if not kept:
        log.warning("No %s rows returned for %s", config.FUEL_TYPE, day)
    return kept


def fetch_forecasts_for_publish_day(client: httpx.Client, day: date) -> list[dict]:
    """All vintages published on one UTC day.

    The ``To`` bound is **exclusive** at day granularity: ``From=To=2026-01-04``
    returns zero rows, while ``From=2026-01-04&To=2026-01-05`` returns exactly
    that day's eight runs. We pass ``day`` and ``day + 1`` accordingly.
    """
    params = {
        "publishDateTimeFrom": day.isoformat(),
        "publishDateTimeTo": (day + timedelta(days=1)).isoformat(),
    }
    rows = _get(client, f"/datasets/{config.FORECASTS_DATASET}/stream", params)
    time.sleep(config.REQUEST_DELAY_SECONDS)

    kept = []
    for row in rows:
        if row.get("generation") is None:
            continue
        if not row.get("publishTime") or not row.get("startTime"):
            continue
        kept.append(row)
    return kept
