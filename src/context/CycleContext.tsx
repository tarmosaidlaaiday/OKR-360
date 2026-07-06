import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { cyclesService } from '../services/cycles.service'
import { getCurrentQuarter } from '../lib/utils'
import type { Cycle } from '../types'

interface CycleContextValue {
  cycles: Cycle[]
  activeCycle: Cycle | null
  setActiveCycle: (cycle: Cycle) => void
  loading: boolean
  refresh: () => Promise<void>
}

const CycleContext = createContext<CycleContextValue | null>(null)
const STORAGE_KEY = 'okr_active_cycle_id'

export function CycleProvider({ children }: { children: React.ReactNode }) {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [activeCycle, setActiveCycleState] = useState<Cycle | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const data = await cyclesService.getAll()
    setCycles(data)

    // Only auto-pick a cycle if nothing is selected yet — don't yank the
    // user's already-selected cycle out from under them on subsequent refreshes.
    setActiveCycleState(current => {
      if (current) {
        // Keep current selection but update to fresh data if the cycle still exists
        const still = data.find(c => c.id === current.id)
        return still ?? current
      }

      const savedId = localStorage.getItem(STORAGE_KEY)
      const saved = savedId ? data.find(c => c.id === savedId) : null
      if (saved) return saved

      const { year, quarter } = getCurrentQuarter()
      const byQuarter = data.find(c => c.year === year && c.quarter === quarter)
      return byQuarter ?? data[data.length - 1] ?? null
    })
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  function setActiveCycle(cycle: Cycle) {
    setActiveCycleState(cycle)
    localStorage.setItem(STORAGE_KEY, cycle.id)
  }

  return (
    <CycleContext.Provider value={{ cycles, activeCycle, setActiveCycle, loading, refresh }}>
      {children}
    </CycleContext.Provider>
  )
}

export function useCycle() {
  const ctx = useContext(CycleContext)
  if (!ctx) throw new Error('useCycle must be used inside <CycleProvider>')
  return ctx
}
