import { supabase } from '../lib/supabase'
import { getISOWeek } from '../lib/cadenceUtils'
import { isOrgOrUnitAdmin } from './permissions.service'
import type { KPI, Person } from '../types/cadence'

// ── Helpers ───────────────────────────────────────────────────────────────

function computePlanToDate(
  plan: number,
  cycleStart: string,
  cycleEnd: string,
): number {
  const now = new Date()
  const start = new Date(cycleStart)
  const end = new Date(cycleEnd)
  const totalMs = end.getTime() - start.getTime()
  if (totalMs <= 0) return plan
  const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), 0), totalMs)
  return plan * (elapsed / totalMs)
}

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

// ── Main query ────────────────────────────────────────────────────────────

export async function getKPIs(cycleId: string): Promise<KPI[]> {
  // 1. Fetch KPIs with owner profile
  const { data: rawKpis, error: kpiErr } = await supabase
    .from('kpis')
    .select('id, name, unit, good, direction, role_name, owner_id, owner_person_id, cycle_id, unit_id, plan, actual, key_result_id, linked_kr:key_results!key_result_id(id, title, objective_id)')
    .order('role_name', { ascending: true })
  if (kpiErr) throw kpiErr

  const kpiIds = (rawKpis ?? []).map((k: any) => k.id)
  if (kpiIds.length === 0) return []

  // 2. Fetch kpi_targets for this cycle
  const { data: targets } = await supabase
    .from('kpi_targets')
    .select('kpi_id, plan_value')
    .eq('cycle_id', cycleId)
    .in('kpi_id', kpiIds)

  const targetMap: Record<string, number> = {}
  for (const t of (targets ?? []) as any[]) {
    targetMap[t.kpi_id] = t.plan_value
  }

  // 3. Fetch snapshots (last 13 per KPI) + latest value
  const { data: snapshots } = await supabase
    .from('kpi_snapshots')
    .select('kpi_id, value, week_number, year')
    .in('kpi_id', kpiIds)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false })
    .limit(kpiIds.length * 13)

  // Group snapshots by kpi_id
  const snapshotMap: Record<string, number[]> = {}
  const latestMap: Record<string, number> = {}
  for (const s of ((snapshots ?? []) as any[]).slice().reverse()) {
    if (!snapshotMap[s.kpi_id]) snapshotMap[s.kpi_id] = []
    if (snapshotMap[s.kpi_id].length < 13) snapshotMap[s.kpi_id].unshift(s.value)
    if (latestMap[s.kpi_id] == null) latestMap[s.kpi_id] = s.value
  }

  // 4. Fetch owner profiles for owner_person_id
  const ownerIds = [...new Set(
    (rawKpis ?? []).map((k: any) => k.owner_person_id ?? k.owner_id).filter(Boolean)
  )]
  const ownerMap: Record<string, Person> = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, color, job_title')
      .in('id', ownerIds)
    for (const p of (profiles ?? []) as any[]) {
      ownerMap[p.id] = profileToPerson(p)
    }
  }

  // 5. Get cycle dates for plan-to-date computation
  const { data: cycle } = await supabase
    .from('cycles')
    .select('start_date, end_date')
    .eq('id', cycleId)
    .single()

  const cycleStart = cycle?.start_date ?? new Date().toISOString().slice(0, 10)
  const cycleEnd = cycle?.end_date ?? new Date().toISOString().slice(0, 10)

  // 6. Assemble KPIs
  return (rawKpis ?? []).map((k: any) => {
    const ownerId = k.owner_person_id ?? k.owner_id
    const plan = targetMap[k.id] ?? k.plan ?? 0
    const actual = latestMap[k.id] ?? k.actual ?? 0
    const plan_to_date = computePlanToDate(plan, cycleStart, cycleEnd)
    const good = k.good ?? k.direction ?? 'up'

    return {
      id: k.id,
      name: k.name,
      unit: k.unit ?? '',
      good,
      direction: good,
      role_name: k.role_name ?? '',
      owner_id: k.owner_id ?? null,
      owner_person_id: k.owner_person_id ?? null,
      owner: ownerId ? (ownerMap[ownerId] ?? null) : null,
      plan,
      plan_to_date,
      actual,
      cycle_id: k.cycle_id ?? null,
      unit_id: k.unit_id ?? null,
      key_result_id: k.key_result_id ?? null,
      linked_kr_title: (k.linked_kr as any)?.title ?? null,
      linked_objective_id: (k.linked_kr as any)?.objective_id ?? null,
      trend: snapshotMap[k.id] ?? [],
    } satisfies KPI
  })
}

