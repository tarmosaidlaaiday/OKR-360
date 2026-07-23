import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { getLevels } from '../services/levels.service'
import { getUnits } from '../services/units.service'
import { getOrgSettings } from '../services/orgSettings.service'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Level, Unit, OrgSettings } from '../types/cadence'
import type { Organisation } from '../types'

const FALLBACK_LEVELS: Level[] = [
  { id: 'group',    name: 'Group',    color: '#6366f1', position: 0, enabled: true },
  { id: 'company',  name: 'Company',  color: '#8b5cf6', position: 1, enabled: true },
  { id: 'division', name: 'Division', color: '#3b82f6', position: 2, enabled: true },
  { id: 'team',     name: 'Team',     color: '#22c55e', position: 3, enabled: true },
]

const FALLBACK_SETTINGS: OrgSettings = {
  require_parent_link: false,
  allow_cross_level: false,
  individual_level_enabled: false,
  show_alignment_gaps: true,
}

interface OrgContextValue {
  levels: Level[]
  units: Unit[]
  settings: OrgSettings
  org: Organisation | null
  loading: boolean
  refresh: () => void
  updateOrg: (patch: Partial<Pick<Organisation, 'name' | 'logo_url' | 'primary_color'>>) => Promise<void>
}

const OrgContext = createContext<OrgContextValue>({
  levels: FALLBACK_LEVELS,
  units: [],
  settings: FALLBACK_SETTINGS,
  org: null,
  loading: false,
  refresh: () => {},
  updateOrg: async () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { orgId } = useAuth()
  const [levels, setLevels]   = useState<Level[]>(FALLBACK_LEVELS)
  const [units, setUnits]     = useState<Unit[]>([])
  const [settings, setSettings] = useState<OrgSettings>(FALLBACK_SETTINGS)
  const [org, setOrg] = useState<Organisation | null>(null)
  const [loading, setLoading] = useState(true)
  const [rev, setRev] = useState(0)

  const refresh = useCallback(() => setRev(r => r + 1), [])

  useEffect(() => {
    setLoading(true)
    const orgFetch: Promise<Organisation | null> = orgId
      ? Promise.resolve(
          supabase.from('organisations').select('*').eq('id', orgId).single()
        ).then(r => (r as any).data as Organisation | null).catch(() => null)
      : Promise.resolve(null)

    console.log('[OrgContext] loading, orgId from auth:', orgId)
    Promise.all([
      getLevels().catch(err => { console.error('OrgContext: getLevels failed', err); return [] as Level[] }),
      getUnits(orgId).catch(err => { console.error('OrgContext: getUnits failed', err); return [] }),
      getOrgSettings().catch(err => { console.error('OrgContext: getOrgSettings failed', err); return FALLBACK_SETTINGS }),
      orgFetch,
    ]).then(([l, u, s, o]) => {
      console.log('[OrgContext] loaded org:', o?.id, 'levels:', l.length, 'units:', u.length)
      // Only replace levels if we got real DB rows. Empty result keeps the
      // placeholder FALLBACK_LEVELS so the UI doesn't show a blank selector.
      if (l.length) setLevels(l)
      setUnits(u)
      setSettings(s)
      setOrg(o)
      if (o?.primary_color) {
        document.documentElement.style.setProperty('--brand-color', o.primary_color)
        document.documentElement.style.setProperty('--accent', o.primary_color)
      }
      setLoading(false)
    })
  }, [rev, orgId])

  const updateOrg = useCallback(async (patch: Partial<Pick<Organisation, 'name' | 'logo_url' | 'primary_color'>>) => {
    if (!orgId) return
    const { data } = await supabase.from('organisations').update(patch).eq('id', orgId).select().single()
    if (data) {
      const updated = data as Organisation
      setOrg(updated)
      if (updated.primary_color) {
        document.documentElement.style.setProperty('--brand-color', updated.primary_color)
        document.documentElement.style.setProperty('--accent', updated.primary_color)
      }
    }
  }, [orgId])

  return (
    <OrgContext.Provider value={{ levels, units, settings, org, loading, refresh, updateOrg }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
