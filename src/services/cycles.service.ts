import { supabase } from '../lib/supabase'
import type { Cycle } from '../types'

export const cyclesService = {
  async getAll(): Promise<Cycle[]> {
    const { data, error } = await supabase
      .from('cycles')
      .select('*')
      .order('year', { ascending: true })
      .order('quarter', { ascending: true })

    if (error) throw error
    return data ?? []
  },
}

// Returns ALL cycle IDs that are active for today's date. Multiple cycles
// can be simultaneously active at different granularities (Year, Half,
// Quarter). Using the full set means queries work regardless of which
// specific granularity an objective happens to be tagged to.
export async function getActiveCycleIds(): Promise<string[]> {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('cycles')
    .select('id')
    .eq('status', 'active')
    .lte('start_date', today)
    .gte('end_date', today)
  if (error) throw error
  return (data ?? []).map((c: any) => c.id as string)
}
