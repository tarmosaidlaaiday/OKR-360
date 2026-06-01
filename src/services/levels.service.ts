import { supabase } from '../lib/supabase'
import type { Level } from '../types/cadence'

export async function getLevels(): Promise<Level[]> {
  const { data, error } = await supabase
    .from('levels')
    .select('id, name, color, position, enabled, org_id')
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as Level[]
}

export async function saveLevels(levels: Level[]): Promise<void> {
  // Upsert all in one call
  const { error } = await supabase
    .from('levels')
    .upsert(levels.map((l, i) => ({ ...l, position: i })))
  if (error) throw error
}

export async function deleteLevel(id: string): Promise<void> {
  const { error } = await supabase.from('levels').delete().eq('id', id)
  if (error) throw error
}
