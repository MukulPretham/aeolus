import { useMemo } from 'react'
import { api, useAsync } from '../api'
import { C, ForecastVsActual } from '../components/charts'
import { ErrorState, Loading, Panel } from '../components/Panel'
import { clock, dayShort, fullDay, mw, signedMw } from '../format'
import type { Meta } from '../types'

/** Compress missing settlement periods into a readable range: [45,46,47] -> "45-47". */
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
}: {
  meta: Meta
  date: string
  cutoffHour: number
  onDateChange: (date: string) => void
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

  const total = data.coverage?.periods_total ?? 48
  const covered = data.coverage?.with_forecast ?? total
  const partial = covered < total
  const age = data.lead_range_hours
  const ageText = age ? `${Math.round(age[0])}-${Math.round(age[1])}h` : null

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Delivery day · national wind</div>
          <h1 className="page-title">{fullDay(date)}</h1>
          <p className="page-sub">
            {data.dominant_vintage
              ? `Forecast run ${clock(data.dominant_vintage)} UTC, ${dayShort(data.dominant_vintage.slice(0, 10))}`
              : 'No forecast before the cutoff'}
            {ageText && ` · ${ageText} old at delivery`}
            {partial && (
              <span style={{ color: 'var(--amber)' }}>
                {' '}
                · {covered} of {total} periods have no forecast (SP {periodList(data.coverage.missing_periods)})
              </span>
            )}
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

      <Panel
        title="Forecast versus outturn"
        note="Amber is the forecast the desk had at the cutoff. Cyan is what actually happened."
      >
        <ForecastVsActual rows={data.rows} />
        <div className="legend">
          <span className="legend-item">
            <span className="swatch" style={{ background: C.forecast }} /> Forecast
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: C.actual }} /> Actual
          </span>
          <span className="legend-item dim">Time (UTC)</span>
        </div>
      </Panel>

      <Panel title="Settlement periods" note="48 half-hours. The three largest misses are highlighted.">
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>SP</th>
                <th>Time (UTC)</th>
                <th>Forecast MW</th>
                <th>Actual MW</th>
                <th>Error MW</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
