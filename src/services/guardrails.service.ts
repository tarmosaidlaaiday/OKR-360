import { supabase } from '../lib/supabase'
import type { GuardrailKpi } from '../types/cadence'

function isDeteriorating(trend: number[], good: 'up' | 'down'): boolean {
  if (trend.length < 3) return false
  const recent = trend.slice(-3)
  const delta = recent[recent.length - 1] - recent[0]
  return good === 'up' ? delta < 0 : delta > 0
}

export async function getGuardrailKpis(objectiveId: string): Promise<GuardrailKpi[]> {
  const { data, error } = await supabase
    .from('objective_guardrail_kpis')
    .select('id, kpi_id, kpi:kpis(id, name, actual, plan, unit, good, direction)')
    .eq('objective_id', objectiveId)
  if (error) throw error

  const rows = (data ?? []) as any[]
  if (rows.length === 0) return []

  const kpiIds = rows.map((r: any) => r.kpi_id)

  // Fetch last 5 snapshots per KPI for trend + deterioration check
  const { data: snaps } = await supabase
    .from('kpi_snapshots')
    .select('kpi_id, value')
    .in('kpi_id', kpiIds)
    .order('year', { ascending: false })
    .order('week_number', { ascending: false })
    .limit(kpiIds.length * 5)

  const trendMap: Record<string, number[]> = {}
  for (const s of ((snaps ?? []) as any[]).slice().reverse()) {
    if (!trendMap[s.kpi_id]) trendMap[s.kpi_id] = []
    if (trendMap[s.kpi_id].length < 5) trendMap[s.kpi_id].unshift(s.value)
  }

  return rows.map((r: any) => {
    const k = r.kpi ?? {}
    const good = (k.good ?? k.direction ?? 'up') as 'up' | 'down'
    const trend = trendMap[r.kpi_id] ?? []
    return {
      id: r.id,
      kpi_id: r.kpi_id,
      name: k.name ?? '—',
      actual: k.actual ?? 0,
      plan: k.plan ?? 0,
      unit: k.unit ?? '',
      good,
      trend,
      deteriorating: isDeteriorating(trend, good),
    } satisfies GuardrailKpi
  })
}

export async function addGuardrailKpi(
  objectiveId: string,
  kpiId: string,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('objective_guardrail_kpis')
    .insert({ objective_id: objectiveId, kpi_id: kpiId, created_by: createdBy })
  if (error) throw error
}

export async function removeGuardrailKpi(id: string): Promise<void> {
  const { error } = await supabase
    .from('objective_guardrail_kpis')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// Fetch all KPIs available in an org for the guardrail picker
export async function getKpisForGuardrailPicker(
  cycleId: string,
): Promise<{ id: string; name: string; unit: string; role_name: string }[]> {
  const { data, error } = await supabase
    .from('kpis')
    .select('id, name, unit, role_name')
    .eq('cycle_id', cycleId)
    .order('role_name', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as any[]
}
