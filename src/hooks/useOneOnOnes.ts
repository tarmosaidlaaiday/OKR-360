import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getMyReports, getMyManager, getSessionsForPair, getOneOnOnePartners,
  createDraftSession, upsertEntry, submitSession, updateSessionEntry,
} from '../services/oneOnOnes.service'
import type { OneOnOne, OneOnOneEntry, Person } from '../types/cadence'

export function useOneOnOnes() {
  const { user, profile } = useAuth()
  const [reports, setReports] = useState<Person[]>([])
  const [manager, setManager] = useState<Person | null>(null)
  const [partners, setPartners] = useState<Person[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<OneOnOne[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionsLoading, setSessionsLoading] = useState(false)

  // openSessionId: which session is currently displayed in the main panel.
  // Defaults to the draft when sessions first load for a person; independently
  // settable via selectSession().
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  // Ref mirrors openSessionId so loadSessions (a useCallback) can read the
  // current value without going stale.
  const openSessionIdRef = useRef<string | null>(null)

  const selectSession = useCallback((id: string | null) => {
    setOpenSessionId(id)
    openSessionIdRef.current = id
  }, [])

  // Load reports/manager
  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    getMyReports(user.id).then(r => {
      setReports(r)
      if (r.length > 0) setSelectedId(r[0].id)
      else {
        getMyManager(user.id).then(mgr => {
          setManager(mgr)
          if (mgr) setSelectedId(mgr.id)
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [user?.id])

  // Load everyone the user has actual 1:1 sessions with (superset of reports/manager)
  const loadPartners = useCallback(async () => {
    if (!user?.id) return
    getOneOnOnePartners(user.id).then(setPartners).catch(err => console.error('useOneOnOnes: getPartners failed', err))
  }, [user?.id])

  useEffect(() => { loadPartners() }, [loadPartners])

  // When the selected person changes, reset open session so loadSessions
  // will initialize it to the draft.
  useEffect(() => {
    selectSession(null)
  }, [selectedId, selectSession])

  // Load sessions whenever selected person changes
  const loadSessions = useCallback(async (otherId: string) => {
    if (!user?.id) return
    setSessionsLoading(true)
    const data = await getSessionsForPair(user.id, otherId).catch(err => { console.error('useOneOnOnes: getSessions failed', err); return [] })
    setSessions(data)

    // Initialize openSessionId to draft on first load (ref is null).
    // On reload (ref is non-null), leave it unchanged — the caller handles
    // selectSession() after reload if needed.
    if (openSessionIdRef.current === null) {
      const draftId = data.find(s => s.status === 'draft')?.id ?? null
      setOpenSessionId(draftId)
      openSessionIdRef.current = draftId
    }

    // Auto-create draft if none exists
    const hasDraft = data.some(s => s.status === 'draft')
    if (!hasDraft) {
      let id: string | null = null
      if (reports.some(r => r.id === otherId)) {
        id = await createDraftSession(user.id, otherId).catch(() => null)
      } else if (manager?.id === otherId) {
        id = await createDraftSession(otherId, user.id).catch(() => null)
      }
      if (id) {
        const updated = await getSessionsForPair(user.id, otherId).catch(() => data)
        setSessions(updated)
        // Set to the new draft only if we haven't navigated elsewhere
        if (openSessionIdRef.current === null) {
          setOpenSessionId(id)
          openSessionIdRef.current = id
        }
      }
    }
    setSessionsLoading(false)
  }, [user?.id, reports, manager])

  useEffect(() => {
    if (selectedId) loadSessions(selectedId)
  }, [selectedId, loadSessions])

  // "draft" = most recently created draft-status session (sessions are sorted
  // desc by scheduled_at, so the first match is the latest).
  const draft = sessions.find(s => s.status === 'draft') ?? null
  const past = sessions.filter(s => s.status === 'done')

  // The session currently shown in the main panel
  const openSession = sessions.find(s => s.id === openSessionId) ?? null

  const saveEntry = useCallback(async (
    oneOnOneId: string,
    fields: Partial<OneOnOneEntry>,
  ) => {
    await upsertEntry(oneOnOneId, fields)
    setSessions(prev => prev.map(s =>
      s.id !== oneOnOneId ? s : { ...s, entry: { ...(s.entry ?? {} as OneOnOneEntry), ...fields } }
    ))
  }, [])

  // updateSession: save any session (draft or done) without touching submitted_at.
  // Also updates one_on_ones.updated_at via the service.
  const updateSession = useCallback(async (
    oneOnOneId: string,
    fields: Partial<OneOnOneEntry>,
  ) => {
    await updateSessionEntry(oneOnOneId, fields)
    setSessions(prev => prev.map(s =>
      s.id !== oneOnOneId ? s : { ...s, entry: { ...(s.entry ?? {} as OneOnOneEntry), ...fields } }
    ))
  }, [])

  const submitDraft = useCallback(async () => {
    if (!draft || !user?.id || !selectedId) return
    const name = profile?.full_name ?? 'Someone'
    await submitSession(draft.id, user.id, selectedId, name)
    await loadSessions(selectedId)
  }, [draft, user?.id, selectedId, profile, loadSessions])

  // Combine actual session partners (source of truth) with reporting-line
  // fallback. Partners go first so anyone added via the picker is always visible.
  const people: Person[] = useMemo(() => {
    const combined = new Map<string, Person>()
    for (const p of partners) combined.set(p.id, p)
    for (const p of (reports.length > 0 ? reports : (manager ? [manager] : []))) {
      if (!combined.has(p.id)) combined.set(p.id, p)
    }
    return Array.from(combined.values())
  }, [partners, reports, manager])

  const isManager = reports.length > 0

  const reload = useCallback(() => {
    if (selectedId) return loadSessions(selectedId)
    return Promise.resolve()
  }, [selectedId, loadSessions])

  return {
    people,
    isManager,
    selectedId,
    setSelectedId,
    draft,
    past,
    sessions,
    openSessionId,
    openSession,
    selectSession,
    loading,
    sessionsLoading,
    saveEntry,
    updateSession,
    submitDraft,
    reload,
    refreshPartners: loadPartners,
  }
}
