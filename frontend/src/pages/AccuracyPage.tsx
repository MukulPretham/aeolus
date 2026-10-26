import { api, useAsync } from '../api'
import { C, DailyMae, ErrorHistogram, LeadBuckets } from '../components/charts'
import { ErrorState, Kpi, Loading, Panel } from '../components/Panel'
import { dayLabel, gwh, mw, pct, signedMw, weekday } from '../format'
import type { Meta } from '../types'

export function AccuracyPage({
  meta,
  start,
  end,
  cutoffHour,
  onRangeChange,
  onOpenDay,
}: {
  meta: Meta
  start: string
  end: string
  cutoffHour: number
  onRangeChange: (start: string, end: string) => void
  onOpenDay: (date: string) => void
}) {
  const { data, loading, error } = useAsync(
    (signal) => api.accuracy(start, end, cutoffHour, signal),
    [start, end, cutoffHour],
  )

  const dates = meta.delivery_dates

  const handleStart = (value: string) => {
    onRangeChange(value, value > end ? value : end)
  }
  const handleEnd = (value: string) => {
    onRangeChange(value < start ? value : start, value)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Forecast accuracy · quantified</div>
          <h1 className="page-title">How wrong is the wind forecast?</h1>
          <p className="page-sub">
            Every half-hour scored against the vintage that was actually available at gate closure — no hindsight,
            no cherry-picked runs.
          </p>
        </div>
        <div className="date-nav">
          <div className="field">
            <label htmlFor="range-start">From</label>
            <select id="range-start" className="control" value={start} onChange={(e) => handleStart(e.target.value)}>
              {dates.map((option) => (
                <option key={option} value={option}>
                  {dayLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="range-end">To</label>
            <select id="range-end" className="control" value={end} onChange={(e) => handleEnd(e.target.value)}>
              {dates.map((option) => (
                <option key={option} value={option}>
                  {dayLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading && !data && <Loading label="Scoring the range…" />}
      {error && <ErrorState message={error} />}

      {data && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Mean absolute error"
              value={mw(data.overall.mae_mw)}
              unit="MW"
              accent={C.forecast}
              sub={`${pct(data.overall.nmae_pct)} of average output`}
            />
            <Kpi
              label="Bias"
              value={signedMw(data.overall.bias_mw)}
              unit="MW"
              accent={C.under}
              sub={`Forecast runs ${pct(
                data.overall.bias_ratio ? Math.abs(data.overall.bias_ratio - 1) * 100 : null,
              )} ${(data.overall.bias_ratio ?? 1) >= 1 ? 'high' : 'low'}`}
            />
          </div>

          <Panel
            title="Daily mean absolute error"
            note={`Raw error, and the same error with the average miss removed — ${pct(data.overall.mae_improvement_pct)} of the error is a constant offset rather than weather.`}
          >
            <DailyMae days={data.by_day} />
            <div className="legend">
              <span className="legend-item">
                <span className="swatch" style={{ background: C.forecast }} /> MAE
              </span>
              <span className="legend-item">
                <span className="swatch" style={{ background: C.green }} /> MAE, de-biased
              </span>
              <span className="legend-item dim">
                {data.coverage.scored.toLocaleString('en-GB')} of{' '}
                {data.coverage.half_hours.toLocaleString('en-GB')} settlement periods scored
              </span>
            </div>
          </Panel>

          <div className="cards-2">
            <Panel
              title="Error by lead time"
              note="How the miss grows as the forecast looks further ahead. The day-ahead bid sits in the 12–36h band."
            >
              <LeadBuckets buckets={data.by_lead_bucket} />
            </Panel>
            <Panel
              title="Distribution of signed error"
              note="Positive means over-forecast. A distribution shifted right of zero is a standing over-buy."
            >
              <ErrorHistogram bins={data.histogram.bins} />
            </Panel>
          </div>

          <Panel
            title="Worst days in the range"
            note="Ranked by mean absolute error. Select a day to open its settlement-period detail."
          >
            <div className="scroll" style={{ maxHeight: 'none' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Weekday</th>
                    <th>MAE MW</th>
                    <th>Forecast GWh</th>
                    <th>Actual GWh</th>
                    <th>Opening</th>
                  </tr>
                </thead>
                <tbody>
                  {data.worst_days.map((day) => (
                    <tr key={day.date} onClick={() => onOpenDay(day.date)} style={{ cursor: 'pointer' }}>
                      <td>{dayLabel(day.date)}</td>
                      <td className="muted">{weekday(day.date)}</td>
                      <td className={day.mae_mw && day.mae_mw > (data.overall.mae_mw ?? 0) ? 'neg' : ''}>
                        {mw(day.mae_mw)}
                      </td>
                      <td>{gwh(day.forecast_gwh)}</td>
                      <td>{gwh(day.actual_gwh)}</td>
                      <td className="muted">View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

        </>
      )}
    </div>
  )
}
