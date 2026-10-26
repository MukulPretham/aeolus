import { useEffect, useState } from 'react'
import { api, useAsync } from './api'
import { Logo } from './components/Logo'
import { ErrorState, Loading } from './components/Panel'
import { AccuracyPage } from './pages/AccuracyPage'
import { DecisionPage } from './pages/DecisionPage'
import { MethodPage } from './pages/MethodPage'

type Tab = 'decision' | 'accuracy' | 'method'

const TABS: { id: Tab; label: string }[] = [
  { id: 'decision', label: 'Trading desk' },
  { id: 'accuracy', label: 'Forecast accuracy' },
  { id: 'method', label: 'Data & method' },
]

// Gate closures worth offering. Default 12:00 UTC sits just after the 11:30 run.
const CUTOFF_OPTIONS = [0, 2, 4, 6, 8, 10, 11, 12, 14, 16, 18, 20, 22]

function readTab(): Tab {
  const hash = window.location.hash.replace('#', '')
  return TABS.some((tab) => tab.id === hash) ? (hash as Tab) : 'decision'
}

// Deep links, e.g. /?date=2026-01-11&cutoff=18#decision — a trader can paste the
// exact view they are arguing about into chat.
const params = new URLSearchParams(window.location.search)
const linkedDate = params.get('date')
const linkedCutoff = Number(params.get('cutoff'))
const initialCutoff = CUTOFF_OPTIONS.includes(linkedCutoff) ? linkedCutoff : 12

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab)
  const [cutoffHour, setCutoffHour] = useState(initialCutoff)
  const [date, setDate] = useState<string | null>(linkedDate)
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)

  const { data: meta, loading, error } = useAsync((signal) => api.meta(signal), [])

  // Seed defaults from the data as soon as metadata lands, and repair a deep
  // link that names a day we do not hold rather than showing a 404 panel.
  useEffect(() => {
    if (!meta) return
    const fallback = meta.delivery_dates[meta.delivery_dates.length - 1] ?? meta.period.start
    if (!date || !meta.delivery_dates.includes(date)) setDate(fallback)
    if (!range) setRange({ start: meta.period.start, end: meta.period.end })
  }, [meta, date, range])

  useEffect(() => {
    const query = date ? `?date=${date}&cutoff=${cutoffHour}` : ''
    window.history.replaceState(null, '', `${query}#${tab}`)
  }, [tab, date, cutoffHour])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <Logo />
            <div>
              <div className="brand-name">AEOLUS</div>
              <div className="brand-sub">Day-ahead wind intelligence · GB</div>
            </div>
          </div>

          <div className="topbar-right">
            <span className="pill">
              <span className="dot" />
              {meta ? `Jan 2026 · ${meta.data.actuals.rows.toLocaleString('en-GB')} settlement periods` : 'Connecting…'}
            </span>
            <div className="field">
              <label htmlFor="cutoff">Decision cutoff (UTC)</label>
              <select
                id="cutoff"
                className="control"
                value={cutoffHour}
                onChange={(event) => setCutoffHour(Number(event.target.value))}
              >
                {CUTOFF_OPTIONS.map((hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, '0')}:00 {hour === 12 ? '· default' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="wrap">
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className="tab"
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="wrap" style={{ flex: 1 }}>
        {loading && !meta && <Loading label="Connecting to the warehouse…" />}
        {error && <ErrorState message={error} />}

        {meta && date && range && tab === 'decision' && (
          <DecisionPage
            meta={meta}
            date={date}
            cutoffHour={cutoffHour}
            onDateChange={setDate}
          />
        )}

        {meta && range && tab === 'accuracy' && (
          <AccuracyPage
            meta={meta}
            start={range.start}
            end={range.end}
            cutoffHour={cutoffHour}
            onRangeChange={(start, end) => setRange({ start, end })}
          />
        )}

        {meta && date && tab === 'method' && (
          <MethodPage meta={meta} date={date} cutoffHour={cutoffHour} />
        )}
      </main>

      <footer className="footer wrap">
        <span>
          Aeolus · pilot build · source: Elexon BMRS <span className="mono">FUELHH</span> /{' '}
          <span className="mono">WINDFOR</span> · January 2026 delivery
        </span>
        <span>Built with AI assistance</span>
      </footer>
    </div>
  )
}
