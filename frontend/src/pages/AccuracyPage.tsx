import { api, useAsync } from '../api'
import { C, DailyMae } from '../components/charts'
import { ErrorState, Kpi, Loading, Panel } from '../components/Panel'
import { dayLabel, mw, pct, signedMw } from '../format'
import type { Meta } from '../types'

export function AccuracyPage({
  meta,
  start,
  end,
  cutoffHour,
  onRangeChange,
}: {
  meta: Meta
  start: string
  end: string
  cutoffHour: number
  onRangeChange: (start: string, end: string) => void
}) {
  const { data, loading, error } = useAsync(
    (signal) => api.accuracy(start, end, cutoffHour, signal),
    [start, end, cutoffHour],
  )

  const dates = meta.delivery_dates

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Forecast accuracy</div>
          <h1 className="page-title">How wrong is the wind forecast?</h1>
          <p className="page-sub">
            Every half-hour scored against the forecast that was actually available at the cutoff.
          </p>
        </div>
        <div className="date-nav">
          <div className="field">
            <label htmlFor="range-start">From</label>
            <select
              id="range-start"
              className="control"
              value={start}
              onChange={(e) => onRangeChange(e.target.value, e.target.value > end ? e.target.value : end)}
            >
              {dates.map((option) => (
                <option key={option} value={option}>
                  {dayLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="range-end">To</label>
            <select
              id="range-end"
              className="control"
              value={end}
              onChange={(e) => onRangeChange(e.target.value < start ? e.target.value : start, e.target.value)}
            >
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
              label="Average error"
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
            <Kpi
              label="After removing bias"
              value={mw(data.overall.mae_debiased_mw)}
              unit="MW"
              accent={C.green}
              sub={`${pct(data.overall.mae_improvement_pct)} of the error is a constant offset`}
            />
          </div>

          <Panel title="Average error per day" note="Mean absolute error for each delivery day in the range.">
            <DailyMae days={data.by_day} />
          </Panel>
        </>
      )}
    </div>
  )
}
