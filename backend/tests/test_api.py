"""Integration smoke tests against the shipped warehouse.

Skipped automatically when the SQLite file is absent (e.g. a fresh clone before
`python -m app.ingest`). These check the contract the frontend depends on:
status codes, envelope keys, and the two invariants that matter most --
no forecast may post-date its decision cutoff, and the accuracy endpoint must
score every settlement period it holds.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config, main

pytestmark = pytest.mark.skipif(
    not config.DB_PATH.exists(), reason="warehouse not built; run `python -m app.ingest`"
)

client = TestClient(main.app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_meta_reports_full_january_coverage():
    body = client.get("/api/meta").json()
    assert len(body["delivery_dates"]) == 31
    assert body["delivery_dates"][0] == "2026-01-01"
    assert body["delivery_dates"][-1] == "2026-01-31"
    assert body["data"]["actuals"]["rows"] == 31 * 48


def test_decision_never_uses_a_forecast_published_after_the_cutoff():
    body = client.get("/api/decision", params={"delivery_date": "2026-01-15", "cutoff_hour": 12}).json()
    cutoff = body["cutoff"]
    assert body["status"] == "published"
    assert len(body["rows"]) == 48
    for row in body["rows"]:
        if row["forecast_publish_time"]:
            assert row["forecast_publish_time"] <= cutoff


def test_decision_rejects_bad_dates():
    assert client.get("/api/decision", params={"delivery_date": "15-01-2026"}).status_code == 422
    assert client.get("/api/decision", params={"delivery_date": "2026-03-01"}).status_code == 404


def test_accuracy_scores_the_whole_month():
    body = client.get("/api/accuracy").json()
    assert body["coverage"]["scored"] == body["coverage"]["half_hours"] == 31 * 48
    assert body["overall"]["mae_mw"] > 0
    assert len(body["by_day"]) == 31
    assert len(body["histogram"]["bins"]) == 24
    # De-biasing cannot make the absolute error worse than the raw series.
    assert body["overall"]["mae_debiased_mw"] <= body["overall"]["mae_mw"]


def test_vintages_flag_availability_at_the_cutoff():
    body = client.get("/api/vintages", params={"delivery_date": "2026-01-15"}).json()
    assert body["runs"], "expected at least one run covering the day"
    for run in body["runs"]:
        assert run["available"] is (run["hours_before_cutoff"] >= 0)
