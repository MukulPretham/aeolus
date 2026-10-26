# Demo video script — 10 minutes max

Two parts, 5 minutes each. Record at 1080p, unlisted on YouTube. Open the deployed app in an
**incognito window** before you start recording — that is also how the submission form is checked.

Before recording:

- [ ] `docker compose up --build` or the Heroku URL is live and warm (hit it once first).
- [ ] Browser zoom ~110%, window 1600×1000, all notifications off.
- [ ] Open with `/?date=2026-01-21&cutoff=12#decision` — a volatile but not worst-case day.
- [ ] `/#accuracy`, `/#method` in neighbouring tabs, and `backend/app/analytics.py` + `main.py` in the editor.
- [ ] Do a 20-second silent take to check audio levels and that the mouse is visible.

---

## Part 1 — Customer pitch (max 5:00)

**Goal: make the trading desk want this. Lead with their problem, not our stack.**

### 0:00–0:30 — Frame it
> "You bid for tomorrow's wind before you know tomorrow's wind. Every morning your desk takes a number
> that is wrong by a couple of gigawatts and decides how much thermal to sit behind it. We spent this
> pilot answering two questions: what did you actually know at gate closure, and how much was that
> number wrong by? This is Aeolus."

### 0:30–1:15 — The problem, in their language
> "January, national wind. Forty-eight settlement periods a day, bids clearing at noon the day before.
> The forecast you rely on is published eight times a day and is revised constantly — so the first
> question is not 'what is the forecast', it's 'which forecast'. The second is: what does its error cost
> me, in megawatts I can put in a bid?"

### 1:15–2:15 — Trading desk view (the money screen)
- Point at the banner: **"Latest forecast available: 11:30 UTC, 48 of 48 periods covered."**
  > "This is the run your desk would have had on the screen — not a perfect hindsight forecast."
- Point at the two lines.
  > "Amber is what you were told. Cyan is what happened. Everything below is calculated from that gap."
- Point at the four KPIs, then the error chart.
  > "Every bar is a half-hour you paid for capacity you didn't use. On the 21st, 3.9 GW average."

### 2:15–3:15 — The recommendation (the differentiator)
- Zoom on the right-hand card.
  > "We don't just report error, we price it. Your forecast over-states by 1.8 GW on average. If you
  > de-bias that and then hold the 90th percentile of what's left, your net adjustment is plus 349 MW
  > — 2.6%. Small, but it is knowable in advance and it is repeatable across the month."
  >
  > "Across January that bias was 1,344 gigawatt-hours of capacity you committed to and never used."

### 3:15–4:15 — Accuracy view (credibility)
- Switch tab. Point at the KPIs, then the daily chart.
  > "Two gigawatts mean absolute error — 17.5% of outturn. But look at the green bars: a third of that
  > error disappears if you simply subtract the average miss. Best day 552 MW, worst day 4.9 GW."
- Point at the lead-time chart.
  > "This is the chart that changes behaviour: the error barely grows between 12 and 48 hours. This is
  > not a horizon problem, it is a calibration problem in the forecast itself."

### 4:15–4:45 — Trust
- Switch to Data & method, scroll the provenance block.
  > "Two public Elexon streams, one month, every number traceable. No black box, no proprietary data
  > purchase — this runs on data you already have access to."

### 4:45–5:00 — Close
> "In four weeks you get a defensible bid adjustment and an audit trail for why. Next: rolling
> calibration, demand in the same frame, and intraday re-forecasts as new runs land."

---

## Part 2 — Technical review (max 5:00)

**Goal: the reviewer can navigate the repo and defend the design choices without you.**

### 0:00–0:30 — Architecture in one breath
- Show the repo tree (README layout section).
> "One container. React 19 + TypeScript on the front, FastAPI on the back, SQLite as the warehouse,
> static bundle served by the same process — so no CORS and one deploy target. The dataset is small
> enough that this is a feature, not a compromise."

### 0:30–1:30 — Data layer
- Open `backend/app/elexon.py`.
> "Two endpoints, no auth. Three traps I hit and guarded against: `FUELHH` silently ignores unknown
> query parameters and returns the wrong slice with a 200 — so fuelType and date are re-checked
> client-side. `WINDFOR` returns only the latest run unless you pass a publish window. And
> `publishDateTimeTo` is exclusive at day granularity: `From=To` returns zero rows, so I pass day → day+1."
- Open `ingest.py`.
> "Idempotent by construction: upsert on the natural key, so revisions overwrite and a half-finished
> run can just be re-run."

### 1:30–2:30 — The core algorithm
- Open `analytics.py`, scroll to `ForecastIndex`.
> "This is the whole product. Vintages grouped by delivery hour, sorted by publish time, bisect for the
> newest one at or before the cutoff. That's what makes the history honest — a run published after gate
> closure exists in the data and is provably never used. The key is `(startTime, publishTime)`, not
> `startTime`."
- Point at `day_ahead_window`.
> "Calibration window follows the cutoff: 12:00 gives 12–36h leads, 18:00 gives 6–30h. Getting that
> wrong would silently miscalibrate the headroom."

### 2:30–3:15 — API and caching
- Open `main.py`.
> "Five read endpoints, all pure functions of (range, cutoff), all `lru_cache`d — the data is static so
> the analytical answer is too. `/api/decision` returns the reconstruction plus the procurement
> adjustment. OpenAPI is generated from the typed handlers at `/docs`."

### 3:15–3:45 — Frontend
- Open `App.tsx`, then `api.ts`.
> "Two tabs of analytical UI plus an audit page. Hand-written response types keep the contract
> explicit. `useAsync` aborts in-flight requests when you change date — no race conditions on fast
> switching. Date and cutoff live in the URL, so any view is a shareable deep link."

### 3:45–4:20 — Practices
> "18 tests, no network: the vintage rule, the exclusion of post-cutoff runs, percentile maths, bias
> decomposition, and the API contract, with integration tests that skip cleanly when the warehouse is
> absent. Multi-stage Docker, non-root user, healthcheck, config centralised in one module."

### 4:20–4:50 — Trade-offs and next steps
> "Deliberate choices: no ORM, no pandas — the analysis is 300 lines you can read in one sitting, and
> it's testable. The calibration is ex-post and labelled as such in the UI; production needs a rolling
> walk-forward. Next steps: Postgres + scheduled ingest, intraday vintages, and putting demand in the
> same frame so the output becomes a full position rather than a wind-volume adjustment."

### 4:50–5:00 — Close
> "Repo README has the run instructions and the API table. Everything you just saw is reproducible from
> `docker compose up`."

---

## Upload checklist

- [ ] Total runtime under 10:00 (hard limit).
- [ ] Unlisted, not private — evaluators need the link.
- [ ] Title contains "Aeolus — day-ahead wind intelligence".
- [ ] Open the link in incognito before submitting.
- [ ] Paste the link into the submission form and the README.
