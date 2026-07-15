import { supabase } from '../lib/supabase'
import type { KrTask, KrTaskStatus } from '../types/cadence'

const SELECT = `
  id, key_result_id, title, status, due_date, assignee_id, created_by, created_at,
  assignee:profiles!assignee_id(id, full_name, avatar_url, color)
`

function normalise(row: any): KrTask {
  return { ...row, assignee: Array.isArray(row.assignee) ? (row.assignee[0] ?? null) : row.assignee }
}

export async function getKrTasks(keyResultId: string): Promise<KrTask[]> {
  const { data, error } = await supabase
    .from('kr_tasks')
    .select(SELECT)
    .eq('key_result_id', keyResultId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(normalise)
}

export async function createKrTask(
  keyResultId: string,
  title: string,
  createdBy: string,
  assigneeId?: string | null,
  dueDate?: string | null,
): Promise<KrTask> {
  const { data, error } = await supabase
    .from('kr_tasks')
    .insert({
      key_result_id: keyResultId,
      title,
      created_by: createdBy,
      assignee_id: assigneeId ?? null,
      due_date: dueDate ?? null,
    })
    .select(SELECT)
    .single()
  if (error) throw error
  const task = normalise(data)

  // Notify the assignee if they're not the creator (best-effort)
  if (assigneeId && assigneeId !== createdBy) {
    try {
      await supabase.rpc('send_notification', {
        p_person_id:  assigneeId,
        p_type:       'task_assigned',
        p_title:      'A task was assigned to you',
        p_body:       title,
        p_action_url: '/objectives',
        p_metadata:   null,
      })
    } catch { /* best-effort */ }
  }

  return task
}

export async function updateKrTask(
  taskId: string,
  fields: Partial<Pick<KrTask, 'title' | 'assignee_id' | 'due_date'>>,
): Promise<void> {
  const { error } = await supabase
    .from('kr_tasks')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

export async function updateKrTaskStatus(taskId: string, status: KrTaskStatus): Promise<void> {
  const { error } = await supabase
    .from('kr_tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

export async function deleteKrTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('kr_tasks')
    .delete()
    .eq('id', taskId)
  if (error) throw error
}
