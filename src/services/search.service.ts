import { supabase } from '../lib/supabase'

export interface SearchResult {
  id: string
  label: string
  sub: string | null
  group: 'Objectives' | 'KPIs' | 'People'
  to: string
}

export async function searchContent(query: string): Promise<SearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  // All three queries run in parallel; RLS scopes each to the caller's org automatically.
  const [objs, kpis, people] = await Promise.all([
    supabase
      .from('objectives')
      .select('id, title, status')
      .ilike('title', `%${q}%`)
      .limit(5),
    supabase
      .from('kpis')
      .select('id, name, unit')
      .ilike('name', `%${q}%`)
      .limit(5),
    supabase
      .from('profiles')
      .select('id, full_name, job_title')
      .ilike('full_name', `%${q}%`)
      .limit(5),
  ])

  const results: SearchResult[] = []

  for (const o of objs.data ?? []) {
    results.push({
      id: o.id,
      label: o.title,
      sub: o.status ?? null,
      group: 'Objectives',
      to: `/objectives`,
    })
  }

  for (const k of kpis.data ?? []) {
    results.push({
      id: k.id,
      label: k.name,
      sub: k.unit ?? null,
      group: 'KPIs',
      to: `/kpis?highlight=${k.id}`,
    })
  }

  for (const p of people.data ?? []) {
    results.push({
      id: p.id,
      label: p.full_name,
      sub: p.job_title ?? null,
      group: 'People',
      to: `/people`,
    })
  }

  return results
}
