import { supabase } from '../lib/supabase'
import { createPersonalTask } from './personalTasks.service'
import type {
  TeamMeeting,
  TeamMeetingParticipant,
  TeamMeetingCommitment,
  TeamMeetingRecurrence,
  Unit,
} from '../types/cadence'

// ── Selectors ─────────────────────────────────────────────────────────────────

const MEETING_SELECT = `
  id, unit_id, org_id, cycle_id, scheduled_at, recurrence, status, plan_notes, created_by, created_at,
  unit:units!unit_id(id, name)
`

const PARTICIPANT_SELECT = `
  id, team_meeting_id, person_id,
  person:profiles!person_id(id, full_name, avatar_url, color)
`

const COMMITMENT_SELECT = `
  id, team_meeting_id, person_id, description, linked_task_id, carried_forward_from_id, created_at,
  person:profiles!person_id(id, full_name, avatar_url, color),
  linked_task:personal_tasks!linked_task_id(id, status, title),
  carried_forward_from:team_meeting_commitments!carried_forward_from_id(id, team_meeting_id, description)
`

function normalise<T>(row: any): T {
  // Supabase returns FK joins as arrays when aliased — flatten to single object
  const out: any = { ...row }
  for (const key of ['unit', 'person', 'linked_task', 'carried_forward_from']) {
    if (Array.isArray(out[key])) out[key] = out[key][0] ?? null
  }
  return out as T
}

// ── Recurrence helpers ────────────────────────────────────────────────────────

export function nextScheduledAt(scheduledAt: string, recurrence: TeamMeetingRecurrence): string {
  const d = new Date(scheduledAt)
  switch (recurrence) {
    case 'weekly':   d.setDate(d.getDate() + 7);   break
    case 'biweekly': d.setDate(d.getDate() + 14);  break
    case 'monthly':  d.setMonth(d.getMonth() + 1); break
  }
  return d.toISOString()
}

// ── Unit queries ──────────────────────────────────────────────────────────────

/** Units where the given user holds admin or lead role — used to gate the "New meeting" UI. */
export async function getLeadableUnits(userId: string): Promise<Unit[]> {
  const { data, error } = await supabase
    .from('people_units')
    .select('unit:units!unit_id(id, name, level_id, parent_id, position, org_id)')
    .eq('person_id', userId)
    .in('role', ['admin', 'lead'])
  if (error) throw error
  return ((data ?? []) as any[])
    .map(row => (Array.isArray(row.unit) ? row.unit[0] : row.unit))
    .filter(Boolean) as Unit[]
}

/** Whether the user is global admin OR lead/admin of a specific unit. */
export async function canManageUnit(userId: string, unitId: string): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_global_admin')
    .eq('id', userId)
    .single()
  if (profile?.is_global_admin) return true

  const { data } = await supabase
    .from('people_units')
    .select('id')
    .eq('person_id', userId)
    .eq('unit_id', unitId)
    .in('role', ['admin', 'lead'])
    .limit(1)
  return (data ?? []).length > 0
}

// ── Meeting CRUD ──────────────────────────────────────────────────────────────

