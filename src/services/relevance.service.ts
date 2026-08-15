import { supabase } from '../lib/supabase'

export interface RelevantUnit {
  id: string       // objective_relevant_units row id
  unit_id: string
  unit: { id: string; name: string }
}

export async function getRelevantUnits(objectiveId: string): Promise<RelevantUnit[]> {
  const { data, error } = await supabase
    .from('objective_relevant_units')
    .select('id, unit_id, unit:units(id, name)')
    .eq('objective_id', objectiveId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as RelevantUnit[]
}

// Batch fetch for multiple objectives at once (used by CascadePage to avoid N+1)
export async function getRelevantUnitsForObjectives(
  objectiveIds: string[],
): Promise<Map<string, RelevantUnit[]>> {
  if (objectiveIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('objective_relevant_units')
    .select('id, objective_id, unit_id, unit:units(id, name)')
    .in('objective_id', objectiveIds)
    .order('created_at', { ascending: true })
  if (error) throw error
  const result = new Map<string, RelevantUnit[]>()
  for (const row of (data ?? []) as any[]) {
    const list = result.get(row.objective_id) ?? []
    list.push({ id: row.id, unit_id: row.unit_id, unit: row.unit })
    result.set(row.objective_id, list)
  }
  return result
}

export async function addRelevantUnit(
  objectiveId: string,
  unitId: string,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('objective_relevant_units')
    .insert({ objective_id: objectiveId, unit_id: unitId, created_by: createdBy })
  if (error) throw error
}

export async function removeRelevantUnit(id: string): Promise<void> {
  const { error } = await supabase
    .from('objective_relevant_units')
    .delete()
    .eq('id', id)
  if (error) throw error
}
