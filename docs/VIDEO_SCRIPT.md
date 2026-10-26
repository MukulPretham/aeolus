# Demo video — shot-by-shot script

**10:00 maximum. Part 1 = 0:00–5:00 (customer). Part 2 = 5:00–10:00 (technical review).**
Record 1080p, upload **unlisted**, open the final URL in **incognito** before submitting.

Every number below was read off the running app, so you can say them with confidence.

---

## Pre-flight (do this before you hit record)

```bash
docker compose up --build          # or open the deployed URL
open "http://localhost:8000/?date=2026-01-21&cutoff=12#decision"
```

- [ ] Browser at 1600×1000, zoom ~110%, notifications off, bookmarks bar hidden.
- [ ] Three tabs pre-opened: `#decision`, `#accuracy`, `#method`.
- [ ] Editor open with `backend/app/analytics.py` and `backend/app/elexon.py`.
- [ ] Hit the URL once so the first request is warm (the API caches on first call).
- [ ] Say one sentence out loud, play it back — check mic level and that the cursor is visible.
- [ ] Have this page on a second monitor or your phone.

**The one thing that makes this video good:** never read the screen. Say what the number *means*,
then let the viewer read it.

---

# PART 1 — Customer pitch (0:00–5:00)

### 0:00–0:30 · The problem, before showing anything
> "Every afternoon your desk buys the wind for tomorrow, before it knows what tomorrow's wind is.
> The forecast is wrong by a couple of gigawatts, so you sit thermal behind it. Two questions decide
> whether you do that well: what number did you actually know when you had to bid — and how wrong is
> that number? We spent this pilot answering both, on one month of your own data."

**Do:** stay on the Trading desk tab. Don't scroll yet.

### 0:30–1:10 · What it is
> "This is Aeolus. A single web app, running on public Elexon data: half-hourly wind outturn and the
> hourly wind forecast, for January 2026, national level. No new data purchase. The whole month is
> in the app — 1,488 settlement periods."

**Do:** point at the top-right pill `Jan 2026 · 1,488 settlement periods`.

### 1:10–2:00 · The decision screen — what you knew
**Do:** the tab is already on `Wednesday, 21 January 2026`.

> "Pick a delivery day. The first line tells you which forecast run you'd have been looking at —
> 11:30 the previous morning — and how old it was when you had to commit: 13 to 36 hours."

**Do:** point at `Forecast run 11:30 UTC, Tue 20 Jan · 13-36h old at delivery`.

> "That line matters because Elexon republishes eight times a day. Most tools show you the latest
> forecast. This shows you the latest one you could actually have seen. Everything downstream is
> built on that rule."

**Do:** point at the amber chip `Average error 24.7% of output`.

> "And before you look at a single shape, you know the day's error: just under 25% of output."

### 2:00–2:40 · The chart and the book
**Do:** move the cursor along the chart once, slowly, left to right.

> "Amber is what you were told. Cyan is what happened. The gap is the thing you had to hedge."

**Do:** scroll to the Settlement periods table.

> "Below it, the same day in the form you actually book: 48 rows — forecast, actual, and the miss as
> a percentage. The three worst are highlighted. On the 21st, every single row is positive: the
> forecast was high all day, not wrong in both directions."

### 2:40–3:20 · The proof (this is the money shot)
**Do:** change the cutoff dropdown to `00:00`. Let the view settle. Then change it to `18:00`.

> "Change the cutoff and the app recomputes what was knowable. Move it back to midnight and the run
> is 26 to 47 hours old — and it doesn't even reach the end of the day: four settlement periods have
> no forecast, so the app says so in amber instead of quietly averaging fewer hours."

> "Push it to six in the evening and the run is fresher — 8 to 32 hours — and the error drops from
> 28% to 23.6%. That is the whole thesis in one control: the number you bid on has an age, and the
> age has a price."

**Do:** set it back to `12:00` so the rest of the video uses the standard view.

### 3:20–4:15 · Accuracy
**Do:** switch to **Forecast accuracy**.

> "Second question: how wrong, across the month? Three numbers. Average error, 17.5% of output.
> Bias, plus 15.6% — the forecast runs high, consistently. And 11.5% once you remove that average
> miss."

> "That last number is the important one. A third of the error is a constant offset, not weather.
> An offset is fixable. A bad weather model isn't."

**Do:** point at the daily bars.

> "One bar per delivery day. Best day 552 megawatts, worst day 4.9 gigawatts — the 11th of January."

### 4:15–4:45 · What it costs
> "Add it up across the month: the forecast was too high in 85% of half-hours, and that is about
> 1.3 terawatt-hours of wind capacity committed to and not used. Not because the wind was unusual —
> because the number was biased."

### 4:45–5:00 · Close
> "Four weeks of your own data, one repeatable correction, and an audit trail for every number.
> Next: a rolling calibration so the correction updates as the month runs, and demand in the same
> frame so this becomes a position rather than a wind adjustment. Thank you."

---

# PART 2 — Technical review (5:00–10:00)

### 0:00–0:30 · Architecture in one breath
**Do:** show the repo tree (README "Repository layout").

