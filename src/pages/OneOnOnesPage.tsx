import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageActionStore } from '../stores/pageActionStore'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import { useOneOnOnes } from '../hooks/useOneOnOnes'
import { Avatar } from '../components/cadence/Avatar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Sparkline } from '../components/cadence/Sparkline'
import { Icon } from '../components/cadence/Icon'
import { confidenceColor } from '../lib/colors'
import { happinessLabel } from '../lib/cadenceUtils'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errors'
import {
  createDraftSession, duplicateSession, deleteSession, updateSchedule,
} from '../services/oneOnOnes.service'
import { EmptyState } from '../components/cadence/EmptyState'
import type { OneOnOneEntry, Person, CadenceObjective } from '../types/cadence'

// ── Helpers ───────────────────────────────────────────────────────────────

function toDatetimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return ''
  const d = new Date(isoString)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Happiness track ────────────────────────────────────────────────────────

function HappinessTrackRow({ values }: { values: (number | null)[] }) {
  const last4 = values.filter(v => v != null).slice(-4) as number[]
  if (last4.length === 0) return <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No data yet</span>
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {last4.map((v, i) => <ConfidenceCell key={i} value={v} size={22} />)}
    </div>
  )
}

// ── Field component ────────────────────────────────────────────────────────

interface FieldProps {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  example?: string
  rows?: number
}

function Field({ label, placeholder, value, onChange, example, rows = 3 }: FieldProps) {
  return (
    <label className="cd-field">
      <span className="cd-field-lbl">{label}</span>
      <textarea
        className="cd-field-input"
        placeholder={placeholder}
        value={value}
        rows={rows}
        onChange={e => onChange(e.target.value)}
      />
      {example && <span className="cd-field-eg">e.g. {example}</span>}
    </label>
  )
}

// ── Kebab menu ────────────────────────────────────────────────────────────

