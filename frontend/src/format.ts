import type { Metric } from './types'

const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const oneDp = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Megawatts, rounded. Wind is reported to the nearest MW by the desk. */
export function mw(value: Metric | undefined): string {
  return value === null || value === undefined ? '—' : integer.format(value)
}

export function signedMw(value: Metric | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${integer.format(Math.abs(value))}`
}

export function gwh(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : oneDp.format(value)
}

export function signedGwh(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${oneDp.format(Math.abs(value))}`
}

export function pct(value: Metric | undefined): string {
  return value === null || value === undefined ? '—' : `${oneDp.format(value)}%`
}

/** "2026-01-15T11:30:00Z" -> "11:30". The period is January, i.e. GMT == UTC. */
export function clock(iso: string | null | undefined): string {
  return iso ? iso.slice(11, 16) : '—'
}

export function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function dayShort(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function weekday(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
}

export function fullDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
