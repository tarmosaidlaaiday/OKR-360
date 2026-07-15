import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { supabase } from '../lib/supabase'

export interface OrgBreadcrumb {
  id: string
  name: string
  levelName?: string
  levelColor?: string
}

/**
 * Returns the current user's position in the org hierarchy as a breadcrumb
 * array ordered from topmost to the user's primary unit.
 * Returns [] if the user has no unit membership.
 */
export function useMyOrgPosition(): OrgBreadcrumb[] {
  const { user } = useAuth()
  const { units, levels } = useOrg()
  const [primaryUnitId, setPrimaryUnitId] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    supabase
      .from('people_units')
      .select('unit_id, is_primary')
      .eq('person_id', user.id)
      .order('is_primary', { ascending: false }) // primary first
      .limit(1)
      .then(({ data }) => {
        const row = (data ?? [])[0] as { unit_id: string } | undefined
        if (row) setPrimaryUnitId(row.unit_id)
      })
  }, [user?.id])

  if (!primaryUnitId || units.length === 0) return []

  const unitMap = new Map(units.map(u => [u.id, u]))
  const levelMap = new Map(levels.map(l => [l.id, l]))

  const chain: OrgBreadcrumb[] = []
  let current = unitMap.get(primaryUnitId)
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const level = current.level_id ? levelMap.get(current.level_id) : undefined
    chain.unshift({
      id: current.id,
      name: current.name,
      levelName: level?.name,
      levelColor: level?.color,
    })
    current = current.parent_id ? unitMap.get(current.parent_id) : undefined
  }

  return chain
}
