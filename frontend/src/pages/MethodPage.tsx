import { api, useAsync } from '../api'
import { Loading, Panel } from '../components/Panel'
import { clock, dayLabel } from '../format'
import type { Meta } from '../types'

export function MethodPage({
  meta,
  date,
  cutoffHour,
}: {
  meta: Meta
  date: string
  cutoffHour: number
}) {
  const { data: vintages } = useAsync(
    (signal) => api.vintages(date, cutoffHour, signal),
    [date, cutoffHour],
  )

  const stored = meta.data

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Data &amp; method</div>
          <h1 className="page-title">Where the numbers come from</h1>
          <p className="page-sub">
            Everything here is traceable to two public Elexon BMRS streams and a documented join rule. This page is
            the audit trail.
          </p>
        </div>
      </div>

      <Panel
        title="Pipeline"
        note="One month of data, one deterministic path from the API to the screen."
        bodyClass=""
        right={<span className="pill"><span className="dot" /> {stored.ingested_at ? `Ingested ${stored.ingested_at.slice(0, 10)}` : 'Cached'}</span>}
      >
        <div className="flow">
          <div className="flow-step">
            <div className="n">01 · SOURCE</div>
            <h4>Elexon BMRS</h4>
            <p>
              <code>FUELHH</code> half-hourly WIND outturn and <code>WINDFOR</code> hourly forecasts. No key, no
              cost, one request per day.
            </p>
          </div>
          <div className="flow-step">
            <div className="n">02 · INGEST</div>
            <h4>Land, validate, upsert</h4>
            <p>
              Filters re-applied client-side, timestamps normalised to UTC, rows upserted on their natural key so
              revised outturn overwrites cleanly.
            </p>
          </div>
          <div className="flow-step">
            <div className="n">03 · RECONSTRUCT</div>
            <h4>Pick the knowable vintage</h4>
            <p>
              For each half-hour, the newest run published before gate closure. Bisect over sorted vintages — the
              rule that makes the history honest.
            </p>
          </div>
          <div className="flow-step">
            <div className="n">04 · SCORE</div>
            <h4>Quantify and serve</h4>
            <p>
              MAE, RMSE, bias, lead-time curves, empirical shortfall quantiles — cached in-process and served as
              JSON.
            </p>
          </div>
        </div>
      </Panel>

      <div className="cards-2">
        <Panel title="The decision rule" bodyClass="pad">
          <div className="prose" style={{ padding: 0 }}>
            <p>
              For a delivery half-hour <code>t</code> on day <code>D</code>, with gate closure at{' '}
              <code>c = D−1 12:00Z</code>:
            </p>
            <p className="mono" style={{ background: '#0b1017', border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
              forecast(t) = argmax<sub>publishTime</sub> {'{'} v ∈ WINDFOR :<br />
              &nbsp;&nbsp;v.startTime = floor<sub>hour</sub>(t) ∧ v.publishTime ≤ c {'}'}
            </p>
            <p>
              The forecast index keeps every vintage for a delivery hour sorted by publish time, so the lookup is a
              bisect. A run published at 12:25 on the delivery day is <em>not</em> eligible for a 12:00 cutoff — it
              exists in the data, and ignoring it is the whole point.
            </p>
            <p>
              <code>WINDFOR</code> is hourly and <code>FUELHH</code> is half-hourly. Each forecast hour is compared
              with the mean of the two settlement periods it spans, which keeps the comparison energy-consistent
              rather than crediting a run for one lucky half-hour.
            </p>
          </div>
        </Panel>

        <Panel title="Forecast vintages around this delivery day" note={`Every run that covered ${dayLabel(date)}. Runs after ${clock(vintages?.cutoff)} UTC on the previous day could not have informed the bid.`}>
          {vintages ? (
            <div className="scroll" style={{ maxHeight: 360 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Published</th>
                    <th>Hours</th>
                    <th>Mean MW</th>
                    <th>Before cutoff</th>
                    <th>Usable</th>
                  </tr>
                </thead>
                <tbody>
                  {vintages.runs.map((run) => (
                    <tr key={run.publish_time}>
                      <td className="mono">
                        {run.publish_time.slice(5, 10)} {clock(run.publish_time)}
                      </td>
                      <td>{run.hours_covered}</td>
                      <td>{Math.round(run.mean_mw).toLocaleString('en-GB')}</td>
                      <td className={run.hours_before_cutoff < 0 ? 'neg' : ''}>
                        {run.hours_before_cutoff.toFixed(1)}h
                      </td>
                      <td>
                        <span style={{ color: run.available ? 'var(--green)' : 'var(--dim)' }}>
                          {run.available ? '●' : '○'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Loading label="Loading vintages…" />
          )}
        </Panel>
      </div>

      <div className="cards-2">
        <Panel title="Provenance" bodyClass="">
          <div className="kv">
            <div>Actuals stream</div>
            <div className="mono">FUELHH · fuelType=WIND</div>
            <div>Forecast stream</div>
            <div className="mono">WINDFOR · all vintages</div>
            <div>Settlement periods</div>
            <div>{stored.actuals.rows.toLocaleString('en-GB')} (Jan 2026, 31 days × 48)</div>
            <div>Forecast rows</div>
            <div>{stored.forecasts.rows.toLocaleString('en-GB')}</div>
            <div>Forecast vintages</div>
            <div>{stored.forecasts.vintages.toLocaleString('en-GB')} runs</div>
            <div>Publish window</div>
            <div className="mono">
              {stored.forecasts.first_publish?.slice(0, 16).replace('T', ' ')} →{' '}
              {stored.forecasts.last_publish?.slice(0, 16).replace('T', ' ')}
            </div>
            <div>Source</div>
            <div>
              <a href={meta.source.actuals} target="_blank" rel="noreferrer">
                BMRS datasets
              </a>{' '}
              · {meta.source.licence}
            </div>
          </div>
        </Panel>

        <Panel title="Metric definitions" bodyClass="">
          <div className="kv">
            <div>MAE</div>
            <div>Mean of |forecast − actual|. The headline miss in MW.</div>
            <div>RMSE</div>
            <div>Square-rooted mean squared error. Weights large misses more heavily.</div>
            <div>Bias</div>
            <div>Mean of (forecast − actual). Positive means a standing over-forecast.</div>
            <div>nMAE</div>
            <div>MAE as a share of mean outturn. Used instead of MAPE, which explodes when wind is near zero.</div>
            <div>De-biased MAE</div>
            <div>MAE after subtracting the mean error — the random component left over.</div>
            <div>Headroom (p90)</div>
            <div>
              90th percentile of the centred shortfall. Hold this much above a de-biased forecast to cover nine
              half-hours in ten.
            </div>
          </div>
        </Panel>
      </div>

      <div className="cards-2">
        <Panel title="Assumptions and limitations" bodyClass="pad">
          <div className="prose" style={{ padding: 0 }}>
            <ul>
              <li>
                <strong>Units.</strong> <code>WINDFOR</code> values are treated as MW. Elexon does not state units
                upstream; the magnitudes are consistent with national wind output.
              </li>
              <li>
                <strong>Structural bias.</strong> The forecast runs consistently above transmission-metered wind
                outturn — measured, not assumed (see the accuracy page). This is treated as a calibration problem,
                not a defect in either feed.
              </li>
              <li>
                <strong>Ex-post calibration.</strong> Headroom is estimated on realised January error. A production
                system needs a rolling walk-forward window so a past bid is never informed by a future outcome.
              </li>
              <li>
                <strong>No demand model.</strong> Scope is wind generation only, per the brief. The recommendation
                is a wind-volume adjustment, not a full energy position.
              </li>
              <li>
                <strong>No DST handling.</strong> January is GMT throughout, so 48 settlement periods hold. The grid
                generator is not hardcoded to 48 elsewhere.
              </li>
            </ul>
          </div>
        </Panel>

        <Panel title="API surface" bodyClass="">
          <div className="kv">
            <div className="mono">GET /api/decision</div>
            <div>Vintage-aware reconstruction for one delivery day, with the procurement adjustment.</div>
            <div className="mono">GET /api/accuracy</div>
            <div>Error metrics, lead-time curve, histogram and daily ranking for a date range.</div>
            <div className="mono">GET /api/vintages</div>
            <div>Every forecast run covering a day, flagged usable or not against the cutoff.</div>
            <div className="mono">GET /api/meta</div>
            <div>Coverage, provenance and assumptions. Drives the date pickers.</div>
            <div className="mono">GET /api/health</div>
            <div>Liveness probe used by the container platform.</div>
            <div className="mono">GET /docs</div>
            <div>Interactive OpenAPI schema, generated from the typed FastAPI handlers.</div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
