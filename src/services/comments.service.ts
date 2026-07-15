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

    // Notify the owner of the objective/KR (best-effort, fire-and-forget)
    try {
      let ownerId: string | null = null
      let actionUrl = '/objectives'
      if (input.objective_id) {
        const { data: obj } = await supabase
          .from('objectives').select('owner_id').eq('id', input.objective_id).single()
        ownerId = (obj as any)?.owner_id ?? null
        actionUrl = '/objectives'
      } else if (input.key_result_id) {
        const { data: kr } = await supabase
          .from('key_results').select('owner_id').eq('id', input.key_result_id).single()
        ownerId = (kr as any)?.owner_id ?? null
        actionUrl = '/objectives'
      } else if (input.kpi_id) {
        const { data: kpi } = await supabase
          .from('kpis').select('owner_id').eq('id', input.kpi_id).single()
        ownerId = (kpi as any)?.owner_id ?? null
        actionUrl = '/kpis'
      }
      if (ownerId && ownerId !== input.author_id) {
        const entity = input.objective_id ? 'objective' : input.key_result_id ? 'key result' : 'KPI'
        await supabase.rpc('send_notification', {
          p_person_id:  ownerId,
          p_type:       'comment_added',
          p_title:      `New comment on your ${entity}`,
          p_body:       input.body.length > 120 ? input.body.slice(0, 117) + '…' : input.body,
          p_action_url: actionUrl,
          p_metadata:   null,
        })
      }
    } catch { /* best-effort — don't fail the comment creation */ }

    return data as unknown as Comment
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('comments').delete().eq('id', id)
    if (error) throw error
  },
}