> "One container. React 19 and TypeScript on the front, FastAPI on the back, SQLite as the warehouse,
> and the static bundle served by the same process — so one origin, no CORS, one deploy target.
> The dataset is a month of national wind: 1,488 actual half-hours and 21,608 forecast rows. Small
> enough that SQLite is a feature, not a shortcut."

### 0:30–1:20 · The data layer, and the three traps
**Do:** open `backend/app/elexon.py`.

> "Two endpoints, no auth. Three traps I hit and guarded against.
> One: FUELHH silently ignores unknown query parameters — a typo'd filter returns HTTP 200 with the
> wrong slice. So the fuel type and date are re-checked client-side.
> Two: WINDFOR without a publish window returns only the latest run, which is useless for backtesting.
> Three: publishDateTimeTo is exclusive at day granularity — From equals To returns zero rows. The
> client sends day to day-plus-one."

> "Every run carries exactly 73 hourly points over a fixed 72-hour window; the split between past and
> future shifts with publication time, so the 02:30 run reaches 66 hours ahead and the 22:30 run only
> 46. A later run is fresher, not longer."

### 1:20–2:00 · Ingest
**Do:** open `backend/app/ingest.py`.

> "One request per day, upserted on the natural key, so Elexon's revisions overwrite rather than
> duplicate, and a half-finished run can just be re-run. The warehouse is committed, so the deployed
> demo never calls Elexon on a cold start."

### 2:00–3:00 · The core algorithm
**Do:** open `backend/app/analytics.py`, scroll to `ForecastIndex`.

> "This is the product. Every vintage for a delivery hour, sorted by publish time, bisected for the
> newest one at or before the cutoff. The primary key is start time plus publish time, not start time
> alone — that's what makes a forecast a vintage rather than a value."

**Do:** scroll to `build_comparisons`.

> "The two feeds disagree on resolution: 48 half-hours against 24 hours. The delivery grid is the
> half-hour, because that's what settles. Each half-hour takes the forecast for the hour containing it
> and is scored against its own outturn — no interpolation, because that would claim precision the
> forecast doesn't have. Collapsing the other way moves MAE by 0.13%, so the choice changes no
> conclusion; it's documented so a reviewer can see it was considered."

**Do:** point at `day_ahead_window`.

> "And the calibration window follows the cutoff: noon gives 12 to 36 hour leads, six in the evening
> gives 6 to 30. Hard-coding that would have silently miscalibrated every late bid."

### 3:00–3:40 · API
**Do:** open `backend/app/main.py`.

> "Five read endpoints, all pure functions of date range and cutoff, all lru-cached — the data is
> static so the analytical answer is. Energy is summed over the same periods for forecast and actual;
> mixing denominators was the bug that made a partial day look like a 15% miss. OpenAPI is generated
> from the typed handlers at /docs."

### 3:40–4:20 · Frontend
**Do:** open `frontend/src/App.tsx`, then `api.ts`.

> "Three tabs of React. Hand-written response types keep the contract explicit. useAsync aborts
> in-flight requests when you change date, so fast clicking can't land stale data. Date and cutoff live
> in the URL — every view is a shareable deep link, which is how the cutoff demo worked."

### 4:20–4:45 · Practices
> "Eighteen tests, no network: the vintage rule, exclusion of post-cutoff runs, percentile maths, the
> bias decomposition, and the API contract, with integration tests that skip cleanly without the
> warehouse. Multi-stage Docker, non-root user, healthcheck, one config module."

### 4:45–5:00 · Trade-offs and close
> "Deliberate choices: no ORM, no pandas — three hundred lines of analysis you can read in one sitting
> and test without a fixture library. The calibration is ex-post and labelled as such; production
> needs a rolling walk-forward. Everything you saw reproduces from docker compose up. Thanks."

---

## Numbers cheat sheet (say these, don't invent)

| Claim | Value |
| --- | --- |
| Settlement periods | 1,488 (31 × 48) |
| Forecast rows / vintages | 21,608 / 296 |
| Runs per day | 8 (02:30 → 22:30 UTC) |
| Month average error | **17.5%** of output (2,021 MW) |
| Month bias | **+15.6%** (+1,806 MW) |
| After removing bias | **11.5%** (1,338 MW), 33.8% of error is offset |
| Half-hours over-forecast | 85.4% |
| Over-procurement, January | 1,344 GWh |
| 21 Jan @ 12:00 | 24.7% error, run 13–36h old, 48/48 |
| 21 Jan @ 00:00 | 28.2% error, run 26–47h old, **44/48** |
| 21 Jan @ 18:00 | 23.6% error, run 8–32h old, 48/48 |
| Best / worst day | 19 Jan 552 MW / 11 Jan 4,945 MW |

## If something breaks mid-take

- **Blank chart** → the API call failed; reload once, it's cached after that.
- **Numbers differ from this sheet** → you changed the cutoff; reset to 12:00 before continuing.
- **Running long** → cut the "What it costs" beat (4:15) from Part 1 and the ingest beat (1:20) from
  Part 2. Never cut the cutoff demo or `ForecastIndex`.

## Before you upload

- [ ] Runtime under 10:00.
- [ ] **Unlisted**, not private.
- [ ] Title: `Aeolus — day-ahead wind intelligence`.
- [ ] Open the link in incognito and confirm it plays.
- [ ] Paste the link into the submission form and the README.
