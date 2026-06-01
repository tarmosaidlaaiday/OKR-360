import { supabase } from '../lib/supabase'
import type { OrgSettings } from '../types/cadence'

export async function getOrgSettings(): Promise<OrgSettings> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('*')
    .single()
  if (error) {
    // Table not yet migrated — return safe defaults
    return { require_parent_link: false, allow_cross_level: false, individual_level_enabled: false, show_alignment_gaps: true }
  }
  return data as OrgSettings
}

export async function saveOrgSettings(settings: Partial<OrgSettings> & { id?: string }): Promise<void> {
  // org_id required for RLS WITH CHECK — fetch from session if not already on the object
  let orgId = settings.org_id
  if (!orgId) {
    const { data } = await supabase.rpc('my_org_id')
    orgId = data as string | undefined
  }
  const { error } = await supabase
    .from('org_settings')
    .upsert({ ...settings, org_id: orgId, updated_at: new Date().toISOString() })
  if (error) throw error
}
