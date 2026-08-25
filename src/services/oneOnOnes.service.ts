import { supabase } from '../lib/supabase'
import type { OneOnOne, OneOnOneEntry, Person } from '../types/cadence'

function profileToPerson(p: any): Person {
  if (!p) return { id: '', name: '—', role: '', initials: '?', color: '#888' }
  const parts = (p.full_name ?? '').trim().split(/\s+/)
  const initials = parts.slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('')
  return {
    id: p.id,
    name: p.full_name ?? '—',
    role: p.job_title ?? p.role ?? '',
    initials,
    color: p.color ?? '#888',
    avatar_url: p.avatar_url ?? null,
  }
}

// ── Reports (people in my units where I'm admin/lead) ─────────────────────

export async function getMyReports(userId: string): Promise<Person[]> {
  // Intentionally unit-scoped: we want only people who actually report to this
  // user in a specific unit, not everyone in the org. A global admin is not
  // automatically a line-manager of every person — do NOT replace with
  // isOrgOrUnitAdmin() here.
  const { data: myUnits } = await supabase
    .from('people_units')
    .select('unit_id')
    .eq('person_id', userId)
    .in('role', ['admin', 'lead'])

  const unitIds = (myUnits ?? []).map((m: any) => m.unit_id)
  if (unitIds.length === 0) return []

  // Get members (non-admin/lead) of those units who are not me
  const { data: members } = await supabase
    .from('people_units')
    .select('person_id, person:profiles!person_id(id, full_name, avatar_url, color, job_title)')
    .in('unit_id', unitIds)
    .in('role', ['member', 'contributor'])
    .neq('person_id', userId)

  // Deduplicate by person_id
  const seen = new Set<string>()
  return ((members ?? []) as any[])
    .filter((m: any) => m.person && !seen.has(m.person_id) && seen.add(m.person_id))
    .map((m: any) => profileToPerson(m.person))
}

// ── My manager (for reports who have no direct reports) ────────────────────

export async function getMyManager(userId: string): Promise<Person | null> {
  // Find units where I'm a member, get the admin/lead
  const { data: myUnits } = await supabase
    .from('people_units')
    .select('unit_id')
    .eq('person_id', userId)
    .in('role', ['member', 'contributor'])
    .eq('is_primary', true)
    .limit(1)

  if (!myUnits || myUnits.length === 0) return null
  const unitId = (myUnits[0] as any).unit_id

  // Intentionally unit-scoped: we want the actual lead of this person's primary
  // unit, not just any global admin. Do NOT replace with isOrgOrUnitAdmin().
  const { data: leads } = await supabase
    .from('people_units')
    .select('person:profiles!person_id(id, full_name, avatar_url, color, job_title)')
    .eq('unit_id', unitId)
    .in('role', ['admin', 'lead'])
    .neq('person_id', userId)
    .limit(1)

  const lead = (leads ?? [])[0] as any
  return lead?.person ? profileToPerson(lead.person) : null
}

// ── Everyone the current user has any one_on_ones row with ───────────────

export async function getOneOnOnePartners(userId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('one_on_ones')
    .select(`
      manager_id, report_id,
      manager:profiles!manager_id(id, full_name, avatar_url, color, job_title),
      report:profiles!report_id(id, full_name, avatar_url, color, job_title)
    `)
    .or(`manager_id.eq.${userId},report_id.eq.${userId}`)
  if (error) throw error
  const seen = new Map<string, Person>()
  for (const row of (data ?? []) as any[]) {
    const other = row.manager_id === userId ? row.report : row.manager
    if (other && !seen.has(other.id)) seen.set(other.id, profileToPerson(other))
  }
  return Array.from(seen.values())
}

// ── Sessions for a pair ───────────────────────────────────────────────────

export async function getSessionsForPair(
  userId: string,
  otherId: string,
): Promise<OneOnOne[]> {
  const { data, error } = await supabase
    .from('one_on_ones')
    .select(`
      id, manager_id, report_id, scheduled_at, status, cycle_id,
      happiness, done, summary,
      next_date:meeting_date,
      manager:profiles!manager_id(id, full_name, avatar_url, color, job_title),
      report:profiles!report_id(id, full_name, avatar_url, color, job_title),
      entry:one_on_one_entries(
        id, one_on_one_id,
        personal_highlight, professional_highlight,
        personal_low, professional_low,
        work_wins, work_blockers, work_needs_manager, work_topics,
        feedback_for_report, feedback_from_report,
        happiness, happiness_followup, submitted_at,
        employee_submitted_at, manager_submitted_at, last_saved_at
      )
    `)
    .or(
      `and(manager_id.eq.${userId},report_id.eq.${otherId}),` +
      `and(manager_id.eq.${otherId},report_id.eq.${userId})`,
    )
    .order('scheduled_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as any[]).map((row: any) => ({
    ...row,
    manager: row.manager ? profileToPerson(row.manager) : null,
    report: row.report ? profileToPerson(row.report) : null,
    // entry is an array from the join — take the first one
    entry: Array.isArray(row.entry) ? (row.entry[0] ?? null) : (row.entry ?? null),
  })) as OneOnOne[]
}

