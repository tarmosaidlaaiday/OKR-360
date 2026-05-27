import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { objectiveProgress } from '../lib/cadenceUtils'
import type { CadenceObjective } from '../types/cadence'

async function fetchObjective(id: string): Promise<CadenceObjective | null> {
  const { data, error } = await supabase
    .from('objectives')
    .select(`
      id, title, status, cycle_id, owner_id,
      team_id, level_id, parent_objective_id,
      owner:profiles!owner_id(id, full_name, avatar_url, color, role),
      level:levels(id, name, depth, color),
      parent_objective:objectives!parent_objective_id(id, title),
      key_results(id, title, target_type, start_value, target_value, current_value, unit, owner_id, confidence)
    `)
    .eq('id', id)
    .single()
  if (error || !data) return null

  const krs = (data.key_results ?? []).map((k: any) => ({
    ...k,
    confidence: [] as (number | null)[],
  }))

  return {
    ...(data as any),
    key_results: krs,
    confidence: [],
    progress: objectiveProgress(krs),
    description: null,
    team: null,
    parent_objective: data.parent_objective ?? null,
  } as CadenceObjective
}

/**
 * Walks the parent_objective chain starting from `objectiveId`, upward.
 * Returns the chain from root → given objective (max 5 hops to avoid loops).
 */
export function useCascadeChain(objectiveId: string | null) {
  const [chain, setChain] = useState<CadenceObjective[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!objectiveId) { setChain([]); return }
    setLoading(true)

    async function walk() {
      const result: CadenceObjective[] = []
      let currentId: string | null = objectiveId
      const seen = new Set<string>()

      while (currentId && result.length < 6) {
        if (seen.has(currentId)) break
        seen.add(currentId)
        const obj = await fetchObjective(currentId)
        if (!obj) break
        result.unshift(obj)  // prepend so chain goes root→leaf
        currentId = obj.parent_objective_id
      }

      setChain(result)
      setLoading(false)
    }

    walk()
  }, [objectiveId])

  return { chain, loading }
}
