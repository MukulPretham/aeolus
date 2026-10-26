import { useMemo } from 'react'
import { api, useAsync } from '../api'
import { ErrorByPeriod, ForecastVsActual, C } from '../components/charts'
import { ErrorState, Kpi, Loading, Panel } from '../components/Panel'
import { clock, dayShort, fullDay, gwh, mw, pct, signedGwh, signedMw } from '../format'
import type { Meta } from '../types'

/** Compress a list of settlement periods into a readable range: [3,45,46] -> "3, 45-46". */
function periodList(periods: number[]): string {
  if (periods.length === 0) return '—'
  const sorted = [...periods].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (const period of sorted.slice(1)) {
    if (period === prev + 1) {
      prev = period
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = period
    prev = period
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`)
  return parts.join(', ')
}

export function DecisionPage({
  meta,
  date,
  cutoffHour,
  onDateChange,
  onOpenAccuracy,
}: {
  meta: Meta
  date: string
  cutoffHour: number
  onDateChange: (date: string) => void
  onOpenAccuracy: () => void
}) {
  const { data, loading, error } = useAsync(
    (signal) => api.decision(date, cutoffHour, signal),
    [date, cutoffHour],
  )

  const dates = meta.delivery_dates
  const index = dates.indexOf(date)
  const prev = index > 0 ? dates[index - 1] : undefined
  const next = index >= 0 && index < dates.length - 1 ? dates[index + 1] : undefined

  const worstPeriods = useMemo(() => {
    if (!data) return new Set<number>()
    const scored = data.rows
      .filter((row) => row.error_mw !== null)
      .sort((a, b) => Math.abs(b.error_mw ?? 0) - Math.abs(a.error_mw ?? 0))
    return new Set(scored.slice(0, 3).map((row) => row.settlement_period))
  }, [data])

  if (loading && !data) return <Loading label="Rebuilding the decision view…" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { summary, energy, buffer } = data
  const total = data.coverage?.periods_total ?? 48
  const covered = data.coverage?.with_forecast ?? total
  const scored = data.coverage?.scored ?? total
  const partial = covered < total
  const age = data.lead_range_hours
  const ageText = age ? `${Math.round(age[0])}-${Math.round(age[1])}h` : null
  const vsForecastPct =
    energy.forecast_gwh > 0 ? ((energy.recommended_gwh_p90 - energy.forecast_gwh) / energy.forecast_gwh) * 100 : 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Delivery day · national wind</div>
          <h1 className="page-title">{fullDay(date)}</h1>
          <p className="page-sub">
            Bids for this day clear at {clock(data.cutoff)} UTC on {fullDay(data.cutoff.slice(0, 10))}. Everything
            below is what was knowable at that moment.
          </p>
        </div>
        <div className="date-nav">
          <button
            className="icon-btn"
            onClick={() => prev && onDateChange(prev)}
            disabled={!prev}
            aria-label="Previous delivery day"
          >
            ‹
          </button>
          <select className="control" value={date} onChange={(event) => onDateChange(event.target.value)}>
            {dates.map((option) => (
              <option key={option} value={option}>
                {fullDay(option)}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            onClick={() => next && onDateChange(next)}
            disabled={!next}
            aria-label="Next delivery day"
          >
            ›
          </button>
        </div>
      </div>

      <div className={`banner ${data.status === 'published' && !partial ? '' : 'warn'}`}>
        <span className="dot" style={{ background: partial ? 'var(--amber)' : 'var(--green)' }} />
        <div className="banner-main">
          <span className="banner-title">
            {data.dominant_vintage
              ? `Latest forecast available: run published ${clock(data.dominant_vintage)} UTC on ${dayShort(
                  data.dominant_vintage.slice(0, 10),
                )}`
              : 'No forecast was available before the cutoff'}
          </span>
          <span className="banner-text">
            {partial
              ? `${covered} of ${total} periods covered — SP ${periodList(
                  data.coverage?.missing_periods ?? [],
                )} have no forecast from this run`
              : `${total} of ${total} periods covered · ${
                  data.vintages_used.length > 1
                    ? `${data.vintages_used.length} vintages stitched`
                    : 'single vintage'
                }`}
            {ageText && ` · forecast age ${ageText} at delivery`}
          </span>
        </div>
        <div className="banner-metric">
          <div className="v">{gwh(energy.forecast_gwh)} GWh</div>
          <div className="l">Forecast energy</div>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi
          label="Forecast at cutoff"
          value={gwh(energy.forecast_gwh)}
          unit="GWh"
          accent={C.forecast}
          sub={`Mean ${mw(summary.mean_forecast_mw)} MW over ${scored} of ${total} periods`}
        />
        <Kpi
          label="Actual outturn"
          value={gwh(energy.actual_gwh)}
          unit="GWh"
          accent={C.actual}
          sub={`Mean ${mw(summary.mean_actual_mw)} MW over ${scored} of ${total} periods`}
        />
        <Kpi
          label="Forecast error"
          value={mw(summary.mae_mw)}
          unit="MW"
          accent={C.under}
          sub={`${pct(summary.nmae_pct)} of average output`}
        />
      </div>

      <div className="split">
        <Panel
          title="Forecast versus outturn"
          note="The amber line is the only wind number the desk had. The gap to the cyan line is the risk that had to be hedged."
          right={
            <button className="pill" onClick={onOpenAccuracy} style={{ cursor: 'pointer' }}>
              Month accuracy →
            </button>
          }
        >
          <ForecastVsActual rows={data.rows} />
          <div className="legend">
            <span className="legend-item">
              <span className="swatch" style={{ background: C.forecast }} /> Forecast at cutoff
            </span>
            <span className="legend-item">
              <span className="swatch" style={{ background: C.actual }} /> Actual outturn
            </span>
            <span className="legend-item dim">Time (UTC) · 48 settlement periods</span>
          </div>
        </Panel>

        <Panel
          title="Procurement recommendation"
          bodyClass="rec-body"
          note="What to bid, after correcting for measured error."
        >
          <div className="rec">
            <div className="kpi-label">Recommended bid</div>
            <div className="rec-big">
              <span className="v">{gwh(energy.recommended_gwh_p90)}</span>
              <span className="u">GWh</span>
              <span className="rec-delta">{signedGwh(vsForecastPct)}%</span>
            </div>

            <div className="rec-line">
              <span className="k">Raw forecast</span>
              <span className="v">{gwh(energy.forecast_gwh)} GWh</span>
            </div>
            <div className="rec-line" style={{ borderBottom: 0 }}>
              <span className="k">Adjustment</span>
              <span className="v" style={{ color: C.green }}>
                {signedGwh(energy.recommended_gwh_p90 - energy.forecast_gwh)} GWh
              </span>
            </div>

            <p className="rec-foot">
              The forecast ran {mw(buffer.bias_mw)} MW high on average, so buy less — but hold {mw(buffer.headroom_p90_mw)} MW
              back for the days it runs low. Net {signedMw(buffer.net_adjustment_mw)} MW, calibrated on{' '}
              {buffer.n.toLocaleString('en-GB')} half-hours at {buffer.lead_window} lead (ex-post).
              {partial && ` This bid covers only the ${covered} periods that have a forecast.`}
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="Error through the day"
        note="Positive bars mean the forecast was higher than reality — capacity that was paid for and not used."
      >
        <ErrorByPeriod rows={data.rows} />
      </Panel>

      <Panel
        title="Settlement-period detail"
        note="48 half-hours, in the order the desk books them. The three largest misses are highlighted."
      >
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>SP</th>
                <th>Time (UTC)</th>
                <th>Forecast MW</th>
                <th>Actual MW</th>
                <th>Error MW</th>
                <th>Lead h</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.start_time} className={worstPeriods.has(row.settlement_period) ? 'is-worst' : ''}>
                  <td className="mono">{row.settlement_period}</td>
                  <td>{clock(row.start_time)}</td>
                  <td>{mw(row.forecast_mw)}</td>
                  <td>{mw(row.actual_mw)}</td>
                  <td className={row.error_mw === null ? '' : row.error_mw >= 0 ? 'pos' : 'neg'}>
                    {signedMw(row.error_mw)}
                  </td>
                  <td className="muted">{row.lead_hours === null ? '—' : row.lead_hours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
