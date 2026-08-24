import { supabase } from '../lib/supabase'

export interface TaskAttachment {
  id: string
  kr_task_id: string | null
  personal_task_id: string | null
  file_name: string
  file_url: string
  uploaded_by: string
  created_at: string
}

const BUCKET = 'task-attachments'

const SELECT = 'id, kr_task_id, personal_task_id, file_name, file_url, uploaded_by, created_at'

export async function getTaskAttachments(
  taskId: string,
  source: 'kr' | 'personal',
): Promise<TaskAttachment[]> {
  const col = source === 'kr' ? 'kr_task_id' : 'personal_task_id'
  const { data, error } = await supabase
    .from('task_attachments')
    .select(SELECT)
    .eq(col, taskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as TaskAttachment[]
}

export async function uploadTaskAttachment(
  taskId: string,
  source: 'kr' | 'personal',
  file: File,
  uploadedBy: string,
): Promise<TaskAttachment> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `${taskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false })
  if (uploadError) throw uploadError

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const file_url = urlData.publicUrl

  const col = source === 'kr' ? 'kr_task_id' : 'personal_task_id'
  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      [col]: taskId,
      file_name: file.name,
      file_url,
      uploaded_by: uploadedBy,
    })
    .select(SELECT)
    .single()
  if (error) throw error
  return data as TaskAttachment
}

export async function deleteTaskAttachment(attachmentId: string): Promise<void> {
  const { error } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachmentId)
  if (error) throw error
}
