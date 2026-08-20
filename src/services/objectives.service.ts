import { supabase } from '../lib/supabase'
import type { Objective, CreateObjectiveInput, UpdateObjectiveInput } from '../types'
import type { CadenceObjective } from '../types/cadence'

const SELECT_OBJECTIVE = `
  id, title, description, owner_id, unit_id, cycle_id, status, created_at, updated_at,
  owner:profiles(id, full_name, avatar_url, team_id),
  unit:units(id, name),
  key_results(id, objective_id, title, target_type, current_value, target_value, unit, created_at, updated_at)
`

// Shared cadence SELECT (used by cadence-aware functions)
const SELECT_CADENCE = `
  id, title, status, cycle_id, owner_id,
  unit_id, level_id, parent_objective_id,
  owner:profiles!owner_id(id, full_name, avatar_url, color, role),
  unit:units(id, name),
  level:levels(id, name, depth, color),
  parent_objective:objectives!parent_objective_id(id, title),
  key_results(id, title, target_type, start_value, target_value, current_value, unit, owner_id, confidence)
`

export const objectivesService = {
  async getByCycle(cycleId: string, unitId?: string | null): Promise<Objective[]> {
    let query = supabase
      .from('objectives')
      .select(SELECT_OBJECTIVE)
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })

    if (unitId) query = query.eq('unit_id', unitId)

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as unknown as Objective[]
  },

  async getByOwner(cycleId: string, ownerId: string): Promise<Objective[]> {
    const { data, error } = await supabase
      .from('objectives')
      .select(SELECT_OBJECTIVE)
      .eq('cycle_id', cycleId)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data ?? []) as unknown as Objective[]
  },

  async getById(id: string): Promise<Objective | null> {
    const { data, error } = await supabase
      .from('objectives')
      .select(SELECT_OBJECTIVE)
      .eq('id', id)
      .single()

    if (error) throw error
    return data as unknown as Objective
  },

  async create(input: CreateObjectiveInput & { owner_id: string }): Promise<Objective> {
    const { data, error } = await supabase
      .from('objectives')
      .insert(input)
      .select(SELECT_OBJECTIVE)
      .single()

    if (error) throw error
    return data as unknown as Objective
  },

  async update(id: string, input: UpdateObjectiveInput): Promise<Objective> {
    const { data, error } = await supabase
      .from('objectives')
      .update(input)
      .eq('id', id)
      .select(SELECT_OBJECTIVE)
      .single()

    if (error) throw error
    return data as unknown as Objective
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('objectives').delete().eq('id', id)
    if (error) throw error
  },
}

// Returns the IDs of all cycles whose date range is fully contained within
// the selected cycle's date range (including the selected cycle itself).
// Used by browsing views so that e.g. "H2 2026" shows Q3+Q4 objectives.
export async function getContainedCycleIds(selectedCycleId: string): Promise<string[]> {
  const { data: selected } = await supabase
    .from('cycles')
    .select('start_date, end_date')
    .eq('id', selectedCycleId)
    .single()

  if (!selected) return [selectedCycleId]

  const { data: cycles } = await supabase
    .from('cycles')
    .select('id')
    .gte('start_date', (selected as any).start_date)
    .lte('end_date', (selected as any).end_date)

  const ids = (cycles ?? []).map((c: any) => c.id as string)
  return ids.length > 0 ? ids : [selectedCycleId]
}

export async function getChildObjectives(objectiveId: string): Promise<CadenceObjective[]> {
  const { data, error } = await supabase
    .from('objectives')
    .select(SELECT_CADENCE)
    .eq('parent_objective_id', objectiveId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as CadenceObjective[]
}
