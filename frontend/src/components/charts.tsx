import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Bucket, ComparisonRow, DayStat } from '../types'
import { clock, dayLabel, mw } from '../format'

export const C = {
  forecast: '#f5a623',
  actual: '#38bdf8',
  over: '#818cf8',
  under: '#fb7185',
  green: '#34d399',
  grid: '#1a2431',
  axis: '#7d8ea3',
}

const axisProps = {
  stroke: 'transparent',
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
} as const

interface TipItem {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
}

interface TipProps {
  active?: boolean
  payload?: TipItem[]
  label?: string | number
}

function ChartTip({ active, payload, label }: TipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{label}</div>
      {payload.map((item) => (
        <div className="chart-tip-row" key={String(item.dataKey)}>
          <span style={{ color: item.color }}>{item.name}</span>
          <strong>{typeof item.value === 'number' ? `${mw(item.value)} MW` : String(item.value ?? '—')}</strong>
        </div>
      ))}
    </div>
  )
}

function mwTick(value: number): string {
  // Keep sub-10 GW values exact (a settlement-period miss of 975 MW should not
  // render as "1k"), abbreviate only when the axis gets wide.
  return Math.abs(value) >= 10000
    ? `${Math.round(value / 1000)}k`
    : Math.round(value).toLocaleString('en-GB')
}

/** Forecast against outturn across the 48 settlement periods of a delivery day. */
export function ForecastVsActual({ rows }: { rows: ComparisonRow[] }) {
  const data = rows.map((row) => ({
    label: clock(row.start_time),
    sp: row.settlement_period,
    forecast: row.forecast_mw,
    actual: row.actual_mw,
  }))

  return (
    <div className="chart tall">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.actual} stopOpacity={0.22} />
              <stop offset="100%" stopColor={C.actual} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" interval={7} {...axisProps} />
          <YAxis
            tickFormatter={mwTick}
            width={52}
            axisLine={false}
            tickLine={false}
            tick={{ fill: C.axis, fontSize: 11 }}
            domain={[0, 'auto']}
          />
          <Tooltip content={<ChartTip />} cursor={{ stroke: '#31404f', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual outturn"
            stroke={C.actual}
            strokeWidth={2}
            fill="url(#actualFill)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast (as at cutoff)"
            stroke={C.forecast}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Signed error per settlement period: how the miss was distributed through the day. */
export function ErrorByPeriod({ rows }: { rows: ComparisonRow[] }) {
  const data = rows.map((row) => ({
    label: clock(row.start_time),
    error: row.error_mw,
  }))

  return (
    <div className="chart short">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" interval={7} {...axisProps} />
          <YAxis
            tickFormatter={mwTick}
            width={52}
            axisLine={false}
            tickLine={false}
            tick={{ fill: C.axis, fontSize: 11 }}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <ReferenceLine y={0} stroke="#33414f" />
          <Bar dataKey="error" name="Forecast error" isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.error !== null && entry.error >= 0 ? C.over : C.under}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Daily MAE, raw versus de-biased: the gap is the systematic share of the miss. */
export function DailyMae({ days }: { days: DayStat[] }) {
  const data = days.map((day) => ({
    label: dayLabel(day.date),
    raw: day.mae_mw,
    debiased: day.mae_debiased_mw,
  }))

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barGap={1}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" interval={2} {...axisProps} />
          <YAxis
            tickFormatter={mwTick}
            width={52}
            axisLine={false}
            tickLine={false}
            tick={{ fill: C.axis, fontSize: 11 }}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="raw" name="MAE" fill={C.forecast} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar
            dataKey="debiased"
            name="MAE, de-biased"
            fill={C.green}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Error as a function of lead time — the curve behind the procurement rule. */
export function LeadBuckets({ buckets }: { buckets: Bucket[] }) {
  const data = buckets
    .filter((bucket) => bucket.n > 0)
    .map((bucket) => {
      const span = bucket.lead_to_h >= 96 ? `${bucket.lead_from_h}h+` : `${bucket.lead_from_h}-${bucket.lead_to_h}h`
      return {
        bucket: `${span} · n=${bucket.n.toLocaleString('en-GB')}`,
        raw: bucket.mae_mw,
        debiased: bucket.mae_debiased_mw,
        n: bucket.n,
      }
    })

  return (
    <div className="chart short">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 24, bottom: 4, left: 8 }}
          barGap={1}
        >
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={mwTick} {...axisProps} axisLine={false} />
          <YAxis
            type="category"
            dataKey="bucket"
            width={148}
            axisLine={false}
            tickLine={false}
            tick={{ fill: C.axis, fontSize: 11 }}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="raw" name="MAE" fill={C.forecast} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar
            dataKey="debiased"
            name="MAE, de-biased"
            fill={C.green}
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Distribution of signed errors: skew tells you which way to lean. */
function signedCompact(value: string | number): string {
  const n = Number(value)
  if (!n) return '0'
  const mag = Math.abs(n)
  const body = mag >= 1000 ? `${(mag / 1000).toFixed(1)}k` : String(mag)
  return `${n > 0 ? '+' : '−'}${body}`
}

export function ErrorHistogram({
  bins,
}: {
  bins: { from_mw: number; to_mw: number; label: string; count: number }[]
}) {
  return (
    <div className="chart short">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" interval={3} tickFormatter={signedCompact} {...axisProps} />
          <YAxis
            width={38}
            axisLine={false}
            tickLine={false}
            tick={{ fill: C.axis, fontSize: 11 }}
          />
          <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="count" name="Half-hours" isAnimationActive={false}>
            {bins.map((bin, index) => (
              <Cell key={index} fill={(bin.from_mw + bin.to_mw) / 2 >= 0 ? C.over : C.under} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
