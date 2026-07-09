import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getConfidenceLogs } from '../services/confidence.service'
import { getQuarterWeeks, objectiveProgress } from '../lib/cadenceUtils'
import type { CadenceObjective, CadenceKeyResult } from '../types/cadence'

export function useCadenceObjectives(cycleId: string | null, quarter: number, year: number) {
  const [objectives, setObjectives] = useState<CadenceObjective[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cycleId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    async function load() {
      const { data: objs, error } = await supabase
        .from('objectives')
        .select(`
          id, title, status, cycle_id, owner_id,
          unit_id, level_id, parent_objective_id,
          owner:profiles!owner_id(id, full_name, avatar_url, color, role),
          unit:units(id, name),
          level:levels(id, name, depth, color),
          parent_objective:objectives!parent_objective_id(id, title),
          key_results(id, title, target_type, start_value, target_value, current_value, unit, owner_id, confidence)
        `)
        .eq('cycle_id', cycleId)
        .order('created_at', { ascending: true })

      if (error || !objs) {
        console.error('[useCadenceObjectives] query failed', error)
        setError(error?.message ?? 'Failed to load objectives')
        setLoading(false)
        return
      }

      const allKrIds = objs.flatMap((o: any) => (o.key_results ?? []).map((k: any) => k.id))
      const weeks = getQuarterWeeks(quarter)
      const logs = allKrIds.length ? await getConfidenceLogs(allKrIds, year) : []

      const result: CadenceObjective[] = objs.map((o: any) => {
        const krs: CadenceKeyResult[] = (o.key_results ?? []).map((k: any) => {
          const confidence: (number | null)[] = weeks.map(w => {
            const log = logs.find(l => l.key_result_id === k.id && l.week === w)
            return log ? log.value : null
          })
          return { ...k, confidence }
        })

        const allConf: (number | null)[] = weeks.map((_, wi) => {
          const vals = krs.map(k => k.confidence[wi]).filter((v): v is number => v !== null)
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
        })

        return {
          ...o,
          key_results: krs,
          confidence: allConf,
          progress: objectiveProgress(krs),
        }
      })

      setObjectives(result)
      setLoading(false)
    }

    load()
  }, [cycleId, quarter, year])

  return { objectives, loading, error, setObjectives }
}
