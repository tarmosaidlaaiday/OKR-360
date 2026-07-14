import { supabase } from '../lib/supabase'

/**
 * Returns true if the user is a global admin OR holds admin/lead role
 * in at least one unit. Use this for gating admin-level UI features
 * (e.g. "Add KPI", analytics access) that any org admin should have
 * regardless of their specific unit membership role.
 *
 * Do NOT use this for unit-scoped queries (e.g. "who are my reports",
 * "who leads this specific unit") — those must stay unit-scoped to
 * reflect actual org-chart relationships, not just privilege level.
 */
export async function isOrgOrUnitAdmin(userId: string): Promise<boolean> {
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
    .in('role', ['admin', 'lead'])
    .limit(1)

  return (data ?? []).length > 0
}
