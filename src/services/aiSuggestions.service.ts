import { supabase } from '../lib/supabase'
import type { KrTargetType } from '../types'

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
  return json.suggestions as KRSuggestion[]
}
