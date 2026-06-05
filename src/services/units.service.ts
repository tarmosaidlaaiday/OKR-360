import { supabase } from '../lib/supabase'
import type { Unit, Level } from '../types/cadence'

export async function getUnits(orgId?: string | null): Promise<Unit[]> {
  let q = supabase
    .from('units')
    .select('id, name, level_id, parent_id, position, org_id')
    .order('position', { ascending: true })
  // Filter explicitly when orgId is known — don't rely solely on RLS
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  console.log('[getUnits] orgId:', orgId, 'rows:', data?.length, 'error:', error?.message)
  if (error) throw error
  return (data ?? []) as Unit[]
}

export async function saveUnits(units: Unit[]): Promise<void> {
  const { error } = await supabase
    .from('units')
    .upsert(units.map((u, i) => ({ ...u, position: i })))
  if (error) {
    console.error('[saveUnits] failed', { message: error.message, code: (error as any).code, hint: (error as any).hint })
    throw new Error(error.message)
  }
}

export async function deleteUnit(id: string): Promise<void> {
  // Children will have parent_id set to null by DB cascade
  const { error } = await supabase.from('units').delete().eq('id', id)
  if (error) throw error
}

export async function createUnit(unit: Omit<Unit, 'id'>): Promise<Unit> {
  let orgId = unit.org_id
  if (!orgId) {
    const { data: rpcData, error: rpcError } = await supabase.rpc('my_org_id')
    if (rpcError) throw new Error(`my_org_id RPC failed: ${rpcError.message}`)
    orgId = rpcData as string | null ?? undefined
  }
  if (!orgId) throw new Error('Cannot create unit: org_id could not be resolved (profile may be missing org_id)')

  const { data, error } = await supabase
    .from('units')
    .insert({ ...unit, org_id: orgId })
    .select()
    .single()
  if (error) {
    console.error('[createUnit] failed', {
      payload: { ...unit, org_id: orgId },
      message: error.message,
      code: (error as any).code,
      details: (error as any).details,
      hint: (error as any).hint,
    })
    throw new Error(`Unit insert failed: ${error.message}`)
  }
  return data as Unit
}

export async function getUnit(unitId: string): Promise<Unit & { level?: Level }> {
  const { data, error } = await supabase
    .from('units')
    .select('id, name, level_id, parent_id, position, level:levels(id, name, color, position, enabled)')
    .eq('id', unitId)
    .single()
  if (error) throw error
  return data as unknown as Unit & { level?: Level }
}
