import { useEffect, useState } from 'react'
import { getUnit } from '../services/units.service'
import { getUnitMembers } from '../services/peopleUnits.service'
import { supabase } from '../lib/supabase'
import { objectiveProgress } from '../lib/cadenceUtils'
import type { Unit, Level, PeopleUnit, CadenceObjective, CadenceKeyResult } from '../types/cadence'

export function useUnitDetail(unitId: string | null) {
  const [unit, setUnit] = useState<(Unit & { level?: Level }) | null>(null)
  const [members, setMembers] = useState<PeopleUnit[]>([])
  const [objectives, setObjectives] = useState<CadenceObjective[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!unitId) { setUnit(null); setMembers([]); setObjectives([]); return }
    setLoading(true)

    async function load() {
      const [unitData, memberData] = await Promise.all([
        getUnit(unitId!),
        getUnitMembers(unitId!),
      ])
      setUnit(unitData)
      setMembers(memberData)

      // Get member IDs and fetch their objectives
      const memberIds = memberData.map(m => m.person_id)
      if (memberIds.length > 0) {
        const { data: objs } = await supabase
          .from('objectives')
          .select(`
            id, title, status, cycle_id, owner_id,
            unit_id, level_id, parent_objective_id,
            owner:profiles!owner_id(id, full_name, avatar_url, color, role),
            unit:units(id, name, color),
            level:levels(id, name, depth, color),
            parent_objective:objectives!parent_objective_id(id, title),
            key_results(id, title, target_type, start_value, target_value, current_value, unit, owner_id, confidence)
          `)
          .in('owner_id', memberIds)
          .order('created_at', { ascending: false })
          .limit(50)

        const mapped: CadenceObjective[] = (objs ?? []).map((o: any) => {
          const krs: CadenceKeyResult[] = (o.key_results ?? []).map((k: any) => ({
            ...k,
            confidence: [] as (number | null)[],
          }))
          return {
            ...o,
            description: null,
            key_results: krs,
            confidence: [],
            progress: objectiveProgress(krs),
          } as CadenceObjective
        })
        setObjectives(mapped)
      } else {
        setObjectives([])
      }

      setLoading(false)
    }

    load().catch(err => { console.error(err); setLoading(false) })
  }, [unitId])

  return { unit, members, objectives, loading }
}
