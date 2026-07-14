import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export const profilesService = {
  async getById(id: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return null
    return data
  },

  async update(id: string, input: { full_name?: string; team_id?: string | null; avatar_url?: string | null }): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update(input)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },
}