function KebabMenu({
  onDuplicate, onDelete, disabled,
}: { onDuplicate: () => void; onDelete: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false)
      } else {
        if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handle)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="cd-oo-kebab">
      <button
        type="button"
        className="cd-btn-icon"
        disabled={disabled}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ width: 28, height: 28 }}
        aria-label="More actions"
      >
        <Icon name="moreVertical" size={13} />
      </button>
      {open && (
        <div className="cd-oo-kebab-menu">
          <button
            type="button"
            className="cd-oo-kebab-item"
            onClick={() => { setOpen(false); onDuplicate() }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="cd-oo-kebab-item cd-oo-kebab-danger"
            onClick={() => { setOpen(false); onDelete() }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ── Personal catch-up tab ─────────────────────────────────────────────────

function PersonalCatchup({ entry, onChange }: {
  entry: Partial<OneOnOneEntry>
  onChange: (fields: Partial<OneOnOneEntry>) => void
}) {
  const happy = entry.happiness ?? 7

  return (
    <div className="cd-oo-body">
      <div className="cd-oo-goal">
        <Icon name="info" size={14} />
        <span><strong>Goal.</strong> Get a real read on the human, then on the work. Two minutes, four prompts.</span>
      </div>

      <div className="cd-oo-grid">
        <Field
          label="Personal · highlights"
          placeholder="A great moment outside work…"
          value={entry.personal_highlight ?? ''}
          onChange={v => onChange({ personal_highlight: v })}
        />
        <Field
          label="Professional · highlights"
          placeholder="A win at work this week…"
          value={entry.professional_highlight ?? ''}
          onChange={v => onChange({ professional_highlight: v })}
          example="Insights beta opened to 5 new teams — best NPS so far."
        />
        <Field
          label="Personal · low points"
          placeholder="Anything weighing on you…"
          value={entry.personal_low ?? ''}
          onChange={v => onChange({ personal_low: v })}
        />
        <Field
          label="Professional · low points"
          placeholder="A frustration at work…"
          value={entry.professional_low ?? ''}
          onChange={v => onChange({ professional_low: v })}
        />
      </div>

      <div className="cd-oo-happy">
        <div className="cd-oo-happy-l">
          <div className="cd-oo-happy-q">How happy do you feel right now?</div>
          <div className="cd-oo-happy-sub">Honest beats optimistic. Trend matters more than any single week.</div>
        </div>
        <div className="cd-oo-happy-r">
          <div className="cd-oo-happy-scale">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button
                key={n}
                type="button"
                className={'cd-oo-happy-pt ' + (happy === n ? 'is-on' : '')}
                onClick={() => onChange({ happiness: n })}
                style={{ '--c': confidenceColor(n) } as React.CSSProperties}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="cd-oo-happy-label">
            <span className="cd-num">{happy}/10</span>
            <span className="cd-num-faint">— {happinessLabel(happy)}</span>
          </div>
        </div>
      </div>

      <div className="cd-oo-followup">
        <Field
          label={happy >= 7
            ? `What would make this an ${happy + 1}/10?`
            : 'What would move this up by one point?'}
          placeholder="One specific thing…"
          value={entry.happiness_followup ?? ''}
          onChange={v => onChange({ happiness_followup: v })}
        />
      </div>
    </div>
  )
}

// ── Work tab ──────────────────────────────────────────────────────────────

function WorkAgenda({ entry, onChange }: {
  entry: Partial<OneOnOneEntry>
  onChange: (fields: Partial<OneOnOneEntry>) => void
}) {
  return (
    <div className="cd-oo-body">
      <div className="cd-oo-grid">
        <Field
          label="Wins this week"
          placeholder="Where did you make real progress?"
          value={entry.work_wins ?? ''}
          onChange={v => onChange({ work_wins: v })}
          example="Cut the dashboard query plan from 3 joins to 1. p95 down 40ms."
        />
        <Field
          label="Blockers"
          placeholder="What's in your way?"
          value={entry.work_blockers ?? ''}
          onChange={v => onChange({ work_blockers: v })}
        />
        <Field
          label="What I need from my manager"
          placeholder="Help, cover, an intro, a decision…"
          value={entry.work_needs_manager ?? ''}
          onChange={v => onChange({ work_needs_manager: v })}
        />
        <Field
          label="Topics to discuss"
          placeholder="Add an item to the agenda…"
          value={entry.work_topics ?? ''}
          onChange={v => onChange({ work_topics: v })}
        />
      </div>
    </div>
  )
}

// ── OKRs & KPIs tab ───────────────────────────────────────────────────────

function OKRsAgenda({ person, cycleId }: { person: Person; cycleId: string | null }) {
  const [objs, setObjs] = useState<CadenceObjective[]>([])

  useEffect(() => {
    if (!person.id || !cycleId) return
    supabase
      .from('objectives')
      .select('id, title, owner_id, confidence')
      .eq('cycle_id', cycleId)
      .eq('owner_id', person.id)
      .then(({ data }) => setObjs((data ?? []) as any[]))
  }, [person.id, cycleId])

  const currentWeekIdx = Math.min((objs[0]?.confidence?.length ?? 1) - 1, 6)

  return (
    <div className="cd-oo-body">
      <div className="cd-oo-okrs">
        <div className="cd-oo-okrs-hd">
          <span>Objective</span>
          <span>Now</span>
          <span>Trend</span>
          <span>Talk about</span>
        </div>
        {objs.length === 0 && (
          <p className="cd-empty-hint" style={{ padding: '16px 0' }}>No objectives for {person.name.split(' ')[0]} this cycle.</p>
        )}
        {objs.map(o => (
          <div key={o.id} className="cd-oo-okrs-row">
            <span className="cd-oo-okrs-title">{o.title}</span>
            <span>
              <ConfidenceCell value={(o.confidence ?? [])[currentWeekIdx] ?? null} size={24} />
            </span>
            <span>
              <Sparkline
                values={(o.confidence ?? []).filter((v: any) => v != null) as number[]}
                width={100}
                height={22}
                stroke="var(--accent)"
              />
            </span>
            <span>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-tiny">+ Discuss</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Feedback tab ──────────────────────────────────────────────────────────

function FeedbackAgenda({ person, entry, onChange }: {
  person: Person
  entry: Partial<OneOnOneEntry>
  onChange: (fields: Partial<OneOnOneEntry>) => void
}) {
  const firstName = person.name.split(' ')[0]
  return (
    <div className="cd-oo-body">
      <div className="cd-oo-grid">
        <Field
          label={`Feedback for ${firstName}`}
          placeholder="Specific. Recent. Actionable."
          value={entry.feedback_for_report ?? ''}
          onChange={v => onChange({ feedback_for_report: v })}
          example="Liked how you ran the migration kickoff — the rollback plan made everyone calmer."
        />
        <Field
          label={`Feedback from ${firstName}`}
          placeholder={`What ${firstName} wants you to know`}
          value={entry.feedback_from_report ?? ''}
          onChange={v => onChange({ feedback_from_report: v })}
        />
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

type TabId = 'personal' | 'work' | 'okrs' | 'feedback'

export function OneOnOnesPage() {
  const { activeCycle } = useCycle()
  const { user } = useAuth()
  const navigate = useNavigate()
  const hook = useOneOnOnes()
  const {
    people, selectedId, setSelectedId,
    draft, past, loading, sessionsLoading,
    openSessionId, openSession,
    selectSession,
    saveEntry, updateSession, submitDraft, reload,
    refreshPartners,
  } = hook

  const [tab, setTab] = useState<TabId>('personal')
  const [localEntry, setLocalEntry] = useState<Partial<OneOnOneEntry>>({})
  const [savedEntry, setSavedEntry] = useState<Partial<OneOnOneEntry>>({})  // snapshot for Cancel
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // New 1:1 person picker
  const { newMeetingOpen, setNewMeetingOpen } = usePageActionStore()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [allPeople, setAllPeople] = useState<Person[]>([])
  const [pickerCreating, setPickerCreating] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Reschedule modal
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleValue, setRescheduleValue] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  const isViewingPast = openSession?.status === 'done'

  // Refs so the debounced callback sees current values without going stale
  const openSessionIdRef = useRef<string | null>(null)
  const isViewingPastRef = useRef(false)
  openSessionIdRef.current = openSessionId
  isViewingPastRef.current = isViewingPast

  // Load all people on mount (needed for picker)
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, avatar_url, role')
      .order('full_name').then(({ data }) => {
        if (!data) return
        setAllPeople(data.map((p: any) => {
          const name = p.full_name ?? '?'
          const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
          return { id: p.id, name, avatar_url: p.avatar_url ?? null, role: p.role ?? '', initials, color: '#888' }
        }))
      })
  }, [])

  useEffect(() => {
    if (newMeetingOpen) {
      setPickerOpen(true)
      setPickerSearch('')
      setPickerError(null)
      setNewMeetingOpen(false)
    }
  }, [newMeetingOpen, setNewMeetingOpen])

  async function handlePickerSelect(person: Person) {
    if (!user?.id) return
    setPickerCreating(true)
    setPickerError(null)
    try {
      await createDraftSession(user.id, person.id)
    } catch (ex) {
      setPickerError(getErrorMessage(ex))
      setPickerCreating(false)
      return // don't close picker or navigate on failure
    } finally {
      setPickerCreating(false)
    }
    await refreshPartners()
    setSelectedId(person.id)
    setPickerOpen(false)
    setPickerSearch('')
    navigate('/people?tab=1on1s')
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedPerson = people.find(p => p.id === selectedId) ?? null

  // Sync local entry whenever the open session changes
  useEffect(() => {
    const entry = openSession?.entry ? { ...openSession.entry } : {}
    setLocalEntry(entry)
    setSavedEntry(entry)
    setLastSaved(null)
  }, [openSessionId]) // intentionally depend on id, not the object

  // Debounced auto-save — works for both draft and past sessions
  const handleEntryChange = useCallback((fields: Partial<OneOnOneEntry>) => {
    setLocalEntry(prev => ({ ...prev, ...fields }))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const id = openSessionIdRef.current
      const isPast = isViewingPastRef.current
      if (!id) return
      if (isPast) {
        await updateSession(id, fields)
      } else {
        await saveEntry(id, fields)
      }
      setLastSaved(new Date())
    }, 800)
  }, [saveEntry, updateSession])

  async function handleSubmit() {
    if (!draft) return
    setSubmitting(true)
    try { await submitDraft() } finally { setSubmitting(false) }
  }

  async function handleSavePast() {
    if (!openSessionId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    await updateSession(openSessionId, localEntry)
    setSavedEntry({ ...localEntry })
    setLastSaved(new Date())
  }

  function handleCancelPast() {
    setLocalEntry({ ...savedEntry })
  }

  async function handleDuplicate(sessionId: string) {
    try {
      const newId = await duplicateSession(sessionId)
      await reload()
      selectSession(newId)
    } catch (e) {
      console.error('[duplicate 1:1]', e)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    const wasOpen = deleteTarget === openSessionId
    try {
      if (wasOpen) {
        // Reset so loadSessions will re-initialize to the draft
        selectSession(null)
      }
      await deleteSession(deleteTarget)
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      console.error('[delete 1:1]', e)
    } finally {
      setDeleting(false)
    }
  }

  async function handleReschedule() {
    if (!draft?.id || !rescheduleValue) return
    setRescheduling(true)
    try {
      await updateSchedule(draft.id, new Date(rescheduleValue).toISOString())
      setRescheduleOpen(false)
      await reload()
    } catch (e) {
      console.error('[reschedule 1:1]', e)
    } finally {
      setRescheduling(false)
    }
  }

  const pastHappiness = past
    .map(s => s.entry?.happiness ?? s.happiness)
    .filter(v => v != null) as number[]

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading 1:1s…</p></div>

  return (
    <div className="cd-page">
      {/* Page header */}
      <header className="cd-pgh">
        <div>
          <div className="cd-pgh-eyebrow">1:1 Conversations</div>
          <h1 className="cd-pgh-title">A better 30 minutes.</h1>
          <p className="cd-pgh-sub">A shared prep doc, last meeting's notes one click away, and a happiness trend you can actually feel.</p>
        </div>
        <div className="cd-pg-act">
          {!isViewingPast && (
            <button
              type="button"
              className="cd-btn cd-btn-secondary"
              disabled={!draft || !openSession || isViewingPast}
              onClick={() => {
                setRescheduleValue(toDatetimeLocal(draft?.scheduled_at))
                setRescheduleOpen(true)
              }}
            >
              <Icon name="calendar" size={14} /> Reschedule
            </button>
          )}
          {!isViewingPast && draft && (
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Submitting…' : 'Submit prep'}
            </button>
          )}
        </div>
      </header>

      <div className="cd-oo-layout">
        {/* Left sidebar */}
        <aside className="cd-oo-side">
          <div className="cd-oo-side-hd">People</div>
          {people.map(p => (
            <button
              key={p.id}
              type="button"
              className={'cd-oo-tab ' + (selectedId === p.id ? 'is-on' : '')}
              onClick={() => setSelectedId(p.id)}
            >
              <Avatar person={p} size={28} />
              <div>
                <div className="cd-oo-tab-name">{p.name}</div>
                <div className="cd-oo-tab-meta">{p.role}</div>
              </div>
            </button>
          ))}

          {selectedPerson && (
            <>
              <div className="cd-oo-side-hd cd-oo-side-hd-2">
                History · {selectedPerson.name.split(' ')[0]}
              </div>
              {/* Draft row in history */}
              {draft && (
                <div className={'cd-oo-hist-row ' + (openSessionId === draft.id ? 'is-on' : '')}>
                  <button
                    type="button"
                    className="cd-oo-hist"
                    onClick={() => selectSession(draft.id)}
                  >
                    <div className="cd-oo-hist-date">
                      {draft.scheduled_at
                        ? new Date(draft.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                        : '—'}
                      {' · '}
                      <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Draft</span>
                    </div>
                    <div className="cd-oo-hist-text">
                      <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>In progress</span>
                    </div>
                  </button>
                  <KebabMenu
                    onDuplicate={() => handleDuplicate(draft.id)}
                    onDelete={() => setDeleteTarget(draft.id)}
                    disabled={submitting}
                  />
                </div>
              )}
              {sessionsLoading && <p className="cd-loading" style={{ padding: '8px 14px', fontSize: 12 }}>Loading…</p>}
              {past.map(m => (
                <div key={m.id} className={'cd-oo-hist-row ' + (openSessionId === m.id ? 'is-on' : '')}>
                  <button
                    type="button"
                    className="cd-oo-hist"
                    onClick={() => selectSession(m.id)}
                  >
                    <div className="cd-oo-hist-date">
                      {m.scheduled_at
                        ? new Date(m.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                        : '—'}
                    </div>
                    <div className="cd-oo-hist-text">
                      <ConfidenceCell value={m.entry?.happiness ?? m.happiness ?? null} size={18} />
                      <span>
                        {m.summary?.slice(0, 70) ?? ''}
                        {m.summary && m.summary.length > 70 ? '…' : ''}
                      </span>
                    </div>
                  </button>
                  <KebabMenu
                    onDuplicate={() => handleDuplicate(m.id)}
                    onDelete={() => setDeleteTarget(m.id)}
                  />
                </div>
              ))}
              {!sessionsLoading && past.length === 0 && !draft && (
                <p className="cd-empty-hint" style={{ padding: '8px 14px', fontSize: 12 }}>No past sessions yet.</p>
              )}
            </>
          )}

          {people.length === 0 && (
            <EmptyState
              icon="message"
              title="No 1:1 partners yet"
              description="Add team members to start tracking your 1:1 meetings"
            />
          )}
        </aside>

        {/* Main panel */}
        <main className="cd-oo-main">
          {selectedPerson ? (
            <div className="cd-card" style={{ padding: 0 }}>
              {/* Editing-past banner */}
              {isViewingPast && (
                <div className="cd-oo-past-banner">
                  <span>
                    Editing past 1:1 from{' '}
                    <strong>
                      {openSession?.scheduled_at
                        ? new Date(openSession.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
                        : '—'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className="cd-btn cd-btn-ghost cd-btn-sm"
                    onClick={() => selectSession(draft?.id ?? null)}
                  >
                    ← Back to current draft
                  </button>
                </div>
              )}

              {/* Meeting header */}
              <div className="cd-oo-mhd">
                <div className="cd-oo-mhd-l">
                  <Avatar person={selectedPerson} size={44} />
                  <div>
                    <div className="cd-oo-mhd-name">{selectedPerson.name}</div>
                    <div className="cd-oo-mhd-meta">
                      <Icon name="calendar" size={12} />
                      {(openSession ?? draft)?.scheduled_at
                        ? new Date((openSession ?? draft)!.scheduled_at!).toLocaleDateString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
                        : 'No session scheduled'}
                    </div>
                  </div>
                </div>
                <div className="cd-oo-mhd-trend">
                  <div className="cd-oo-mhd-trend-lbl">Happiness · last {Math.min(4, pastHappiness.length)} weeks</div>
                  <HappinessTrackRow values={pastHappiness} />
                </div>
              </div>

              {/* Tabs */}
              <div className="cd-oo-tabs">
                {([
                  { id: 'personal', label: 'Personal catch-up' },
                  { id: 'work',     label: 'Work' },
                  { id: 'okrs',     label: 'OKRs & KPIs' },
                  { id: 'feedback', label: 'Feedback' },
                ] as { id: TabId; label: string }[]).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={'cd-oo-tabbtn ' + (tab === t.id ? 'is-on' : '')}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === 'personal' && (
                <PersonalCatchup
                  entry={localEntry}
                  onChange={handleEntryChange}
                />
              )}
              {tab === 'work' && (
                <WorkAgenda
                  entry={localEntry}
                  onChange={handleEntryChange}
                />
              )}
              {tab === 'okrs' && (
                <OKRsAgenda
                  person={selectedPerson}
                  cycleId={activeCycle?.id ?? null}
                />
              )}
              {tab === 'feedback' && (
                <FeedbackAgenda
                  person={selectedPerson}
                  entry={localEntry}
                  onChange={handleEntryChange}
                />
              )}

              {/* Footer */}
              <div className="cd-oo-foot">
                <div className="cd-oo-foot-status">
                  <Icon name="check" size={13} />
                  {lastSaved
                    ? `Auto-saved · ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Auto-saved · just now'}
                </div>
                {isViewingPast ? (
                  <div className="cd-oo-foot-act">
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost"
                      onClick={handleCancelPast}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="cd-btn cd-btn-primary"
                      onClick={handleSavePast}
                    >
                      Save changes
                    </button>
                  </div>
                ) : (
                  <div className="cd-oo-foot-act">
                    <button type="button" className="cd-btn cd-btn-ghost">Discard draft</button>
                    <button type="button" className="cd-btn cd-btn-secondary">
                      Share with {selectedPerson.name.split(' ')[0]}
                    </button>
                    <button
                      type="button"
                      className="cd-btn cd-btn-primary"
                      disabled={!draft || submitting}
                      onClick={handleSubmit}
                    >
                      {submitting ? 'Submitting…' : 'Submit prep'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="cd-um-empty-detail">
              <Icon name="chat" size={32} />
              <div>Select a person to start a 1:1</div>
            </div>
          )}
        </main>
      </div>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div
          className="cd-modal-backdrop"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div className="cd-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="cd-modal-hd">
              <span className="cd-modal-title">Delete this 1:1 memo?</span>
              <button
                type="button"
                className="cd-btn-icon"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="cd-modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-mid)' }}>
                This can't be undone. All notes and entries for this session will be permanently deleted.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="cd-btn cd-btn-ghost"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cd-btn cd-btn-danger"
                  disabled={deleting}
                  onClick={handleDeleteConfirm}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {rescheduleOpen && (
        <div
          className="cd-modal-backdrop"
          onClick={() => !rescheduling && setRescheduleOpen(false)}
        >
          <div className="cd-modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="cd-modal-hd">
              <span className="cd-modal-title">Reschedule 1:1</span>
              <button
                type="button"
                className="cd-btn-icon"
                disabled={rescheduling}
                onClick={() => setRescheduleOpen(false)}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="cd-modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <input
                type="datetime-local"
                className="cd-um-input"
                value={rescheduleValue}
                onChange={e => setRescheduleValue(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="cd-btn cd-btn-ghost"
                  disabled={rescheduling}
                  onClick={() => setRescheduleOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cd-btn cd-btn-primary"
                  disabled={rescheduling || !rescheduleValue}
                  onClick={handleReschedule}
                >
                  {rescheduling ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New 1:1 person picker */}
      {pickerOpen && (
        <div
          className="cd-modal-backdrop"
          onClick={() => { setPickerOpen(false); setPickerSearch(''); setPickerError(null) }}
        >
          <div className="cd-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="cd-modal-hd">
              <span className="cd-modal-title">Start a 1:1 with…</span>
              <button
                type="button"
                className="cd-btn-icon"
                onClick={() => { setPickerOpen(false); setPickerSearch(''); setPickerError(null) }}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="cd-modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                className="cd-um-input"
                placeholder="Search by name…"
                value={pickerSearch}
                onChange={e => { setPickerSearch(e.target.value); setPickerError(null) }}
                autoFocus
              />
              {pickerError && (
                <p className="cd-um-error">{pickerError}</p>
              )}
              <div style={{ overflowY: 'auto', maxHeight: 340, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(() => {
                  const filtered = allPeople.filter(p =>
                    p.id !== user?.id &&
                    p.name.toLowerCase().includes(pickerSearch.toLowerCase())
                  )
                  if (filtered.length === 0 && allPeople.length <= 1) {
                    return (
                      <div style={{ padding: '16px 4px', fontSize: 13, color: 'var(--ink-soft)', textAlign: 'center' }}>
                        No team members found.{' '}
                        <a
                          href="/settings/users"
                          style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                          onClick={() => { setPickerOpen(false); navigate('/settings/users') }}
                        >
                          Add users first.
                        </a>
                      </div>
                    )
                  }
                  if (filtered.length === 0) {
                    return (
                      <p style={{ padding: '12px 4px', fontSize: 13, color: 'var(--ink-faint)' }}>
                        No people match "{pickerSearch}"
                      </p>
                    )
                  }
                  return filtered.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={pickerCreating}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                        borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer',
                        textAlign: 'left', width: '100%', transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'color-mix(in oklab, var(--ink) 5%, transparent)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      onClick={() => handlePickerSelect(p)}
                    >
                      <Avatar person={p} size={32} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>{p.name}</div>
                        {p.role && (
                          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>{p.role}</div>
                        )}
                      </div>
                      {pickerCreating && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)' }}>…</span>}
                    </button>
                  ))
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
