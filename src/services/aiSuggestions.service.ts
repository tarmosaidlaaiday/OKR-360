import { supabase } from '../lib/supabase'
import type { KrTargetType } from '../types'

export interface OrgTreeNode {
  name: string
  children: OrgTreeNode[]
}

export interface KRSuggestion {
  title: string
  target_type: KrTargetType
  target_value: number
  unit: string | null
}

export async function suggestKRs(
  objective_title: string,
  unit_name?: string,
  industry?: string,
): Promise<KRSuggestion[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-key-results`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ objective_title, unit_name, industry }),
  })

  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'AI suggestion failed')

  // Defense-in-depth: coerce any invalid target_type to 'numeric' before returning
  // to the caller, so an older deployed edge function version or an unexpected AI
  // response can never produce an invalid Postgres enum value downstream.
  const VALID_TARGET_TYPES: KrTargetType[] = ['numeric', 'percentage', 'boolean']
  const suggestions = (json.suggestions as KRSuggestion[]).map(s => ({
    ...s,
    target_type: VALID_TARGET_TYPES.includes(s.target_type) ? s.target_type : 'numeric' as KrTargetType,
  }))
  return suggestions
}

export async function suggestOrgStructure(description: string): Promise<OrgTreeNode[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-org-structure`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ description }),
  })

  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'AI suggestion failed')
  return json.units as OrgTreeNode[]
}