// ── Create draft session ──────────────────────────────────────────────────

export async function createDraftSession(
  managerId: string,
  reportId: string,
): Promise<string> {
  const scheduledAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('one_on_ones')
    .insert({
      manager_id: managerId,
      report_id: reportId,
      scheduled_at: scheduledAt,
      status: 'draft',
      done: false,
    })
    .select('id')
    .single()
  if (error) throw error

  // Create the entry row
  await supabase.from('one_on_one_entries').insert({ one_on_one_id: data.id })

  // Create a "Submit 1:1 prep" task assigned to the report (best-effort)
  try {
    const { data: managerProfile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', managerId)
      .single()

    if (managerProfile?.org_id) {
      // Due the day before the meeting so prep arrives before the session
      const dueDate = new Date(new Date(scheduledAt).getTime() - 86400000).toISOString().slice(0, 10)
      const dateLabel = new Date(scheduledAt).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short',
      })
      await supabase.from('personal_tasks').insert({
        org_id: managerProfile.org_id,
        title: `Submit 1:1 prep for ${dateLabel}`,
        assignee_id: reportId,
        created_by: managerId,
        due_date: dueDate,
        one_on_one_id: data.id,
      })
    }
  } catch { /* best-effort — don't block session creation */ }

  return data.id
}

// ── Upsert entry fields (auto-save) ───────────────────────────────────────

