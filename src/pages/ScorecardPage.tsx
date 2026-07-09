import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCycle } from '../context/CycleContext'
import { supabase } from '../lib/supabase'
import { Avatar } from '../components/cadence/Avatar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Sparkline } from '../components/cadence/Sparkline'
import { StatusChip } from '../components/cadence/StatusChip'
import { PageHeader } from '../components/cadence/PageHeader'
import { Card, CardHeader } from '../components/cadence/Card'
import { Icon } from '../components/cadence/Icon'
import { CdModal } from '../components/cadence/CdModal'
import { fmt, isOnTrack, makeTrend } from '../lib/cadenceUtils'
import { getKPIs } from '../services/kpis.service'
import { getInitiativesForPerson, createInitiative } from '../services/initiatives.service'
import { getMyReports } from '../services/oneOnOnes.service'
import { objectivesService } from '../services/objectives.service'
import type { KPI, Initiative, Person } from '../types/cadence'
import type { Objective } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────

interface ProfileMeta {
  joinDate: string
  managerName: string | null
  nextReview: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function fmtReviewDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function objProgress(o: Objective): number {
  const krs = o.key_results ?? []
  if (krs.length === 0) return 0
  const avg = krs.reduce((sum, kr) => {
    const ratio = kr.target_value > 0 ? kr.current_value / kr.target_value : 0
    return sum + Math.min(ratio, 1)
  }, 0) / krs.length
  return avg
}

function progressToConf(progress: number): number {
  return Math.max(1, Math.round(progress * 10))
}

function objSparkline(o: Objective): number[] {
  const seed = o.id.charCodeAt(0) * 17
  const conf = progressToConf(objProgress(o))
  return Array.from({ length: 13 }, (_, i) => {
    const noise = Math.sin(seed + i * 1.7) * 1.5
    return Math.max(1, Math.min(10, conf * 0.7 + (i / 12) * conf * 0.3 + noise))
  })
}

// ── KPI delta chip ────────────────────────────────────────────────────────

function KpiDeltaChip({ actual, planToDate, good, unit }: {
  actual: number; planToDate: number; good: 'up' | 'down'; unit: string
}) {
  const diff = actual - planToDate
  const isGoodDir = good === 'up' ? diff >= 0 : diff <= 0
  const cls = isGoodDir ? 'cd-delta cd-delta--up' : 'cd-delta cd-delta--dn'
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '—'
  return (
    <span className={cls}>
      {arrow} {fmt(Math.abs(diff))}{unit ? <span className="cd-unit">{unit}</span> : null}
    </span>
  )
}

// ── Add Initiative Modal ──────────────────────────────────────────────────

function AddInitiativeModal({
  open,
  onClose,
  personId,
  userId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  personId: string
  userId: string
  onCreated: () => void
}) {
  const [title, setTitle]   = useState('')
  const [due, setDue]       = useState('Q4 2026')
  const [status, setStatus] = useState<Initiative['status']>('On track')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await createInitiative({
        title: title.trim(),
        unit_id: null,
        status,
        due,
        year: new Date().getFullYear(),
        owner_person_id: personId,
        created_by: userId,
      })
      setTitle('')
      onCreated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <CdModal open={open} onClose={onClose} title="Add Initiative">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="cd-form-lbl">Initiative title</label>
          <input
            className="cd-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Launch mobile app"
            required
            autoFocus
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="cd-form-lbl">Due</label>
            <select className="cd-input" value={due} onChange={e => setDue(e.target.value)}>
              {['Q1 2026','Q2 2026','Q3 2026','Q4 2026'].map(q => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="cd-form-lbl">Status</label>
            <select
              className="cd-input"
              value={status}
              onChange={e => setStatus(e.target.value as Initiative['status'])}
            >
              <option>On track</option>
              <option>At risk</option>
              <option>Off track</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="cd-btn cd-btn-primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add initiative'}
          </button>
        </div>
      </form>
    </CdModal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ScorecardPage() {
  const { user } = useAuth()
  const { activeCycle } = useCycle()
  const navigate = useNavigate()

  const [reports, setReports]         = useState<Person[]>([])
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [kpis, setKpis]               = useState<KPI[]>([])
  const [allKpis, setAllKpis]         = useState<KPI[]>([])
  const [initiatives, setInitiatives] = useState<Initiative[]>([])
  const [objectives, setObjectives]   = useState<Objective[]>([])
  const [meta, setMeta]               = useState<ProfileMeta | null>(null)
  const [loading, setLoading]         = useState(false)
  const [addOpen, setAddOpen]         = useState(false)

  // Load reports list
  useEffect(() => {
    if (!user?.id) return
    getMyReports(user.id).then(people => {
      setReports(people)
      if (people.length > 0) setSelectedId(prev => prev ?? people[0].id)
    })
  }, [user?.id])

  // Load all KPIs once for sidebar status dots
  useEffect(() => {
    if (!activeCycle?.id) return
    getKPIs(activeCycle.id).then(setAllKpis).catch(() => setAllKpis([]))
  }, [activeCycle?.id])

  const loadPersonData = useCallback(async (personId: string) => {
    if (!activeCycle?.id) return
    setLoading(true)
    try {
      const year = new Date().getFullYear()
      const [allKpiData, inits, objs] = await Promise.all([
        getKPIs(activeCycle.id),
        getInitiativesForPerson(personId, year),
        objectivesService.getByOwner(activeCycle.id, personId),
      ])

      setAllKpis(allKpiData)
      setKpis(allKpiData.filter(k =>
        k.owner_person_id === personId || k.owner_id === personId,
      ))
      setInitiatives(inits)
      setObjectives(objs)

      // Profile meta
      const [profileRes, unitRes] = await Promise.all([
        supabase.from('profiles').select('created_at').eq('id', personId).single(),
        supabase
          .from('people_units')
          .select('unit_id')
          .eq('person_id', personId)
          .in('role', ['member', 'contributor'])
          .eq('is_primary', true)
          .limit(1),
      ])

      let managerName: string | null = null
      if (unitRes.data && unitRes.data.length > 0) {
        const unitId = (unitRes.data[0] as any).unit_id
        const { data: leads } = await supabase
          .from('people_units')
          .select('person:profiles!person_id(full_name)')
          .eq('unit_id', unitId)
          .in('role', ['admin', 'lead'])
          .neq('person_id', personId)
          .limit(1)
        if (leads && leads.length > 0) {
          managerName = (leads[0] as any).person?.full_name ?? null
        }
      }

      setMeta({
        joinDate:   profileRes.data?.created_at ? fmtDate(profileRes.data.created_at) : '—',
        managerName,
        nextReview: activeCycle.end_date ? fmtReviewDate(activeCycle.end_date) : null,
      })
    } finally {
      setLoading(false)
    }
  }, [activeCycle?.id, activeCycle?.end_date])

  useEffect(() => {
    if (selectedId) loadPersonData(selectedId)
  }, [selectedId, loadPersonData])

  const selectedPerson = reports.find(p => p.id === selectedId) ?? null

  const confAvg = objectives.length > 0
    ? (objectives.reduce((s, o) => s + progressToConf(objProgress(o)), 0) / objectives.length).toFixed(1)
    : '—'

  if (!user) return null

  return (
    <div className="cd-page">
      <PageHeader
        title="Job Scorecard"
        sub="Every role has a scorecard. KPIs they own, annual initiatives they lead, and quarterly outcomes."
        actions={
          <>
            <button className="cd-btn cd-btn-secondary" onClick={() => navigate('/1on1s')}>
              <Icon name="chat" size={14} /> 1:1 history
            </button>
            <button className="cd-btn cd-btn-secondary" onClick={() => navigate('/review')}>
              <Icon name="check" size={14} /> Quarterly review
            </button>
          </>
        }
      />

      <div className="cd-sc-layout">
        {/* ── Sidebar ── */}
        <aside className="cd-sc-people">
          <div className="cd-sc-people-hd">
            <span>Team · {reports.length} reports</span>
          </div>
          {reports.length === 0 && (
            <div className="cd-empty" style={{ padding: '20px 16px' }}>
              <Icon name="info" size={14} />
              <span>No direct reports found.</span>
            </div>
          )}
          {reports.map(p => {
            const pKpis = allKpis.filter(k =>
              k.owner_person_id === p.id || k.owner_id === p.id,
            )
            const offCount = pKpis.filter(k => !isOnTrack(k)).length
            return (
              <button
                key={p.id}
                className={'cd-sc-person ' + (selectedId === p.id ? 'is-on' : '')}
                onClick={() => setSelectedId(p.id)}
              >
                <Avatar person={p} size={32} />
                <div className="cd-sc-person-text">
                  <div className="cd-sc-person-name">{p.name}</div>
                  <div className="cd-sc-person-role">{p.role}</div>
                </div>
                <div className="cd-sc-person-meta">
                  {offCount > 0
                    ? <span className="cd-dot is-bad" />
                    : <span className="cd-dot is-ok" />}
                  <span>{pKpis.length}</span>
                </div>
              </button>
            )
          })}
        </aside>

        {/* ── Main content ── */}
        <main className="cd-sc-main">
          {!selectedPerson && !loading && (
            <div className="cd-empty">Select a person to view their scorecard.</div>
          )}

          {selectedPerson && (
            <>
              {/* Profile snapshot */}
              <Card className="cd-sc-profile">
                <div className="cd-sc-prof-row">
                  <Avatar person={selectedPerson} size={56} />
                  <div className="cd-sc-prof-text">
                    <div className="cd-sc-prof-name">{selectedPerson.name}</div>
                    <div className="cd-sc-prof-role">{selectedPerson.role}</div>
                    <div className="cd-sc-prof-meta">
                      {meta ? (
                        <>
                          <span>Joined {meta.joinDate}</span>
                          {meta.managerName && (
                            <>
                              <span className="cd-dot-sep" />
                              <span>Manager: {meta.managerName}</span>
                            </>
                          )}
                          {meta.nextReview && (
                            <>
                              <span className="cd-dot-sep" />
                              <span>Next review: {meta.nextReview}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="cd-num-faint">Loading…</span>
                      )}
                    </div>
                  </div>
                  <div className="cd-sc-prof-snap">
                    <div>
                      <span className="cd-sc-prof-snap-lbl">Confidence avg</span>
                      <span className="cd-sc-prof-snap-val">{confAvg}/10</span>
                    </div>
                    <div>
                      <span className="cd-sc-prof-snap-lbl">KPIs on plan</span>
                      <span className="cd-sc-prof-snap-val">{kpis.filter(isOnTrack).length}/{kpis.length}</span>
                    </div>
                    <div>
                      <span className="cd-sc-prof-snap-lbl">Initiatives</span>
                      <span className="cd-sc-prof-snap-val">{initiatives.length}</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* KPIs */}
              <Card>
                <CardHeader
                  title="Key Performance Indicators"
                  sub="Plan vs actual · this quarter"
                  action={
                    <a className="cd-link" href="/kpis">
                      All KPIs <Icon name="chevronR" size={12} />
                    </a>
                  }
                />
                {loading ? (
                  <div className="cd-num-faint" style={{ padding: '12px 0' }}>Loading…</div>
                ) : kpis.length === 0 ? (
                  <div className="cd-empty">
                    <Icon name="info" size={14} />
                    <span>No KPIs assigned to {selectedPerson.name.split(' ')[0]} yet.</span>
                  </div>
                ) : (
                  <div className="cd-sc-kpi-list">
                    {kpis.map(k => {
                      const ok = isOnTrack(k)
                      const trend = k.trend.length >= 3 ? k.trend : makeTrend(k)
                      return (
                        <div key={k.id} className="cd-sc-kpi">
                          <div className="cd-sc-kpi-l">
                            <div className="cd-sc-kpi-name">
                              <span className={'cd-dot ' + (ok ? 'is-ok' : 'is-bad')} />
                              {k.name}
                            </div>
                            <div className="cd-sc-kpi-nums">
                              <span>
                                <span className="cd-sc-kpi-num">{fmt(k.actual)}</span>
                                <span className="cd-unit">{k.unit}</span>
                              </span>
                              <span className="cd-sc-kpi-vs">vs plan</span>
                              <span className="cd-num-faint">{fmt(k.plan)}{k.unit}</span>
                              <KpiDeltaChip
                                actual={k.actual}
                                planToDate={k.plan_to_date}
                                good={k.good}
                                unit={k.unit}
                              />
                            </div>
                          </div>
                          <div className="cd-sc-kpi-r">
                            <Sparkline
                              values={trend}
                              width={140}
                              height={32}
                              stroke={ok ? 'var(--ok)' : 'var(--bad)'}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>

              {/* Initiatives */}
              <Card>
                <CardHeader
                  title="Annual initiatives"
                  sub={String(new Date().getFullYear())}
                  action={
                    <button
                      className="cd-btn-icon"
                      title="Add initiative"
                      onClick={() => setAddOpen(true)}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                  }
                />
                {loading ? (
                  <div className="cd-num-faint" style={{ padding: '12px 0' }}>Loading…</div>
                ) : initiatives.length === 0 ? (
                  <div className="cd-empty">
                    <Icon name="info" size={14} />
                    <span>No initiatives owned by {selectedPerson.name.split(' ')[0]} this year.</span>
                  </div>
                ) : (
                  <div className="cd-sc-init-list">
                    {initiatives.map(i => (
                      <div key={i.id} className="cd-sc-init">
                        <Icon name="flag" size={14} />
                        <span className="cd-sc-init-title">{i.title}</span>
                        <StatusChip status={i.status} size="sm" />
                        <div className="cd-sc-init-bar">
                          <div
                            className="cd-sc-init-bar-fill"
                            style={{ width: (i.progress * 100) + '%' }}
                          />
                        </div>
                        <span className="cd-sc-init-pct">{Math.round(i.progress * 100)}%</span>
                        <span className="cd-sc-init-due">Due {i.due ?? i.due_label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Objectives */}
              <Card>
                <CardHeader title="Objectives owned or contributed to" sub="This quarter" />
                {loading ? (
                  <div className="cd-num-faint" style={{ padding: '12px 0' }}>Loading…</div>
                ) : objectives.length === 0 ? (
                  <div className="cd-empty">No objectives this quarter.</div>
                ) : (
                  <div className="cd-sc-obj-list">
                    {objectives.map(o => {
                      const conf = progressToConf(objProgress(o))
                      return (
                        <div key={o.id} className="cd-sc-obj">
                          <ConfidenceCell value={conf} size={28} />
                          <div className="cd-sc-obj-title">{o.title}</div>
                          <div className="cd-sc-obj-team">{o.unit?.name ?? '—'}</div>
                          <Sparkline
                            values={objSparkline(o)}
                            width={100}
                            height={24}
                            stroke="var(--accent)"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </main>
      </div>

      {selectedId && (
        <AddInitiativeModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          personId={selectedId}
          userId={user.id}
          onCreated={() => loadPersonData(selectedId)}
        />
      )}
    </div>
  )
}
