import { supabase } from '../lib/supabase'
import type { Unit, Level } from '../types/cadence'

export async function getUnits(): Promise<Unit[]> {
  const { data, error } = await supabase
    .from('units')
    .select('id, name, level_id, parent_id, position, org_id')
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as Unit[]
}

export async function saveUnits(units: Unit[]): Promise<void> {
  const { error } = await supabase
    .from('units')
    .upsert(units.map((u, i) => ({ ...u, position: i })))
  if (error) {
    console.error('[saveUnits] failed', { message: error.message, code: (error as any).code, hint: (error as any).hint })
    throw new Error(error.message)
  }
}

export async function deleteUnit(id: string): Promise<void> {
  // Children will have parent_id set to null by DB cascade
  const { error } = await supabase.from('units').delete().eq('id', id)
  if (error) throw error
}

export async function createUnit(unit: Omit<Unit, 'id'>): Promise<Unit> {
  const { data, error } = await supabase
    .from('units')
    .insert(unit)
    .select()
    .single()
  if (error) {
    console.error('[createUnit] failed', {
      payload: unit,
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
    })
    throw new Error(error.message)
  }
  return data as Unit
}

export async function getUnit(unitId: string): Promise<Unit & { level?: Level }> {
  const { data, error } = await supabase
    .from('units')
    .select('id, name, level_id, parent_id, position, level:levels(id, name, color, position, enabled)')
    .eq('id', unitId)
    .single()
  if (error) throw error
  return data as unknown as Unit & { level?: Level }
}
