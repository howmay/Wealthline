import { useEffect, useMemo, useRef, useState } from 'react'
import type { WealthData } from './model'
import { clearHistoryCache, fetchHistory } from './priceHistory'
import { repriceEntry, valueDays, type QuantityDay } from './quantityHistory'

// Query-time projection only: never write provider refreshes into the user's ledger.
// Persisted prices (including legacy manual prices) are not a fallback on failures.
export function useHistoricalValuations(data: WealthData) {
  const days = data.history.quantityDays
  const [generation, setGeneration] = useState(0)
  const reload = useRef(false)
  const [loaded, setLoaded] = useState<{ days: typeof days; generation: number; values: QuantityDay[] }>()
  useEffect(() => {
    if (!days?.length) return
    let active = true
    const fresh = reload.current
    reload.current = false
    void valueDays(days, (symbol, from) => fetchHistory(symbol, from, fresh))
      .then(values => { if (active) setLoaded({ days, generation, values }) })
    return () => { active = false }
  }, [days, generation])
  const ready = loaded?.days === days && loaded?.generation === generation
  const loading = !!days?.length && !ready
  const values = useMemo(() => ready ? loaded!.values : days?.map(day => ({ ...day, entries: day.entries.map(e => repriceEntry(e, day.date, null, null)) })), [ready, days, loaded])
  return {
    data: values ? { ...data, history: { ...data.history, quantityDays: values } } : data,
    loading,
    refresh: () => { clearHistoryCache(); reload.current = true; setGeneration(g => g + 1) },
  }
}
