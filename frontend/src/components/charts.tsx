import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ComparisonRow, DayStat } from '../types'
import { clock, dayLabel, mw } from '../format'

export const C = {
  forecast: '#f5a623',
  actual: '#38bdf8',
  green: '#34d399',
  under: '#fb7185',
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
          <strong>
            {typeof item.value === 'number'
              ? `${mw(item.value)}${item.dataKey === 'error' ? ' MW' : ''}`
              : String(item.value ?? '—')}
          </strong>
        </div>
      ))}
    </div>
  )
}

function mwTick(value: number): string {
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
            name="Actual"
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
            name="Forecast"
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

/** One bar per delivery day: the average miss in MW. */
export function DailyMae({ days }: { days: DayStat[] }) {
  const data = days.map((day) => ({
    label: dayLabel(day.date),
    error: day.mae_mw,
  }))

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
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
          <Bar dataKey="error" name="Error" fill={C.forecast} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
