"""Static configuration for the Aeolus backend.

Everything the product needs to know about *which* slice of the Elexon world we
care about lives here, so the ingest script and the analytics layer can never
disagree about it.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

# --- Paths -------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent.parent  # .../backend
DATA_DIR = Path(os.getenv("AEOLUS_DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.getenv("AEOLUS_DB_PATH", DATA_DIR / "wind.db"))
STATIC_DIR = Path(os.getenv("AEOLUS_STATIC_DIR", BASE_DIR.parent / "frontend" / "dist"))

# --- Elexon BMRS -------------------------------------------------------------

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
ACTUALS_DATASET = "FUELHH"
FORECASTS_DATASET = "WINDFOR"
FUEL_TYPE = "WIND"

HTTP_TIMEOUT_SECONDS = 30.0
HTTP_RETRIES = 3
HTTP_BACKOFF_SECONDS = 1.5
REQUEST_DELAY_SECONDS = 0.25  # be polite to a free public API

# --- Scope -------------------------------------------------------------------

#: Delivery dates we buy power for. The brief fixes this to January 2026.
PERIOD_START = date(2026, 1, 1)
PERIOD_END = date(2026, 1, 31)

#: Forecasts are filtered by *publish* time, so we have to pull a window that
#: starts a few days before the delivery period and ends a couple of days after
#: it (a vintage published on 29 Dec still covers 1 Jan, and 30 Jan covers the
#: rest of the month). Two days of slack either side is plenty.
FORECAST_PUBLISH_START = date(2025, 12, 28)
FORECAST_PUBLISH_END = date(2026, 2, 2)

#: Default day-ahead decision point: 12:00 UTC on D-1. The GB day-ahead
#: auctions (EPEX/Nord Pool) gate-close around midday CET, so a noon-UTC
#: cutoff means the 11:30 vintage is the freshest one on the desk.
DEFAULT_CUTOFF_HOUR = 12

#: Half-hour resolution is fixed by FUELHH; WINDFOR is hourly. We resolve a
#: half-hour to the forecast published for the hour that contains it.
HALF_HOURS_PER_DAY = 48
