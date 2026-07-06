import { useEffect, useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/cadence/PageHeader'
import { Icon } from '../components/cadence/Icon'
import {
  getCycles, createCycle, setCycleStatus, lockCycleScores,
  type FullCycle, type CycleStatus,
} from '../services/reviewCycles.service'

// ── Status badge ──────────────────────────────────────────────────────────

const STATUS_CFG: Record<CycleStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',      color: 'var(--ink-faint)' },
  active:    { label: 'Active',     color: 'var(--ok)' },
  reviewing: { label: 'Reviewing',  color: 'var(--warn)' },
  archived:  { label: 'Archived',   color: 'var(--ink-soft)' },
}

function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft
  return (
    <span className="cd-um-badge" style={{ color: cfg.color, borderColor: `color-mix(in oklab, ${cfg.color} 30%, transparent)` }}>
      {cfg.label}
    </span>
  )
}

// ── Create cycle form ─────────────────────────────────────────────────────

function CreateCycleForm({ onCreated }: { onCreated: () => void }) {
  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState({
    label: '', year: currentYear, quarter: 1 as 1 | 2 | 3 | 4,
    start_date: '', end_date: '', review_closes_at: '',
  })
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Auto-fill label when year/quarter changes
  function setYQ(year: number, quarter: number) {
    setForm(p => ({ ...p, year, quarter: quarter as 1|2|3|4, label: `Q${quarter} ${year}` }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.start_date || !form.end_date) { setErr('Start and end dates required'); return }
    setCreating(true)
    setErr(null)
    try {
      await createCycle({
        label: form.label || `Q${form.quarter} ${form.year}`,
        year: form.year,
        quarter: form.quarter,
        start_date: form.start_date,
        end_date: form.end_date,
        review_closes_at: form.review_closes_at || undefined,
      })
      onCreated()
    } catch (ex) {
      setErr(getErrorMessage(ex))
    } finally {
      setCreating(false)
    }
  }

  return (
    <form className="cd-cycles-create-form" onSubmit={handleCreate}>
      <div className="cd-um-invite-title">New cycle</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="cd-um-select" value={form.quarter}
          onChange={e => setYQ(form.year, parseInt(e.target.value))}>
          {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
        </select>
        <input type="number" className="cd-um-input" value={form.year}
          onChange={e => setYQ(parseInt(e.target.value) || currentYear, form.quarter)}
          style={{ width: 80 }} />
      </div>
      <input className="cd-um-input" placeholder="Label (e.g. Q2 2026)"
        value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>Start date</div>
          <input type="date" className="cd-um-input"
            value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>End date</div>
          <input type="date" className="cd-um-input"
            value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>Review closes (optional)</div>
        <input type="date" className="cd-um-input"
          value={form.review_closes_at} onChange={e => setForm(p => ({ ...p, review_closes_at: e.target.value }))} />
      </div>
      {err && <div className="cd-um-error">{err}</div>}
      <button type="submit" className="cd-btn cd-btn-primary" disabled={creating}>
        {creating ? 'Creating…' : 'Create cycle'}
      </button>
    </form>
  )
}

// ── Cycle row ─────────────────────────────────────────────────────────────

function CycleRow({
  cycle,
  allCycles,
  onStatusChange,
  onLock,
}: {
  cycle: FullCycle
  allCycles: FullCycle[]
  onStatusChange: () => void
  onLock: () => void
}) {
  const navigate = useNavigate()
  const [working, setWorking] = useState(false)
  const [showLockForm, setShowLockForm] = useState(false)
  const [nextCycleId, setNextCycleId] = useState('')
  const [reviewCloses, setReviewCloses] = useState('')

  const nextCycleCandidates = allCycles.filter(c => c.id !== cycle.id && c.status === 'active')

  async function transition(status: CycleStatus, extra?: { review_closes_at?: string }) {
    setWorking(true)
    try { await setCycleStatus(cycle.id, status, extra); onStatusChange() }
    catch (e) { alert(getErrorMessage(e)) }
    finally { setWorking(false) }
  }

  async function handleLock() {
    setWorking(true)
    try { await lockCycleScores(cycle.id, nextCycleId || null); onLock() }
    catch (e) { alert(getErrorMessage(e)) }
    finally { setWorking(false); setShowLockForm(false) }
  }

  return (
    <div className="cd-cycles-row">
      <div className="cd-cycles-row-main">
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="cd-cycles-label">{cycle.label}</span>
            <CycleStatusBadge status={cycle.status} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2 }}>
            {cycle.start_date} → {cycle.end_date}
            {cycle.review_closes_at && cycle.status === 'reviewing' && (
              <span style={{ marginLeft: 8, color: 'var(--warn)' }}>
                · Review closes {cycle.review_closes_at.slice(0, 10)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Lifecycle transitions */}
          {cycle.status === 'draft' && (
            <button type="button" className="cd-btn cd-btn-primary" disabled={working}
              onClick={() => transition('active')}>
              Open for check-ins
            </button>
          )}
          {cycle.status === 'active' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {showLockForm ? null : (
                <button type="button" className="cd-btn" disabled={working}
                  onClick={() => setShowLockForm(true)}>
                  Start review
                </button>
              )}
            </div>
          )}
          {cycle.status === 'reviewing' && (
            <button type="button" className="cd-btn" disabled={working}
              onClick={() => setShowLockForm(true)}>
              Archive & lock scores
            </button>
          )}
          {(cycle.status === 'active' || cycle.status === 'archived' || cycle.status === 'reviewing') && (
            <button type="button" className="cd-btn-icon" title="View summary"
              onClick={() => navigate(`/cycles/${cycle.id}/summary`)}>
              <Icon name="chevronR" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Inline form for start review */}
      {showLockForm && cycle.status === 'active' && (
        <div className="cd-cycles-inline-form">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Open review period</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>Review closes</div>
            <input type="date" className="cd-um-input" value={reviewCloses}
              onChange={e => setReviewCloses(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="cd-btn cd-btn-primary" disabled={working}
              onClick={() => transition('reviewing', { review_closes_at: reviewCloses || undefined })}>
              {working ? 'Opening…' : 'Open review & notify team'}
            </button>
            <button type="button" className="cd-btn" onClick={() => setShowLockForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Inline form for archive/lock */}
      {showLockForm && cycle.status === 'reviewing' && (
        <div className="cd-cycles-inline-form">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lock final scores & archive</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 3 }}>
              Carry forward into (optional)
            </div>
            <select className="cd-um-select" value={nextCycleId}
              onChange={e => setNextCycleId(e.target.value)}>
              <option value="">— no carry-forward —</option>
              {nextCycleCandidates.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="cd-um-error" style={{ color: 'var(--warn)' }}>
            This will lock all scores and archive the cycle. Cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="cd-btn cd-btn-danger" disabled={working} onClick={handleLock}>
              {working ? 'Locking…' : 'Lock & archive'}
            </button>
            <button type="button" className="cd-btn" onClick={() => setShowLockForm(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function CyclesPage() {
  const [cycles, setCycles] = useState<FullCycle[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    setLoading(true)
    try { setCycles(await getCycles()) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const activeCycles = cycles.filter(c => c.status === 'active' || c.status === 'reviewing')
  const archivedCycles = cycles.filter(c => c.status === 'archived')
  const draftCycles = cycles.filter(c => c.status === 'draft')

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading cycles…</p></div>

  return (
    <div className="cd-page">
      <PageHeader title="Cycles" sub="Manage OKR cycles and review periods" />

      {/* Create button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button type="button" className="cd-btn cd-btn-primary" onClick={() => setShowCreate(s => !s)}>
          <Icon name="plus" size={13} /> New cycle
        </button>
      </div>

      {showCreate && (
        <CreateCycleForm onCreated={() => { load(); setShowCreate(false) }} />
      )}

      {/* Active / reviewing */}
      {activeCycles.length > 0 && (
        <div className="cd-cycles-group">
          <div className="cd-um-section-title">Active</div>
          {activeCycles.map(c => (
            <CycleRow key={c.id} cycle={c} allCycles={cycles} onStatusChange={load} onLock={load} />
          ))}
        </div>
      )}

      {/* Draft */}
      {draftCycles.length > 0 && (
        <div className="cd-cycles-group">
          <div className="cd-um-section-title">Draft</div>
          {draftCycles.map(c => (
            <CycleRow key={c.id} cycle={c} allCycles={cycles} onStatusChange={load} onLock={load} />
          ))}
        </div>
      )}

      {/* Archived */}
      {archivedCycles.length > 0 && (
        <div className="cd-cycles-group">
          <div className="cd-um-section-title">Archived</div>
          {archivedCycles.map(c => (
            <CycleRow key={c.id} cycle={c} allCycles={cycles} onStatusChange={load} onLock={load} />
          ))}
        </div>
      )}

      {cycles.length === 0 && (
        <p className="cd-empty-hint">No cycles yet. Create one to get started.</p>
      )}
    </div>
  )
}
