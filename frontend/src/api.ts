import { useEffect, useState } from 'react'
import type { Accuracy, Decision, Meta, Vintages } from './types'

// Same-origin by default: the production image serves the bundle and the API
// from one process. VITE_API_BASE_URL lets the frontend be hosted separately.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(detail)
  }
  return (await response.json()) as T
}

export const api = {
  meta: (signal: AbortSignal) => get<Meta>('/api/meta', signal),
  decision: (date: string, cutoffHour: number, signal: AbortSignal) =>
    get<Decision>(`/api/decision?delivery_date=${date}&cutoff_hour=${cutoffHour}`, signal),
  accuracy: (start: string, end: string, cutoffHour: number, signal: AbortSignal) =>
    get<Accuracy>(`/api/accuracy?start=${start}&end=${end}&cutoff_hour=${cutoffHour}`, signal),
  vintages: (date: string, cutoffHour: number, signal: AbortSignal) =>
    get<Vintages>(`/api/vintages?delivery_date=${date}&cutoff_hour=${cutoffHour}`, signal),
}

interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** Tiny fetch-on-deps hook with cancellation, so fast date changes never race. */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    loader(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false })
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
