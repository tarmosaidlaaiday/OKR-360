import { supabase } from '../lib/supabase'
import type { OrgSettings } from '../types/cadence'

const DEFAULTS: OrgSettings = {
  require_parent_link: false,
  allow_cross_level: false,
  individual_level_enabled: false,
  show_alignment_gaps: true,
}

export async function getOrgSettings(): Promise<OrgSettings> {
  // maybeSingle() returns null (not 406) when no row exists for this org yet
  const { data } = await supabase
    .from('org_settings')
    .select('*')
    .maybeSingle()

  return (data as OrgSettings | null) ?? DEFAULTS
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
