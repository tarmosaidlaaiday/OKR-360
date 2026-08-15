import { supabase } from '../lib/supabase'
import type { PersonalTask, KrTaskStatus, UnifiedTask } from '../types/cadence'

// ── Helpers ───────────────────────────────────────────────────────────────

function normaliseAssignee(row: any) {
  return {
    ...row,
    assignee: Array.isArray(row.assignee) ? (row.assignee[0] ?? null) : row.assignee,
  }
}

const PERSONAL_SELECT = `
  id, org_id, title, status, due_date, assignee_id, created_by,
  one_on_one_id, created_at, updated_at,
  assignee:profiles!assignee_id(id, full_name, avatar_url, color)
`

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function getPersonalTasks(assigneeId: string): Promise<PersonalTask[]> {
  const { data, error } = await supabase
    .from('personal_tasks')
    .select(PERSONAL_SELECT)
    .eq('assignee_id', assigneeId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(normaliseAssignee) as unknown as PersonalTask[]
}

export async function createPersonalTask(task: {
  org_id: string
  title: string
  assignee_id: string
  created_by: string
  due_date?: string | null
  one_on_one_id?: string | null
}): Promise<PersonalTask> {
  const { data, error } = await supabase
    .from('personal_tasks')
    .insert(task)
    .select(PERSONAL_SELECT)
    .single()
  if (error) throw error
  return normaliseAssignee(data) as unknown as PersonalTask
}

export async function updatePersonalTaskStatus(id: string, status: KrTaskStatus): Promise<void> {
  const { error } = await supabase
    .from('personal_tasks')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function deletePersonalTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('personal_tasks')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Unified aggregation ───────────────────────────────────────────────────
// Combines personal_tasks + kr_tasks for a given assignee into one sorted list.
// The frontend calls this single function rather than juggling two queries.

export async function getMyAllTasks(userId: string): Promise<UnifiedTask[]> {
  const [personalResult, krResult] = await Promise.all([
    supabase
      .from('personal_tasks')
      .select(`
        id, title, status, due_date, assignee_id, one_on_one_id,
        assignee:profiles!assignee_id(id, full_name, avatar_url, color),
        one_on_one:one_on_ones!one_on_one_id(
          id, scheduled_at, manager_id, report_id,
          manager:profiles!manager_id(id, full_name),
          report:profiles!report_id(id, full_name)
        )
      `)
      .eq('assignee_id', userId),

    supabase
      .from('kr_tasks')
      .select(`
        id, title, status, due_date, assignee_id, key_result_id,
        assignee:profiles!assignee_id(id, full_name, avatar_url, color),
        key_result:key_results!key_result_id(
          id, title,
          objective:objectives!objective_id(id, title)
        )
      `)
      .eq('assignee_id', userId),
  ])

  if (personalResult.error) throw personalResult.error
  if (krResult.error) throw krResult.error

  const personal: UnifiedTask[] = ((personalResult.data ?? []) as any[]).map(row => {
    const assignee = Array.isArray(row.assignee) ? (row.assignee[0] ?? null) : row.assignee
    const oo = Array.isArray(row.one_on_one) ? (row.one_on_one[0] ?? null) : row.one_on_one

    let source_label = 'Personal'
    if (oo) {
      const me = row.assignee_id
      const otherRaw = oo.manager_id === me ? oo.report : oo.manager
      const other = Array.isArray(otherRaw) ? (otherRaw[0] ?? null) : otherRaw
      const otherName: string = other?.full_name ?? 'someone'
      const date = oo.scheduled_at
        ? new Date(oo.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : ''
      source_label = `1:1 with ${otherName}${date ? `, ${date}` : ''}`
    }

    return {
      id: row.id,
      source: 'personal' as const,
      title: row.title,
      status: row.status as KrTaskStatus,
      due_date: row.due_date ?? null,
      assignee_id: row.assignee_id,
      assignee,
      source_label,
      one_on_one_id: row.one_on_one_id ?? null,
    }
  })

  const kr: UnifiedTask[] = ((krResult.data ?? []) as any[]).map(row => {
    const assignee = Array.isArray(row.assignee) ? (row.assignee[0] ?? null) : row.assignee
    const krRow = Array.isArray(row.key_result) ? (row.key_result[0] ?? null) : row.key_result
    const objRow = krRow
      ? (Array.isArray(krRow.objective) ? (krRow.objective[0] ?? null) : krRow.objective)
      : null

    const krTitle: string = krRow?.title ?? 'Key result'
    const objTitle: string = objRow?.title ?? ''
    const source_label = objTitle ? `${objTitle} · ${krTitle}` : krTitle

    return {
      id: row.id,
      source: 'kr' as const,
      title: row.title,
      status: row.status as KrTaskStatus,
      due_date: row.due_date ?? null,
      assignee_id: row.assignee_id,
      assignee,
      source_label,
      key_result_id: row.key_result_id,
    }
  })

  // Merge and sort: tasks with due_date first (ascending), then no-date tasks
  const all = [...personal, ...kr]
  all.sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
  })
  return all
}
