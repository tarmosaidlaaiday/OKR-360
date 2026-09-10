import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { useCycle } from '../context/CycleContext'
import { Avatar } from '../components/cadence/Avatar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Icon } from '../components/cadence/Icon'
import { EmptyState } from '../components/cadence/EmptyState'
import { supabase } from '../lib/supabase'
import { objectiveProgress } from '../lib/cadenceUtils'
import { isOverdue } from '../lib/utils'
import { getUnitMembers } from '../services/peopleUnits.service'
import { getUnitTasks } from '../services/personalTasks.service'
import {
  getLeadableUnits, canManageUnit,
  getMeetingsForUnit, getMeeting, createMeeting, updateMeeting, completeMeeting,
  getParticipants, addParticipant, removeParticipant, autoPopulateParticipants,
  getCommitments, addCommitment, carryForwardCommitment,
  getPreviousMeeting, getDecliningConfidenceKRs, getDeepCarryForwardCommitments,
} from '../services/teamMeetings.service'
import type {
  Unit, TeamMeeting, TeamMeetingParticipant, TeamMeetingCommitment,
  TeamMeetingRecurrence, CadenceObjective, CadenceKeyResult, PeopleUnit, UnifiedTask,
} from '../types/cadence'
import type { DecliningKR } from '../services/teamMeetings.service'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function StatusBadge({ status }: { status: TeamMeeting['status'] }) {
  const map: Record<string, { label: string; color: string }> = {
    scheduled:  { label: 'Scheduled',  color: 'var(--accent)' },
    completed:  { label: 'Completed',  color: '#1F7A4D' },
    cancelled:  { label: 'Cancelled',  color: '#888' },
  }
  const s = map[status] ?? map.scheduled
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '.04em', padding: '2px 7px',
      borderRadius: 4, background: s.color + '18', color: s.color,
    }}>
      {s.label}
    </span>
  )
}

function RecurrenceBadge({ recurrence }: { recurrence: TeamMeetingRecurrence }) {
  if (recurrence === 'none') return null
  const labels: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4,
      background: 'var(--ink-faint)', color: 'var(--ink-dim)',
    }}>
      {labels[recurrence]}
    </span>
  )
}

