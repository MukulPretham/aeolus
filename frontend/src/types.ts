// Shapes returned by the FastAPI backend. Kept hand-written rather than
// generated: the surface is small and the explicit types double as docs.

export type Metric = number | null

export interface Meta {
  product: string
  period: { start: string; end: string }
  delivery_dates: string[]
  default_cutoff_hour: number
  data: {
    actuals: { rows: number; first: string | null; last: string | null }
    forecasts: { rows: number; vintages: number; first_publish: string | null; last_publish: string | null }
    ingested_at: string | null
  }
  source: { actuals: string; forecasts: string; licence: string }
  assumptions: string[]
}

export interface Summary {
  n: number
  mae_mw: Metric
  rmse_mw: Metric
  bias_mw: Metric
  bias_ratio: Metric
  nmae_pct: Metric
  mae_debiased_mw: Metric
  rmse_debiased_mw: Metric
  mae_improvement_pct: Metric
  mean_actual_mw: Metric
  mean_forecast_mw: Metric
  p90_abs_error_mw: Metric
  max_abs_error_mw: Metric
  p10_shortfall_mw: Metric
  p90_shortfall_mw: Metric
}

export interface ComparisonRow {
  start_time: string
  settlement_period: number
  forecast_mw: Metric
  forecast_publish_time: string | null
  actual_mw: Metric
  lead_hours: Metric
  cutoff: string
  error_mw: Metric
}

export interface Buffer {
  lead_window: string
  n: number
  bias_mw: Metric
  headroom_p90_mw: Metric
  net_adjustment_mw: Metric
  net_adjustment_pct: Metric
  raw_p90_shortfall_mw?: Metric
  mean_forecast_mw?: Metric
  cutoff_hour: number
  calibration_period?: { start: string; end: string }
  method?: string
}

export interface Decision {
  delivery_date: string
  cutoff: string
  cutoff_hour: number
  status: 'published' | 'no_forecast'
  dominant_vintage: string | null
  vintages_used: { publish_time: string; half_hours: number }[]
  rows: ComparisonRow[]
  summary: Summary
  energy: {
    forecast_gwh: number
    actual_gwh: number
    delta_gwh: number
    buffer_p90_mw: Metric
    recommended_gwh_p90: number
  }
  buffer: Buffer
}

export interface Bucket extends Summary {
  bucket: string
  lead_from_h: number
  lead_to_h: number
}

export interface DayStat extends Summary {
  date: string
  forecast_gwh: number
  actual_gwh: number
  energy_error_gwh: number
  coverage_pct: number
}

export interface Accuracy {
  start: string
  end: string
  cutoff_hour: number
  overall: Summary
  by_lead_bucket: Bucket[]
  by_day: DayStat[]
  histogram: { edge_mw: number; bins: { from_mw: number; to_mw: number; label: string; count: number }[] }
  buffer: Buffer
  worst_days: DayStat[]
  best_days: DayStat[]
  energy: { forecast_gwh: number; actual_gwh: number }
  coverage: { half_hours: number; with_forecast: number; with_actual: number; scored: number }
}

export interface VintageRun {
  publish_time: string
  hours_covered: number
  first_start: string
  last_start: string
  mean_mw: number
  hours_before_cutoff: number
  available: boolean
}

export interface Vintages {
  delivery_date: string
  cutoff: string
  cutoff_hour: number
  runs: VintageRun[]
  selected: string | null
}
