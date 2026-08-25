import { supabase } from '../lib/supabase'
import { getISOWeek } from '../lib/cadenceUtils'
import type { WeeklyCheckin, CheckinKR, CheckinStreak } from '../types/cadence'

// ── Helpers ───────────────────────────────────────────────────────────────

function currentWeekYear(): { week: number; year: number } {
  const now = new Date()
  return { week: getISOWeek(now), year: now.getFullYear() }
}

// ── Active cycle for check-in (date-derived, ignores global selector) ────

// Returns the most granular cycle that is active today for the caller's org.
// Preference order: quarter > half > year (so weekly check-ins are always
// scoped to the most specific tracking period, not the browsing selector).
const PERIOD_RANK: Record<string, number> = { quarter: 0, half: 1, year: 2 }

async function getCheckinCycle(): Promise<{ id: string; period_type: string } | null> {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('cycles')
    .select('id, period_type')
    .eq('status', 'active')
    .lte('start_date', today)
    .gte('end_date', today)
  if (error) throw error
  if (!data || data.length === 0) return null
  const sorted = [...data].sort(
    (a, b) => (PERIOD_RANK[a.period_type] ?? 9) - (PERIOD_RANK[b.period_type] ?? 9),
  )
  return sorted[0] as { id: string; period_type: string }
}

// ── KRs for stepper ───────────────────────────────────────────────────────

export async function getMyKRsForCheckin(
  userId: string,
): Promise<{ krs: CheckinKR[]; cycleId: string | null }> {
  const cycle = await getCheckinCycle()
  if (!cycle) return { krs: [], cycleId: null }

  const { week, year } = currentWeekYear()
  const prevWeek = week === 1 ? 52 : week - 1
  const prevYear = week === 1 ? year - 1 : year

  const { data, error } = await supabase
    .from('key_results')
    .select(`
      id, objective_id, title, target_type, start_value, target_value,
      current_value, unit, owner_id, confidence,
      owner:profiles!owner_id(id, full_name, avatar_url, color, role),
      objective:objectives!objective_id(
        id, title, cycle_id
      ),
      this_week:checkins(
        id, key_result_id, person_id, week_number, year, cycle_id,
        new_value, confidence, has_blocker, blocker_text, note, submitted_at
      ),
      last_week:checkins(
        id, key_result_id, person_id, week_number, year, cycle_id,
        new_value, confidence, has_blocker, blocker_text, note, submitted_at
      )
    `)
    .eq('owner_id', userId)

  if (error) throw error

  // Filter by the date-derived cycle (not the global browsing selector)
  const krs: CheckinKR[] = []

  for (const kr of (data ?? []) as any[]) {
    const obj = kr.objective
    if (!obj || obj.cycle_id !== cycle.id) continue

    const thisWeek = ((kr.this_week ?? []) as any[]).find(
      (c: any) => c.week_number === week && c.year === year && c.person_id === userId,
    ) ?? null

    const lastWeek = ((kr.last_week ?? []) as any[]).find(
      (c: any) => c.week_number === prevWeek && c.year === prevYear && c.person_id === userId,
    ) ?? null

    krs.push({
      id: kr.id,
      objective_id: obj.id,
      objective_title: obj.title,
      title: kr.title,
      owner_id: kr.owner_id,
      owner: kr.owner ?? null,
      current_value: kr.current_value,
      target_value: kr.target_value,
      unit: kr.unit,
      target_type: kr.target_type,
      confidence: Array(13).fill(null),  // full trend not needed here
      this_week_checkin: thisWeek,
      last_week_checkin: lastWeek,
    } as CheckinKR)
  }

  return { krs, cycleId: cycle.id }
}

// ── Submit a single KR check-in ───────────────────────────────────────────

export interface SubmitCheckinInput {
  key_result_id: string
  person_id: string
  week_number: number
  year: number
  cycle_id: string
  new_value: number
  confidence: number
  will_score: number | null
  will_action: string | null
  has_blocker: boolean
  blocker_text: string | null
  note: string | null
}