// ── Upsert snapshot (inline edit) ────────────────────────────────────────

export async function upsertKpiSnapshot(
  kpiId: string,
  value: number,
  recordedBy: string,
): Promise<void> {
  const { week, year } = currentWeekYear()
  const { error } = await supabase
    .from('kpi_snapshots')
    .upsert(
      { kpi_id: kpiId, value, week_number: week, year, recorded_by: recordedBy },
      { onConflict: 'kpi_id,week_number,year' },
    )
  if (error) throw error
}

// ── Admin check ────────────────────────────────────────────────────────────

export async function canCreateKPI(userId: string): Promise<boolean> {
  return isOrgOrUnitAdmin(userId)
}

// ── Create KPI + target ────────────────────────────────────────────────────

export interface CreateKPIInput {
  name: string
  unit: string
  good: 'up' | 'down'
  unit_id: string | null
  owner_person_id: string
  role_name: string
  plan_value: number
  cycle_id: string
  created_by: string
  key_result_id?: string | null
}

export async function createKPI(input: CreateKPIInput): Promise<string> {
  const { data, error } = await supabase
    .from('kpis')
    .insert({
      name: input.name,
      unit: input.unit,
      good: input.good,
      direction: input.good,
      unit_id: input.unit_id,
      owner_person_id: input.owner_person_id,
      owner_id: input.owner_person_id,
      role_name: input.role_name,
      plan: input.plan_value,
      actual: 0,
      cycle_id: input.cycle_id,
      created_by: input.created_by,
      key_result_id: input.key_result_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  await supabase.from('kpi_targets').insert({
    kpi_id: data.id,
    cycle_id: input.cycle_id,
    plan_value: input.plan_value,
  })

  return data.id
}

// ── Units (for Add KPI modal scope) ───────────────────────────────────────

export async function getAdminUnits(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_global_admin, org_id')
    .eq('id', userId)
    .single()

  if (profile?.is_global_admin) {
    const { data } = await supabase
      .from('units')
      .select('id, name')
      .eq('org_id', profile.org_id)
    return data ?? []
  }

  const { data } = await supabase
    .from('people_units')
    .select('unit_id, unit:units(id, name)')
    .eq('person_id', userId)
    .in('role', ['admin', 'lead'])
  return ((data ?? []) as any[]).map((m: any) => m.unit).filter(Boolean)
}

export async function getUnitMembers(unitId: string): Promise<Person[]> {
  const { data } = await supabase
    .from('people_units')
    .select('person:profiles!person_id(id, full_name, avatar_url, color, job_title)')
    .eq('unit_id', unitId)
  return ((data ?? []) as any[]).map((m: any) => profileToPerson(m.person)).filter(Boolean)
}

// ── KPIs linked to a specific Key Result ─────────────────────────────────

export interface LinkedKpiSummary {
  id: string
  name: string
  actual: number
  plan: number
  unit: string
  good: 'up' | 'down'
}

export async function getKpisForKeyResult(keyResultId: string): Promise<LinkedKpiSummary[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('id, name, actual, unit, plan, good, direction')
    .eq('key_result_id', keyResultId)
  if (error) throw error
  return ((data ?? []) as any[]).map((k: any) => ({
    id: k.id,
    name: k.name,
    actual: k.actual ?? 0,
    plan: k.plan ?? 0,
    unit: k.unit ?? '',
    good: (k.good ?? k.direction ?? 'up') as 'up' | 'down',
  }))
}

// ── Delete KPI ────────────────────────────────────────────────────────────

export async function deleteKPI(id: string): Promise<void> {
  const { error } = await supabase.from('kpis').delete().eq('id', id)
  if (error) throw error
}

// ── Helpers ───────────────────────────────────────────────────────────────

function currentWeekYear() {
  const now = new Date()
  return { week: getISOWeek(now), year: now.getFullYear() }
}
