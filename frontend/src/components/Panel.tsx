import type { ReactNode } from 'react'

export function Panel({
  title,
  note,
  right,
  children,
  bodyClass = '',
}: {
  title?: string
  note?: string
  right?: ReactNode
  children: ReactNode
  bodyClass?: string
}) {
  return (
    <section className="panel">
      {(title || right) && (
        <header className="panel-head">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {note && <p className="panel-note">{note}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={`panel-body ${bodyClass}`}>{children}</div>
    </section>
  )
}

export function Kpi({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  accent?: string
}) {
  return (
    <div className="kpi" style={{ ['--accent' as string]: accent ?? 'var(--line)' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-box">
      <strong>Could not load data</strong>
      <span>{message}</span>
    </div>
  )
}