export async function submitCheckin(input: SubmitCheckinInput): Promise<void> {
  const { error } = await supabase
    .from('checkins')
    .upsert(
      {
        key_result_id: input.key_result_id,
        person_id:     input.person_id,
        week_number:   input.week_number,
        year:          input.year,
        cycle_id:      input.cycle_id,
        new_value:     input.new_value,
        confidence:    input.confidence,
        will_score:    input.will_score || null,
        will_action:   input.will_action || null,
        has_blocker:   input.has_blocker,
        blocker_text:  input.blocker_text || null,
        note:          input.note || null,
        submitted_at:  new Date().toISOString(),
        // backward-compat columns
        author_id:        input.person_id,
        value_at_checkin: input.new_value,
      },
      { onConflict: 'key_result_id,person_id,week_number,year' },
    )
  if (error) throw error

  // Update streak — non-critical: a blip here must not fail the whole submission
  try {
    await supabase.rpc('update_checkin_streak', {
      p_person_id: input.person_id,
      p_week: input.week_number,
      p_year: input.year,
    })
  } catch (err) {
    console.error('submitCheckin: streak update failed (non-fatal)', err)
  }

  // Notify unit admin if blocker flagged
  if (input.has_blocker) {
    await notifyUnitAdmin(input.person_id, input.key_result_id, input.blocker_text)
  }
}

async function notifyUnitAdmin(
  personId: string,
  _krId: string,
  blockerText: string | null,
): Promise<void> {
  // Find the lead of the person's primary unit
  const { data: membership } = await supabase
    .from('people_units')
    .select('unit_id')
    .eq('person_id', personId)
    .eq('is_primary', true)
    .single()

  if (!membership) return

  const { data: leads } = await supabase
    .from('people_units')
    .select('person_id')
    .eq('unit_id', membership.unit_id)
    .eq('role', 'lead')
    .neq('person_id', personId)

  if (!leads || leads.length === 0) return

  const notifications = leads.map((l: any) => ({
    person_id:  l.person_id,
    type:       'blocker_flagged',
    title:      'Blocker flagged in check-in',
    body:       blockerText || 'A team member flagged a blocker in their weekly check-in.',
    action_url: '/check-in/team',
  }))

  await supabase.from('notifications').insert(notifications)
}

// ── Streak ────────────────────────────────────────────────────────────────

export async function getMyStreak(personId: string): Promise<CheckinStreak | null> {
  const { data } = await supabase
    .from('checkin_streaks')
    .select('*')
    .eq('person_id', personId)
    .single()
  return data as CheckinStreak | null
}

// ── History for KR detail ────────────────────────────────────────────────

export async function getCheckinHistory(krId: string, limit = 13): Promise<WeeklyCheckin[]> {
  const { data, error } = await supabase
    .from('checkins')
    .select('id, key_result_id, person_id, week_number, year, cycle_id, new_value, confidence, has_blocker, blocker_text, note, submitted_at')
    .eq('key_result_id', krId)
    .not('week_number', 'is', null)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as WeeklyCheckin[]
}

// ── Team check-in status (for unit leads) ────────────────────────────────

export interface TeamMemberStatus {
  person_id: string
  person: { id: string; full_name: string; avatar_url: string | null; color: string | null }
  has_submitted: boolean
  confidence: number | null
  blockers: { kr_title: string; blocker_text: string | null }[]
}

export async function getTeamCheckinStatus(
  unitId: string,
): Promise<TeamMemberStatus[]> {
  const { week, year } = currentWeekYear()

  const { data: members, error } = await supabase
    .from('people_units')
    .select('person_id, person:profiles!person_id(id, full_name, avatar_url, color)')
    .eq('unit_id', unitId)
  if (error) throw error

  const results: TeamMemberStatus[] = []

  for (const m of (members ?? []) as any[]) {
    const { data: checkins } = await supabase
      .from('checkins')
      .select(`
        confidence, has_blocker, blocker_text,
        kr:key_results!key_result_id(title)
      `)
      .eq('person_id', m.person_id)
      .eq('week_number', week)
      .eq('year', year)

    const submitted = (checkins ?? []) as any[]
    const blockers = submitted
      .filter((c: any) => c.has_blocker)
      .map((c: any) => ({ kr_title: c.kr?.title ?? '', blocker_text: c.blocker_text }))

    const avgConfidence = submitted.length
      ? Math.round(
          submitted.reduce((s: number, c: any) => s + (c.confidence ?? 0), 0) / submitted.length,
        )
      : null

    results.push({
      person_id:     m.person_id,
      person:        m.person,
      has_submitted: submitted.length > 0,
      confidence:    avgConfidence,
      blockers,
    })
  }

  return results
}

export { currentWeekYear }