export async function getMeetingsForUnit(unitId: string): Promise<TeamMeeting[]> {
  const { data, error } = await supabase
    .from('team_meetings')
    .select(MEETING_SELECT)
    .eq('unit_id', unitId)
    .order('scheduled_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map(r => normalise<TeamMeeting>(r))
}

export async function getMeeting(meetingId: string): Promise<TeamMeeting | null> {
  const { data, error } = await supabase
    .from('team_meetings')
    .select(MEETING_SELECT)
    .eq('id', meetingId)
    .single()
  if (error) return null
  return normalise<TeamMeeting>(data)
}

export async function createMeeting(params: {
  unitId: string
  orgId: string
  cycleId: string | null
  scheduledAt: string
  recurrence: TeamMeetingRecurrence
  createdBy: string
}): Promise<TeamMeeting> {
  const { data, error } = await supabase
    .from('team_meetings')
    .insert({
      unit_id:      params.unitId,
      org_id:       params.orgId,
      cycle_id:     params.cycleId,
      scheduled_at: params.scheduledAt,
      recurrence:   params.recurrence,
      created_by:   params.createdBy,
    })
    .select(MEETING_SELECT)
    .single()
  if (error) throw error
  return normalise<TeamMeeting>(data)
}

export async function updateMeeting(
  meetingId: string,
  fields: Partial<Pick<TeamMeeting, 'scheduled_at' | 'recurrence' | 'status' | 'plan_notes' | 'cycle_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('team_meetings')
    .update(fields)
    .eq('id', meetingId)
  if (error) throw error
}

/**
 * Mark a meeting as completed and, if recurring, auto-create the next occurrence
 * with the same participant list. Returns the newly created next meeting id (or null).
 */
export async function completeMeeting(
  meeting: TeamMeeting,
  currentUserId: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('team_meetings')
    .update({ status: 'completed' })
    .eq('id', meeting.id)
  if (error) throw error

  if (meeting.recurrence === 'none') return null

  // Fetch current participant list
  const { data: participants } = await supabase
    .from('team_meeting_participants')
    .select('person_id')
    .eq('team_meeting_id', meeting.id)

  // Create next occurrence
  const nextAt = nextScheduledAt(meeting.scheduled_at, meeting.recurrence)
  const { data: nextMeeting, error: nextError } = await supabase
    .from('team_meetings')
    .insert({
      unit_id:      meeting.unit_id,
      org_id:       meeting.org_id,
      cycle_id:     meeting.cycle_id,
      scheduled_at: nextAt,
      recurrence:   meeting.recurrence,
      status:       'scheduled',
      created_by:   currentUserId,
    })
    .select('id')
    .single()
  if (nextError) throw nextError

  if (nextMeeting && (participants ?? []).length > 0) {
    await supabase
      .from('team_meeting_participants')
      .insert(
        (participants as { person_id: string }[]).map(p => ({
          team_meeting_id: nextMeeting.id,
          person_id: p.person_id,
        }))
      )
  }

  return nextMeeting?.id ?? null
}

// ── Participants ──────────────────────────────────────────────────────────────

export async function getParticipants(meetingId: string): Promise<TeamMeetingParticipant[]> {
  const { data, error } = await supabase
    .from('team_meeting_participants')
    .select(PARTICIPANT_SELECT)
    .eq('team_meeting_id', meetingId)
  if (error) throw error
  return ((data ?? []) as any[]).map(r => normalise<TeamMeetingParticipant>(r))
}

export async function addParticipant(meetingId: string, personId: string): Promise<void> {
  const { error } = await supabase
    .from('team_meeting_participants')
    .insert({ team_meeting_id: meetingId, person_id: personId })
  if (error && !error.message.includes('duplicate')) throw error
}

export async function removeParticipant(meetingId: string, personId: string): Promise<void> {
  const { error } = await supabase
    .from('team_meeting_participants')
    .delete()
    .eq('team_meeting_id', meetingId)
    .eq('person_id', personId)
  if (error) throw error
}

/**
 * Auto-populate participants from the unit's current people_units members.
 * Called right after createMeeting.
 */
export async function autoPopulateParticipants(meetingId: string, unitId: string): Promise<void> {
  const { data: members, error } = await supabase
    .from('people_units')
    .select('person_id')
    .eq('unit_id', unitId)
  if (error) throw error

  if (!members || members.length === 0) return

  const rows = members.map((m: { person_id: string }) => ({
    team_meeting_id: meetingId,
    person_id: m.person_id,
  }))
  // Use upsert to be idempotent; UNIQUE constraint prevents duplicates
  const { error: insError } = await supabase
    .from('team_meeting_participants')
    .upsert(rows, { onConflict: 'team_meeting_id,person_id' })
  if (insError) throw insError
}

// ── Commitments ───────────────────────────────────────────────────────────────

export async function getCommitments(meetingId: string): Promise<TeamMeetingCommitment[]> {
  const { data, error } = await supabase
    .from('team_meeting_commitments')
    .select(COMMITMENT_SELECT)
    .eq('team_meeting_id', meetingId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as any[]).map(r => normalise<TeamMeetingCommitment>(r))
}

export async function addCommitment(params: {
  meetingId: string
  meeting: TeamMeeting
  personId: string
  description: string
  orgId: string
  currentUserId: string
}): Promise<TeamMeetingCommitment> {
  // Compute due_date: one day before the next occurrence (if recurring)
  let dueDate: string | null = null
  if (params.meeting.recurrence !== 'none') {
    const next = new Date(nextScheduledAt(params.meeting.scheduled_at, params.meeting.recurrence))
    next.setDate(next.getDate() - 1)
    dueDate = next.toISOString().split('T')[0]
  }

  // Create the personal_tasks row (reuses existing function, shows on Tasks page)
  const task = await createPersonalTask({
    org_id:      params.orgId,
    title:       params.description,
    assignee_id: params.personId,
    created_by:  params.currentUserId,
    due_date:    dueDate,
  })

  // Create commitment row linking to the task
  const { data, error } = await supabase
    .from('team_meeting_commitments')
    .insert({
      team_meeting_id: params.meetingId,
      person_id:       params.personId,
      description:     params.description,
      linked_task_id:  task.id,
    })
    .select(COMMITMENT_SELECT)
    .single()
  if (error) throw error
  return normalise<TeamMeetingCommitment>(data)
}

/**
 * Carry an unresolved commitment forward into the current meeting.
 * Creates a new commitment row with carried_forward_from_id set.
 * Also creates a new personal_tasks row for the current meeting's timeline.
 */
export async function carryForwardCommitment(params: {
  fromCommitment: TeamMeetingCommitment
  toMeetingId: string
  toMeeting: TeamMeeting
  description: string   // editable before confirming
  orgId: string
  currentUserId: string
}): Promise<TeamMeetingCommitment> {
  let dueDate: string | null = null
  if (params.toMeeting.recurrence !== 'none') {
    const next = new Date(nextScheduledAt(params.toMeeting.scheduled_at, params.toMeeting.recurrence))
    next.setDate(next.getDate() - 1)
    dueDate = next.toISOString().split('T')[0]
  }

  const task = await createPersonalTask({
    org_id:      params.orgId,
    title:       params.description,
    assignee_id: params.fromCommitment.person_id,
    created_by:  params.currentUserId,
    due_date:    dueDate,
  })

  const { data, error } = await supabase
    .from('team_meeting_commitments')
    .insert({
      team_meeting_id:         params.toMeetingId,
      person_id:               params.fromCommitment.person_id,
      description:             params.description,
      linked_task_id:          task.id,
      carried_forward_from_id: params.fromCommitment.id,
    })
    .select(COMMITMENT_SELECT)
    .single()
  if (error) throw error
  return normalise<TeamMeetingCommitment>(data)
}

// ── Previous meeting ──────────────────────────────────────────────────────────

/**
 * Returns the most recent completed meeting for the same unit, strictly before
 * the current meeting's scheduled_at. Used to populate the "previous meeting" panel.
 */
export async function getPreviousMeeting(
  unitId: string,
  beforeIso: string,
): Promise<TeamMeeting | null> {
  const { data, error } = await supabase
    .from('team_meetings')
    .select(MEETING_SELECT)
    .eq('unit_id', unitId)
    .eq('status', 'completed')
    .lt('scheduled_at', beforeIso)
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data ? normalise<TeamMeeting>(data) : null
}