function TaskStatusDot({ status }: { status: string | undefined }) {
  const color = status === 'done' ? '#1F7A4D' : status === 'in_progress' ? '#9A6A11' : '#888'
  const label = status === 'done' ? 'Done' : status === 'in_progress' ? 'In progress' : 'To do'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

// ── New Meeting Modal ─────────────────────────────────────────────────────────

interface NewMeetingModalProps {
  leadableUnits: Unit[]
  defaultUnitId: string | null
  onClose: () => void
  onCreated: (meeting: TeamMeeting) => void
  orgId: string
  userId: string
  cycleId: string | null
}

function NewMeetingModal({ leadableUnits, defaultUnitId, onClose, onCreated, orgId, userId, cycleId }: NewMeetingModalProps) {
  const [unitId, setUnitId] = useState(defaultUnitId ?? leadableUnits[0]?.id ?? '')
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() + 1)
    return toDatetimeLocal(d.toISOString())
  })
  const [recurrence, setRecurrence] = useState<TeamMeetingRecurrence>('monthly')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleCreate() {
    if (!unitId || !scheduledAt) return
    setSaving(true); setErr(null)
    try {
      const meeting = await createMeeting({
        unitId,
        orgId,
        cycleId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        recurrence,
        createdBy: userId,
      })
      await autoPopulateParticipants(meeting.id, unitId)
      onCreated(meeting)
    } catch (e: any) {
      setErr(e.message ?? 'Failed to create meeting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cd-modal-backdrop" onClick={onClose}>
      <div className="cd-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="cd-modal-hd">
          <span className="cd-modal-title">New team meeting</span>
          <button className="cd-btn-icon" onClick={onClose} type="button"><Icon name="x" size={14} /></button>
        </div>
        <div className="cd-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="cd-form-group">
            <span className="cd-label">Unit</span>
            <select className="cd-input" value={unitId} onChange={e => setUnitId(e.target.value)}>
              {leadableUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>

          <label className="cd-form-group">
            <span className="cd-label">Date &amp; time</span>
            <input
              type="datetime-local"
              className="cd-input"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </label>

          <label className="cd-form-group">
            <span className="cd-label">Recurrence</span>
            <select className="cd-input" value={recurrence} onChange={e => setRecurrence(e.target.value as TeamMeetingRecurrence)}>
              <option value="none">One-off</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>

          {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>}
        </div>
        <div className="cd-modal-foot">
          <button className="cd-btn cd-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="cd-btn" type="button" onClick={handleCreate} disabled={saving || !unitId}>
            {saving ? 'Creating…' : 'Create meeting'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Carry-forward confirmation modal ─────────────────────────────────────────

interface CarryForwardModalProps {
  commitment: TeamMeetingCommitment
  toMeeting: TeamMeeting
  orgId: string
  currentUserId: string
  onClose: () => void
  onCarried: (c: TeamMeetingCommitment) => void
}

function CarryForwardModal({ commitment, toMeeting, orgId, currentUserId, onClose, onCarried }: CarryForwardModalProps) {
  const [description, setDescription] = useState(commitment.description)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true); setErr(null)
    try {
      const c = await carryForwardCommitment({
        fromCommitment: commitment,
        toMeetingId: toMeeting.id,
        toMeeting,
        description,
        orgId,
        currentUserId,
      })
      onCarried(c)
    } catch (e: any) {
      setErr(e.message ?? 'Failed to carry forward')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cd-modal-backdrop" onClick={onClose}>
      <div className="cd-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="cd-modal-hd">
          <span className="cd-modal-title">Carry forward commitment</span>
          <button className="cd-btn-icon" onClick={onClose} type="button"><Icon name="x" size={14} /></button>
        </div>
        <div className="cd-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: 0 }}>
            Edit the description if needed, then confirm. A new task will be created for{' '}
            <strong>{commitment.person?.full_name ?? 'this person'}</strong>.
          </p>
          <label className="cd-form-group">
            <span className="cd-label">Description</span>
            <textarea
              className="cd-input"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>
          {err && <p style={{ color: 'var(--red)', fontSize: 13 }}>{err}</p>}
        </div>
        <div className="cd-modal-foot">
          <button className="cd-btn cd-btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="cd-btn" type="button" onClick={handleConfirm} disabled={saving || !description.trim()}>
            {saving ? 'Carrying forward…' : 'Carry forward'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Previous meeting panel ────────────────────────────────────────────────────

interface PrevMeetingPanelProps {
  prevMeeting: TeamMeeting
  currentMeeting: TeamMeeting
  orgId: string
  currentUserId: string
  alreadyCarried: Set<string>
  onCarried: (c: TeamMeetingCommitment) => void
}

function PrevMeetingPanel({ prevMeeting, currentMeeting, orgId, currentUserId, alreadyCarried, onCarried }: PrevMeetingPanelProps) {
  const [commitments, setCommitments] = useState<TeamMeetingCommitment[]>([])
  const [loading, setLoading] = useState(true)
  const [carryTarget, setCarryTarget] = useState<TeamMeetingCommitment | null>(null)

  useEffect(() => {
    setLoading(true)
    getCommitments(prevMeeting.id).then(cs => { setCommitments(cs); setLoading(false) })
  }, [prevMeeting.id])

  const unresolved = commitments.filter(c => c.linked_task?.status !== 'done')
  const done = commitments.filter(c => c.linked_task?.status === 'done')

  return (
    <section className="cd-tm-section">
      <div className="cd-tm-section-hd">
        <Icon name="history" size={14} />
        <span>Previous meeting — {fmtDate(prevMeeting.scheduled_at)}</span>
      </div>

      {loading && <p className="cd-loading" style={{ fontSize: 12, padding: '6px 0' }}>Loading…</p>}

      {!loading && commitments.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', margin: 0 }}>No commitments were logged.</p>
      )}

      {unresolved.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Unresolved ({unresolved.length})
          </div>
          {unresolved.map(c => {
            const carried = alreadyCarried.has(c.id)
            return (
              <div key={c.id} className="cd-tm-commitment-row" style={{ opacity: carried ? 0.55 : 1 }}>
                <Avatar
                  person={c.person ? { id: c.person.id, name: c.person.full_name, color: c.person.color, avatar_url: c.person.avatar_url, role: '', initials: c.person.full_name.charAt(0) } : null}
                  size={22}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{c.description}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <TaskStatusDot status={c.linked_task?.status} />
                    {c.person && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{c.person.full_name}</span>}
                  </div>
                </div>
                {!carried ? (
                  <button
                    className="cd-btn cd-btn-ghost"
                    style={{ fontSize: 12, padding: '3px 10px' }}
                    type="button"
                    onClick={() => setCarryTarget(c)}
                  >
                    Carry forward
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>Carried</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: unresolved.length > 0 ? 12 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1F7A4D', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Completed ({done.length})
          </div>
          {done.map(c => (
            <div key={c.id} className="cd-tm-commitment-row" style={{ opacity: 0.65 }}>
              <Avatar
                person={c.person ? { id: c.person.id, name: c.person.full_name, color: c.person.color, avatar_url: c.person.avatar_url, role: '', initials: c.person.full_name.charAt(0) } : null}
                size={22}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--ink-dim)' }}>{c.description}</div>
                <TaskStatusDot status="done" />
              </div>
            </div>
          ))}
        </div>
      )}

      {carryTarget && (
        <CarryForwardModal
          commitment={carryTarget}
          toMeeting={currentMeeting}
          orgId={orgId}
          currentUserId={currentUserId}
          onClose={() => setCarryTarget(null)}
          onCarried={c => { onCarried(c); setCarryTarget(null) }}
        />
      )}
    </section>
  )
}

// ── Signal label badges ───────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, { label: string; color: string }> = {
  declining_confidence: { label: 'Declining confidence', color: '#9A6A11' },
  overdue:             { label: 'Overdue',              color: '#B23A3A' },
  repeatedly_carried:  { label: 'Stuck — carried 2×+', color: '#7C3A9A' },
}

function SignalBadge({ signal }: { signal: keyof typeof SIGNAL_LABELS }) {
  const { label, color } = SIGNAL_LABELS[signal]
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '.04em', padding: '2px 7px',
      borderRadius: 4, background: color + '18', color,
    }}>
      {label}
    </span>
  )
}

// ── Needs Attention section ───────────────────────────────────────────────────

interface NeedsAttentionProps {
  meeting: TeamMeeting
  cycleId: string | null
  unitTasks: UnifiedTask[]
  commitments: TeamMeetingCommitment[]
}

function NeedsAttentionSection({ meeting, cycleId, unitTasks, commitments }: NeedsAttentionProps) {
  const [decliningKRs, setDecliningKRs] = useState<DecliningKR[]>([])
  const [deepCarried, setDeepCarried] = useState<TeamMeetingCommitment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getDecliningConfidenceKRs(meeting.unit_id, cycleId),
      getDeepCarryForwardCommitments(commitments),
    ]).then(([declining, deep]) => {
      setDecliningKRs(declining)
      setDeepCarried(deep)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [meeting.unit_id, cycleId, commitments])

  const overdueItems = unitTasks.filter(t => isOverdue(t.due_date, t.status))

  const totalSignals = decliningKRs.length + overdueItems.length + deepCarried.length

  if (!loading && totalSignals === 0) return null

  return (
    <section className="cd-tm-section" style={{ borderLeft: '3px solid #B23A3A', paddingLeft: 14 }}>
      <div className="cd-tm-section-hd">
        <Icon name="alertTriangle" size={14} />
        <span style={{ color: '#B23A3A', fontWeight: 700 }}>Needs attention</span>
        {!loading && <span style={{ fontSize: 12, color: '#B23A3A', opacity: 0.7 }}>{totalSignals} signal{totalSignals !== 1 ? 's' : ''}</span>}
      </div>

      {loading && <p className="cd-loading" style={{ fontSize: 12, padding: '4px 0' }}>Checking…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Declining confidence */}
        {decliningKRs.map(kr => (
          <div key={kr.kr_id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <SignalBadge signal="declining_confidence" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{kr.kr_title}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
              {kr.objective_title && <span>{kr.objective_title} · </span>}
              {kr.owner_name && <span>{kr.owner_name} · </span>}
              Confidence: {kr.values.join(' → ')}
            </div>
          </div>
        ))}

        {/* Overdue items */}
        {overdueItems.map(t => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <SignalBadge signal="overdue" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
              {t.assignee?.full_name && <span>{t.assignee.full_name} · </span>}
              {t.source_label}
              {t.due_date && <span> · Due {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            </div>
          </div>
        ))}

        {/* Repeatedly carried commitments */}
        {deepCarried.map(c => (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <SignalBadge signal="repeatedly_carried" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{c.description}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
              {c.person?.full_name && <span>{c.person.full_name} · </span>}
              Carried forward more than once without being resolved
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Accountability overview section ───────────────────────────────────────────

function AccountabilitySection({ unitId, isManager }: { unitId: string; isManager: boolean }) {
  const [tasks, setTasks] = useState<UnifiedTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isManager) { setLoading(false); return }
    setLoading(true)
    getUnitTasks(unitId).then(t => { setTasks(t); setLoading(false) }).catch(() => setLoading(false))
  }, [unitId, isManager])

  if (!isManager) return null

  // Group by assignee_id
  const byPerson: Record<string, UnifiedTask[]> = {}
  for (const t of tasks) {
    const key = t.assignee_id ?? 'unknown'
    if (!byPerson[key]) byPerson[key] = []
    byPerson[key].push(t)
  }

  const personEntries = Object.entries(byPerson)

  return (
    <section className="cd-tm-section">
      <div className="cd-tm-section-hd">
        <Icon name="users" size={14} />
        <span>Team accountability</span>
        {!loading && tasks.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{tasks.length} open</span>
        )}
      </div>

      {loading && <p className="cd-loading" style={{ fontSize: 12, padding: '4px 0' }}>Loading…</p>}

      {!loading && tasks.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', margin: 0 }}>No open items across the team.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {personEntries.map(([personId, items]) => {
          const sample = items[0]
          const assignee = sample?.assignee
          const name = assignee?.full_name ?? personId
          return (
            <div key={personId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <Avatar
                  person={assignee ? { id: personId, name, color: assignee.color, avatar_url: assignee.avatar_url, role: '', initials: name.charAt(0) } : null}
                  size={22}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{items.length} open</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 29 }}>
                {items.map(t => {
                  const overdue = isOverdue(t.due_date, t.status)
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: overdue ? 'var(--danger, #B23A3A)' : undefined }}>
                          {overdue && '⚠ '}{t.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{
                            padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 500,
                            background: t.source === 'kr' ? '#3b82f618' : t.source === 'commitment' ? '#7C3A9A18' : 'var(--ink-faint)',
                            color: t.source === 'kr' ? '#3b82f6' : t.source === 'commitment' ? '#7C3A9A' : 'var(--ink-dim)',
                          }}>
                            {t.source === 'kr' ? 'OKR task' : t.source === 'commitment' ? 'Commitment' : 'Task'}
                          </span>
                          <span>{t.source_label}</span>
                          {t.due_date && (
                            <span style={{ color: overdue ? '#B23A3A' : undefined }}>
                              Due {new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Results review section ────────────────────────────────────────────────────

function ResultsSection({ unitId, cycleId }: { unitId: string; cycleId: string | null }) {
  const [objectives, setObjectives] = useState<CadenceObjective[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    async function load() {
      const { data: members } = await supabase
        .from('people_units')
        .select('person_id')
        .eq('unit_id', unitId)

      const memberIds = (members ?? []).map((m: any) => m.person_id)
      if (memberIds.length === 0) { setObjectives([]); setLoading(false); return }

      let q = supabase
        .from('objectives')
        .select(`
          id, title, status, cycle_id, owner_id,
          unit_id, level_id, parent_objective_id,
          owner:profiles!owner_id(id, full_name, avatar_url, color, role),
          key_results(id, title, target_type, start_value, target_value, current_value, unit, owner_id, confidence)
        `)
        .in('owner_id', memberIds)
        .order('created_at', { ascending: false })
        .limit(50)

      if (cycleId) q = q.eq('cycle_id', cycleId)

      const { data: objs } = await q

      const mapped: CadenceObjective[] = (objs ?? []).map((o: any) => {
        const krs: CadenceKeyResult[] = (o.key_results ?? []).map((k: any) => ({
          ...k,
          confidence: [] as (number | null)[],
        }))
        return {
          ...o,
          description: null,
          key_results: krs,
          confidence: [],
          progress: objectiveProgress(krs),
        } as CadenceObjective
      })
      setObjectives(mapped)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [unitId, cycleId])

  return (
    <section className="cd-tm-section">
      <div className="cd-tm-section-hd">
        <Icon name="target" size={14} />
        <span>Results review</span>
        <span style={{ fontSize: 12, color: 'var(--ink-faint)', marginLeft: 4 }}>live</span>
      </div>

      {loading && <p className="cd-loading" style={{ fontSize: 12, padding: '6px 0' }}>Loading…</p>}

      {!loading && objectives.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', margin: 0 }}>No objectives for this unit in the selected cycle.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {objectives.map(obj => {
          const pct = Math.round(obj.progress * 100)
          const owner = Array.isArray(obj.owner) ? obj.owner[0] : obj.owner
          return (
            <div key={obj.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Progress bar */}
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--ink-faint)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--ink-dim)', minWidth: 30, textAlign: 'right' }}>{pct}%</span>
                {/* Latest confidence from KRs */}
                {obj.key_results.length > 0 && (() => {
                  const confidences = obj.key_results.map(kr => {
                    const arr = Array.isArray(kr.confidence) ? kr.confidence : []
                    return [...arr].reverse().find(v => v != null) ?? null
                  }).filter(v => v != null) as number[]
                  const avg = confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null
                  return <ConfidenceCell value={avg} size={22} />
                })()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{obj.title}</div>
              {owner && (
                <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                  {(owner as any).full_name}
                </div>
              )}
              {obj.key_results.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, marginTop: 4, borderLeft: '2px solid var(--ink-faint)' }}>
                  {obj.key_results.map(kr => {
                    const arr = Array.isArray(kr.confidence) ? kr.confidence : []
                    const conf = [...arr].reverse().find(v => v != null) ?? null
                    const progress = kr.target_type === 'boolean'
                      ? kr.current_value >= 1 ? 1 : 0
                      : kr.target_value > 0
                        ? Math.min(1, Math.max(0, kr.current_value / kr.target_value))
                        : 0
                    return (
                      <div key={kr.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--ink-faint)', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--accent)', opacity: 0.65, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink-dim)', minWidth: 30, textAlign: 'right' }}>
                          {kr.current_value}{kr.unit ? ` ${kr.unit}` : ''}
                        </span>
                        <ConfidenceCell value={conf} size={18} />
                        <span style={{ fontSize: 12, color: 'var(--ink-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {kr.title}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Add commitment form ───────────────────────────────────────────────────────

interface AddCommitmentFormProps {
  meeting: TeamMeeting
  participants: TeamMeetingParticipant[]
  orgId: string
  currentUserId: string
  onAdded: (c: TeamMeetingCommitment) => void
}

function AddCommitmentForm({ meeting, participants, orgId, currentUserId, onAdded }: AddCommitmentFormProps) {
  const [open, setOpen] = useState(false)
  const [personId, setPersonId] = useState(currentUserId)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Default to current user if they're a participant
  useEffect(() => {
    const found = participants.find(p => p.person_id === currentUserId)
    if (found) setPersonId(currentUserId)
    else if (participants.length > 0) setPersonId(participants[0].person_id)
  }, [participants, currentUserId])

  async function handleAdd() {
    if (!description.trim() || !personId) return
    setSaving(true); setErr(null)
    try {
      const c = await addCommitment({ meetingId: meeting.id, meeting, personId, description: description.trim(), orgId, currentUserId })
      onAdded(c)
      setDescription('')
      setOpen(false)
    } catch (e: any) {
      setErr(e.message ?? 'Failed to add commitment')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        className="cd-btn cd-btn-ghost"
        type="button"
        style={{ alignSelf: 'flex-start', fontSize: 13 }}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={14} /> Add commitment
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
      <label className="cd-form-group" style={{ margin: 0 }}>
        <span className="cd-label">Person</span>
        <select className="cd-input" value={personId} onChange={e => setPersonId(e.target.value)}>
          {participants.map(p => (
            <option key={p.person_id} value={p.person_id}>
              {p.person?.full_name ?? p.person_id}
            </option>
          ))}
          {/* Allow non-participants too — they can add their own */}
          {!participants.some(p => p.person_id === currentUserId) && (
            <option value={currentUserId}>Me</option>
          )}
        </select>
      </label>
      <label className="cd-form-group" style={{ margin: 0 }}>
        <span className="cd-label">Commitment</span>
        <textarea
          className="cd-input"
          rows={2}
          placeholder="What will this person commit to doing?"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </label>
      {err && <p style={{ color: 'var(--red)', fontSize: 13, margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="cd-btn" type="button" onClick={handleAdd} disabled={saving || !description.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button className="cd-btn cd-btn-ghost" type="button" onClick={() => { setOpen(false); setDescription('') }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Meeting detail panel ──────────────────────────────────────────────────────

interface MeetingDetailProps {
  meeting: TeamMeeting
  userId: string
  orgId: string
  cycleId: string | null
  isManager: boolean
  onCompleted: (nextId: string | null) => void
}

function MeetingDetail({ meeting, userId, orgId, cycleId, isManager, onCompleted }: MeetingDetailProps) {
  const [participants, setParticipants] = useState<TeamMeetingParticipant[]>([])
  const [commitments, setCommitments] = useState<TeamMeetingCommitment[]>([])
  const [prevMeeting, setPrevMeeting] = useState<TeamMeeting | null>(null)
  const [planNotes, setPlanNotes] = useState(meeting.plan_notes ?? '')
  const [completing, setCompleting] = useState(false)
  const [unitMembers, setUnitMembers] = useState<PeopleUnit[]>([])
  const [addingParticipant, setAddingParticipant] = useState(false)
  const [addPersonId, setAddPersonId] = useState('')
  const [unitTasksForSignals, setUnitTasksForSignals] = useState<UnifiedTask[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Already-carried commitment IDs (from previous meeting, now in current)
  const alreadyCarried = new Set(
    commitments
      .filter(c => c.carried_forward_from_id != null)
      .map(c => c.carried_forward_from_id as string)
  )

  useEffect(() => {
    setPlanNotes(meeting.plan_notes ?? '')
    setCompleting(false)

    Promise.all([
      getParticipants(meeting.id),
      getCommitments(meeting.id),
      getPreviousMeeting(meeting.unit_id, meeting.scheduled_at),
      getUnitMembers(meeting.unit_id),
      isManager ? getUnitTasks(meeting.unit_id) : Promise.resolve([]),
    ]).then(([p, c, prev, members, tasks]) => {
      setParticipants(p)
      setCommitments(c)
      setPrevMeeting(prev)
      setUnitMembers(members)
      setUnitTasksForSignals(tasks as UnifiedTask[])
    })
  }, [meeting.id, meeting.unit_id, meeting.scheduled_at, meeting.plan_notes])

  const savePlanNotes = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateMeeting(meeting.id, { plan_notes: value }).catch(() => {})
    }, 800)
  }, [meeting.id])

  function handlePlanChange(v: string) {
    setPlanNotes(v)
    savePlanNotes(v)
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      const nextId = await completeMeeting(meeting, userId)
      onCompleted(nextId)
    } catch { setCompleting(false) }
  }

  // Participants not yet in this meeting (can be added)
  const nonParticipants = unitMembers.filter(m => !participants.some(p => p.person_id === m.person_id))

  async function handleAddParticipant() {
    if (!addPersonId) return
    await addParticipant(meeting.id, addPersonId)
    const updated = await getParticipants(meeting.id)
    setParticipants(updated)
    setAddingParticipant(false)
    setAddPersonId('')
  }

  async function handleRemoveParticipant(personId: string) {
    await removeParticipant(meeting.id, personId)
    setParticipants(prev => prev.filter(p => p.person_id !== personId))
  }

  const isCompleted = meeting.status === 'completed'

  return (
    <div className="cd-tm-detail">
      {/* Header */}
      <div className="cd-tm-detail-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {meeting.unit?.name ?? 'Team meeting'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
              <Icon name="calendar" size={12} /> {fmtDatetime(meeting.scheduled_at)}
            </span>
            <StatusBadge status={meeting.status} />
            <RecurrenceBadge recurrence={meeting.recurrence} />
          </div>
        </div>
        {isManager && !isCompleted && (
          <button
            className="cd-btn"
            type="button"
            style={{ marginLeft: 'auto' }}
            onClick={handleComplete}
            disabled={completing}
          >
            {completing ? 'Completing…' : 'Mark as completed'}
          </button>
        )}
      </div>

      {/* Participants */}
      <section className="cd-tm-section">
        <div className="cd-tm-section-hd">
          <Icon name="users" size={14} />
          <span>Participants</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {participants.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Avatar
                person={p.person ? { id: p.person.id, name: p.person.full_name, color: p.person.color, avatar_url: p.person.avatar_url, role: '', initials: p.person.full_name.charAt(0) } : null}
                size={26}
              />
              <span style={{ fontSize: 12 }}>{p.person?.full_name ?? p.person_id}</span>
              {isManager && !isCompleted && (
                <button
                  className="cd-btn-icon"
                  type="button"
                  style={{ opacity: 0.5, marginLeft: 2 }}
                  title="Remove"
                  onClick={() => handleRemoveParticipant(p.person_id)}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          ))}

          {isManager && !isCompleted && (
            addingParticipant ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select className="cd-input" style={{ fontSize: 12, padding: '3px 6px' }} value={addPersonId} onChange={e => setAddPersonId(e.target.value)}>
                  <option value="">Pick person…</option>
                  {nonParticipants.map(m => (
                    <option key={m.person_id} value={m.person_id}>{m.person?.name ?? m.person_id}</option>
                  ))}
                </select>
                <button className="cd-btn" style={{ fontSize: 12, padding: '3px 10px' }} type="button" onClick={handleAddParticipant} disabled={!addPersonId}>Add</button>
                <button className="cd-btn cd-btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }} type="button" onClick={() => setAddingParticipant(false)}>Cancel</button>
              </div>
            ) : (
              nonParticipants.length > 0 && (
                <button
                  className="cd-btn cd-btn-ghost"
                  type="button"
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  onClick={() => setAddingParticipant(true)}
                >
                  <Icon name="plus" size={12} /> Add
                </button>
              )
            )
          )}
        </div>
      </section>

      {/* Needs attention — leads only, shown at top so they walk in prepared */}
      {isManager && (
        <NeedsAttentionSection
          meeting={meeting}
          cycleId={cycleId}
          unitTasks={unitTasksForSignals}
          commitments={commitments}
        />
      )}

      {/* Previous meeting */}
      {prevMeeting && (
        <PrevMeetingPanel
          prevMeeting={prevMeeting}
          currentMeeting={meeting}
          orgId={orgId}
          currentUserId={userId}
          alreadyCarried={alreadyCarried}
          onCarried={c => setCommitments(prev => [...prev, c])}
        />
      )}

      {/* Results review */}
      <ResultsSection unitId={meeting.unit_id} cycleId={cycleId} />

      {/* Team accountability overview — leads only */}
      <AccountabilitySection unitId={meeting.unit_id} isManager={isManager} />

      {/* Next-period plan */}
      <section className="cd-tm-section">
        <div className="cd-tm-section-hd">
          <Icon name="pencil" size={14} />
          <span>Next-period plan</span>
        </div>
        <textarea
          className="cd-input"
          rows={4}
          placeholder="What are the priorities and focus areas for the next period?"
          value={planNotes}
          readOnly={isCompleted}
          onChange={isCompleted ? undefined : e => handlePlanChange(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </section>

      {/* Commitments */}
      <section className="cd-tm-section">
        <div className="cd-tm-section-hd">
          <Icon name="task" size={14} />
          <span>Commitments</span>
          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{commitments.length > 0 ? `${commitments.length}` : ''}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {commitments.map(c => (
            <div key={c.id} className="cd-tm-commitment-row">
              <Avatar
                person={c.person ? { id: c.person.id, name: c.person.full_name, color: c.person.color, avatar_url: c.person.avatar_url, role: '', initials: c.person.full_name.charAt(0) } : null}
                size={22}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{c.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  <TaskStatusDot status={c.linked_task?.status} />
                  {c.person && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{c.person.full_name}</span>}
                  {c.carried_forward_from_id && (
                    <span style={{ fontSize: 11, color: 'var(--ink-dim)', fontStyle: 'italic' }}>
                      Carried forward
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!isCompleted && (
          <div style={{ marginTop: commitments.length > 0 ? 12 : 0 }}>
            <AddCommitmentForm
              meeting={meeting}
              participants={participants}
              orgId={orgId}
              currentUserId={userId}
              onAdded={c => setCommitments(prev => [...prev, c])}
            />
          </div>
        )}
      </section>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TeamMeetingsPage() {
  const { profile } = useAuth()
  const { org } = useOrg()
  const { activeCycle } = useCycle()

  const userId = profile?.id ?? ''
  const orgId = org?.id ?? ''
  const cycleId = activeCycle?.id ?? null

  const [leadableUnits, setLeadableUnits] = useState<Unit[]>([])
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<TeamMeeting[]>([])
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<TeamMeeting | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load units where user is lead/admin
  useEffect(() => {
    if (!userId) return
    getLeadableUnits(userId).then(units => {
      setLeadableUnits(units)
      if (units.length > 0 && !selectedUnitId) {
        setSelectedUnitId(units[0].id)
      }
      setLoading(false)
    })
  }, [userId])

  // Load meetings when unit changes
  useEffect(() => {
    if (!selectedUnitId) return
    setSelectedMeetingId(null)
    setSelectedMeeting(null)
    getMeetingsForUnit(selectedUnitId).then(setMeetings)

    // Check manage permission for non-unit-lead scenario (e.g. global admin browsing)
    if (userId) canManageUnit(userId, selectedUnitId).then(setCanManage)
  }, [selectedUnitId, userId])

  // Load selected meeting detail
  useEffect(() => {
    if (!selectedMeetingId) { setSelectedMeeting(null); return }
    getMeeting(selectedMeetingId).then(setSelectedMeeting)
  }, [selectedMeetingId])

  function handleCreated(meeting: TeamMeeting) {
    setShowNew(false)
    if (meeting.unit_id !== selectedUnitId) {
      setSelectedUnitId(meeting.unit_id)
    }
    setMeetings(prev => [meeting, ...prev])
    setSelectedMeetingId(meeting.id)
    setSelectedMeeting(meeting)
  }

  async function handleCompleted(nextId: string | null) {
    // Refresh meeting list
    if (selectedUnitId) {
      const updated = await getMeetingsForUnit(selectedUnitId)
      setMeetings(updated)
    }
    // Reload current meeting to show 'completed' status
    if (selectedMeetingId) {
      const m = await getMeeting(selectedMeetingId)
      setSelectedMeeting(m)
    }
    // Switch to next meeting if auto-created
    if (nextId) {
      setSelectedMeetingId(nextId)
    }
  }

  const isLead = canManage || leadableUnits.some(u => u.id === selectedUnitId)

  if (loading) {
    return (
      <div className="cd-oo-layout">
        <p className="cd-loading" style={{ padding: 24 }}>Loading…</p>
      </div>
    )
  }

  return (
    <div className="cd-oo-layout">
      {/* Left sidebar */}
      <aside className="cd-oo-side">
        <div className="cd-oo-side-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Team meetings</span>
          {leadableUnits.length > 0 && (
            <button
              className="cd-btn-icon"
              type="button"
              title="New meeting"
              onClick={() => setShowNew(true)}
            >
              <Icon name="plus" size={14} />
            </button>
          )}
        </div>

        {/* Unit tabs (if lead of multiple units) */}
        {leadableUnits.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
            {leadableUnits.map(u => (
              <button
                key={u.id}
                type="button"
                className={'cd-oo-tab ' + (selectedUnitId === u.id ? 'is-on' : '')}
                onClick={() => setSelectedUnitId(u.id)}
                style={{ justifyContent: 'flex-start' }}
              >
                <Icon name="users" size={14} />
                <span>{u.name}</span>
              </button>
            ))}
          </div>
        )}

        {leadableUnits.length === 1 && (
          <div style={{ padding: '4px 12px 8px', fontSize: 13, color: 'var(--ink-dim)', fontWeight: 500 }}>
            {leadableUnits[0].name}
          </div>
        )}

        {/* Meeting list */}
        {meetings.length === 0 && (
          <p style={{ padding: '8px 14px', fontSize: 13, color: 'var(--ink-faint)' }}>No meetings yet.</p>
        )}
        {meetings.map(m => (
          <button
            key={m.id}
            type="button"
            className={'cd-oo-hist ' + (selectedMeetingId === m.id ? 'is-on' : '')}
            onClick={() => setSelectedMeetingId(m.id)}
            style={{ width: '100%', textAlign: 'left', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', border: 'none', background: 'transparent' }}
          >
            <div className="cd-oo-hist-date" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span>{fmtDate(m.scheduled_at)}</span>
              <StatusBadge status={m.status} />
            </div>
            {m.recurrence !== 'none' && (
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                {m.recurrence}
              </div>
            )}
          </button>
        ))}

        {leadableUnits.length === 0 && (
          <p style={{ padding: '8px 14px', fontSize: 13, color: 'var(--ink-faint)' }}>
            You are not a lead of any unit.
          </p>
        )}
      </aside>

      {/* Right panel */}
      <main className="cd-oo-main">
        {selectedMeeting ? (
          <MeetingDetail
            key={selectedMeeting.id}
            meeting={selectedMeeting}
            userId={userId}
            orgId={orgId}
            cycleId={cycleId}
            isManager={isLead}
            onCompleted={handleCompleted}
          />
        ) : (
          <EmptyState
            title={leadableUnits.length === 0 ? 'No units to manage' : meetings.length === 0 ? 'No meetings yet' : 'Select a meeting'}
            description={
              leadableUnits.length === 0
                ? 'You need to be a unit lead or admin to create team meetings.'
                : meetings.length === 0
                  ? 'Create your first team meeting using the + button.'
                  : 'Choose a meeting from the list to view and manage it.'
            }
          />
        )}
      </main>

      {showNew && (
        <NewMeetingModal
          leadableUnits={leadableUnits}
          defaultUnitId={selectedUnitId}
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
          orgId={orgId}
          userId={userId}
          cycleId={cycleId}
        />
      )}
    </div>
  )
}
