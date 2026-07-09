import { supabase } from '../lib/supabase'
import type { Comment } from '../types'

const SELECT = 'id, org_id, author_id, objective_id, key_result_id, kpi_id, body, created_at, updated_at, author:profiles(full_name, avatar_url)'

export const commentsService = {
  async getByObjective(objectiveId: string): Promise<Comment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select(SELECT)
      .eq('objective_id', objectiveId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as Comment[]
  },

  async getByKR(krId: string): Promise<Comment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select(SELECT)
      .eq('key_result_id', krId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as Comment[]
  },

  async getByKPI(kpiId: string): Promise<Comment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select(SELECT)
      .eq('kpi_id', kpiId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as Comment[]
  },

  async create(input: {
    body: string
    objective_id?: string
    key_result_id?: string
    kpi_id?: string
    author_id: string
  }): Promise<Comment> {
    const { data, error } = await supabase
      .from('comments')
      .insert(input)
      .select(SELECT)
      .single()
    if (error) throw error
    return data as unknown as Comment
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) throw error
  },
}