export async function upsertEntry(
  oneOnOneId: string,
  fields: Partial<OneOnOneEntry>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('one_on_one_entries')
    .select('id')
    .eq('one_on_one_id', oneOnOneId)
    .single()

  if (existing) {
    await supabase
      .from('one_on_one_entries')
      .update({ ...fields, last_saved_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabase
      .from('one_on_one_entries')
      .insert({ one_on_one_id: oneOnOneId, ...fields, last_saved_at: new Date().toISOString() })
  }
}

// ── Submit session ────────────────────────────────────────────────────────

export async function submitSession(
  oneOnOneId: string,
  _submitterId: string,
  otherId: string,
  otherName: string,
  isManager: boolean,
): Promise<void> {
  const now = new Date().toISOString()

  // Determine which one_on_ones row this is to confirm the caller's role
  // (isManager is passed by the caller but we trust the trigger for enforcement)
  const roleField = isManager ? 'manager_submitted_at' : 'employee_submitted_at'

  // Mark session done
  await supabase
    .from('one_on_ones')
    .update({ status: 'done', done: true })
    .eq('id', oneOnOneId)

  // Mark entry submitted — set the role-specific timestamp and shared submitted_at
  const { data: entry } = await supabase
    .from('one_on_one_entries')
    .select('id')
    .eq('one_on_one_id', oneOnOneId)
    .single()
  if (entry) {
    await supabase
      .from('one_on_one_entries')
      .update({ [roleField]: now, submitted_at: now, last_saved_at: now })
      .eq('id', (entry as any).id)
  }

  // Mark the "Submit 1:1 prep" personal task done (best-effort)
  try {
    await supabase
      .from('personal_tasks')
      .update({ status: 'done' })
      .eq('one_on_one_id', oneOnOneId)
      .like('title', 'Submit 1:1 prep for%')
      .neq('status', 'done')
  } catch { /* best-effort */ }

  // Notify the other participant
  try {
    await supabase.rpc('send_notification', {
      p_person_id:  otherId,
      p_type:       'checkin_due',
      p_title:      `${otherName} submitted 1:1 prep`,
      p_body:       null,
      p_action_url: '/1on1s',
      p_metadata:   null,
    })
  } catch { /* best-effort */ }
}

// ── Update entry (past-session edits — no submitted_at, sets updated_at) ─────

export async function updateSessionEntry(
  oneOnOneId: string,
  fields: Partial<OneOnOneEntry>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('one_on_one_entries')
    .select('id')
    .eq('one_on_one_id', oneOnOneId)
    .single()

  if (existing) {
    await supabase
      .from('one_on_one_entries')
      .update({ ...fields, last_saved_at: new Date().toISOString() })
      .eq('id', (existing as any).id)
  } else {
    await supabase
      .from('one_on_one_entries')
      .insert({ one_on_one_id: oneOnOneId, ...fields, last_saved_at: new Date().toISOString() })
  }

  // Track last edit time on the parent row
  await supabase
    .from('one_on_ones')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', oneOnOneId)
}

// ── Duplicate session ─────────────────────────────────────────────────────

export async function duplicateSession(sourceOneOnOneId: string): Promise<string> {
  // 1. Read source row
  const { data: src, error: srcErr } = await supabase
    .from('one_on_ones')
    .select('manager_id, report_id')
    .eq('id', sourceOneOnOneId)
    .single()
  if (srcErr) throw srcErr

  // 2. Read source entry
  const { data: entry } = await supabase
    .from('one_on_one_entries')
    .select('*')
    .eq('one_on_one_id', sourceOneOnOneId)
    .maybeSingle()

  // 3. Pre-generate UUID — avoids RLS timing bugs with .insert().select().single()
  const newId = crypto.randomUUID()

  // 4. Insert new one_on_ones row
  const { error: insErr } = await supabase
    .from('one_on_ones')
    .insert({
      id: newId,
      manager_id: (src as any).manager_id,
      report_id: (src as any).report_id,
      scheduled_at: new Date().toISOString(),
      status: 'draft',
      done: false,
    })
  if (insErr) throw insErr

  // 5. Copy entry (reset happiness + submission fields)
  const e = entry as any
  await supabase.from('one_on_one_entries').insert({
    one_on_one_id: newId,
    work_wins:            e?.work_wins ?? null,
    work_blockers:        e?.work_blockers ?? null,
    work_needs_manager:   e?.work_needs_manager ?? null,
    work_topics:          e?.work_topics ?? null,
    feedback_for_report:  e?.feedback_for_report ?? null,
    feedback_from_report: e?.feedback_from_report ?? null,
    personal_highlight:   e?.personal_highlight ?? null,
    professional_highlight: e?.professional_highlight ?? null,
    personal_low:         e?.personal_low ?? null,
    professional_low:     e?.professional_low ?? null,
    // happiness, happiness_followup, submitted_at left null intentionally
  })

  return newId
}

// ── Delete session (entries cascade via FK) ────────────────────────────────

export async function deleteSession(oneOnOneId: string): Promise<void> {
  const { error } = await supabase.from('one_on_ones').delete().eq('id', oneOnOneId)
  if (error) throw error
}

// ── Reschedule ────────────────────────────────────────────────────────────

export async function updateSchedule(oneOnOneId: string, isoString: string): Promise<void> {
  const { error } = await supabase
    .from('one_on_ones')
    .update({ scheduled_at: isoString })
    .eq('id', oneOnOneId)
  if (error) throw error
}

// ── Activity log ──────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: string
  one_on_one_id: string
  actor_id: string
  actor: { id: string; full_name: string; avatar_url: string | null; color: string | null }
  description: string
  created_at: string
}

export async function logActivity(
  oneOnOneId: string,
  actorId: string,
  description: string,
): Promise<void> {
  const { error } = await supabase
    .from('one_on_one_activity')
    .insert({ one_on_one_id: oneOnOneId, actor_id: actorId, description })
  if (error) throw error
}

export async function getActivityFeed(oneOnOneId: string): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('one_on_one_activity')
    .select('id, one_on_one_id, actor_id, description, created_at, actor:profiles!actor_id(id, full_name, avatar_url, color)')
    .eq('one_on_one_id', oneOnOneId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as unknown as ActivityEntry[]
}

// ── Legacy helpers kept for backward compat ────────────────────────────────

export async function getOneOnOnes(userId: string): Promise<OneOnOne[]> {
  const { data, error } = await supabase
    .from('one_on_ones')
    .select(`
      id, manager_id, report_id, scheduled_at, status, done, happiness, summary,
      next_date:meeting_date,
      report:profiles!report_id(id, full_name, avatar_url, color, job_title),
      manager:profiles!manager_id(id, full_name, avatar_url, color, job_title)
    `)
    .or(`manager_id.eq.${userId},report_id.eq.${userId}`)
    .order('scheduled_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map((row: any) => ({
    ...row,
    manager: row.manager ? profileToPerson(row.manager) : null,
    report: row.report ? profileToPerson(row.report) : null,
    entry: null,
    cycle_id: row.cycle_id ?? null,
  })) as OneOnOne[]
}

export async function updateOneOnOne(id: string, patch: Partial<OneOnOne>): Promise<void> {
  const { error } = await supabase.from('one_on_ones').update(patch).eq('id', id)
  if (error) throw error
}
