import { useState, useRef, useEffect } from 'react'
import { usePageActionStore } from '../stores/pageActionStore'
import { useAuth } from '../context/AuthContext'
import { useCycle } from '../context/CycleContext'
import { useKPIs } from '../hooks/useKPIs'
import { Avatar } from '../components/cadence/Avatar'
import { Sparkline } from '../components/cadence/Sparkline'
import { Segmented } from '../components/cadence/Segmented'
import { CdModal } from '../components/cadence/CdModal'
import { Icon } from '../components/cadence/Icon'
import { fmt, isOnTrack, makeTrend } from '../lib/cadenceUtils'
import { createKPI, getAdminUnits, getUnitMembers } from '../services/kpis.service'
import { getErrorMessage } from '../lib/errors'
import type { KPI, Person } from '../types/cadence'
import { EmptyState } from '../components/cadence/EmptyState'
import { usePageTitle } from '../hooks/usePageTitle'

// ── Delta chip (design-matching) ─────────────────────────────────────────

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

// ── Inline-editable actual value ─────────────────────────────────────────

function ActualCell({ kpi, onSave }: { kpi: KPI; onSave: (v: number) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(kpi.actual))
  const [flash, setFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setVal(String(kpi.actual))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    const n = parseFloat(val)
    if (!isNaN(n) && n !== kpi.actual) {
      await onSave(n)
      setFlash(true)
      setTimeout(() => setFlash(false), 1500)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="cd-kpi-actual-input"
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ width: 72, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}
      />
    )
  }

  return (
    <span
      className="cd-num cd-kpi-actual-val"
      title="Click to update"
      onClick={startEdit}
      style={{ cursor: 'pointer', borderBottom: '1px dashed var(--ink-faint)' }}
    >
      {fmt(kpi.actual)}
      {flash && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--ok)', fontWeight: 500 }}>✓</span>}
    </span>
  )
}

// ── KPI row ───────────────────────────────────────────────────────────────

function KPIRow({ kpi, onSave }: { kpi: KPI; onSave: (v: number) => Promise<void> }) {
  const ok = isOnTrack(kpi)
  const trend = kpi.trend.length >= 3 ? kpi.trend : makeTrend(kpi)
  return (
    <div className="cd-kpi-row">
      <span className="cd-kpi-name">
        <span className={'cd-dot ' + (ok ? 'is-ok' : 'is-bad')} />
        {kpi.name}
      </span>
      <span className="cd-kpi-owner">
        <Avatar person={kpi.owner ?? null} size={22} />
      </span>
      <span className="cd-num-col">
        <span className="cd-num">{fmt(kpi.plan)}</span>
        {kpi.unit && <span className="cd-unit">{kpi.unit}</span>}
      </span>
      <span className="cd-num-col">
        <span className="cd-num-faint">{fmt(kpi.plan_to_date)}</span>
      </span>
      <span className="cd-num-col">
        <ActualCell kpi={kpi} onSave={onSave} />
      </span>
      <span className="cd-num-col">
        <KpiDeltaChip
          actual={kpi.actual}
          planToDate={kpi.plan_to_date}
          good={kpi.good ?? kpi.direction}
          unit={kpi.unit}
        />
      </span>
      <span className="cd-kpi-trend">
        <Sparkline
          values={trend}
          stroke={ok ? 'var(--ok)' : 'var(--bad)'}
          width={120}
          height={28}
        />
      </span>
    </div>
  )
}

// ── Add KPI modal ─────────────────────────────────────────────────────────

function AddKPIModal({ onClose, onCreated, cycleId }: {
  onClose: () => void
  onCreated: () => void
  cycleId: string
}) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [good, setGood] = useState<'up' | 'down'>('up')
  const [planValue, setPlanValue] = useState('')
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [members, setMembers] = useState<Person[]>([])
  const [unitId, setUnitId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [roleName, setRoleName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Load admin units on mount
  useEffect(() => {
    if (!user?.id) return
    getAdminUnits(user.id).then((u: any[]) => {
      setUnits(u)
      if (u.length > 0) {
        setUnitId(u[0].id)
        getUnitMembers(u[0].id).then(m => {
          setMembers(m)
          if (m.length > 0) { setOwnerId(m[0].id); setRoleName(m[0].role) }
        })
      }
    })
  }, [user?.id])

  async function handleUnitChange(id: string) {
    setUnitId(id)
    const m = await getUnitMembers(id)
    setMembers(m)
    if (m.length > 0) { setOwnerId(m[0].id); setRoleName(m[0].role) }
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (!unitId || !ownerId) {
      setError('You need to be an admin or lead of a unit (or a global admin) to add a KPI. Check Structure → Units if this seems wrong.')
      return
    }
    if (!user?.id) return
    setSaving(true)
    try {
      await createKPI({
        name: name.trim(),
        unit: unit.trim(),
        good,
        unit_id: unitId,
        owner_person_id: ownerId,
        role_name: roleName,
        plan_value: parseFloat(planValue) || 0,
        cycle_id: cycleId,
        created_by: user.id,
      })
      onCreated()
      onClose()
    } catch (ex) {
      setError(getErrorMessage(ex))
    } finally {
      setSaving(false)
    }
  }

  return (
    <CdModal open={true} title="Add KPI" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 340 }}>
        <label className="cd-field">
          <span className="cd-field-lbl">Name</span>
          <input className="cd-um-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Activation rate" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="cd-field">
            <span className="cd-field-lbl">Unit of measure</span>
            <input className="cd-um-input" value={unit} onChange={e => setUnit(e.target.value)} placeholder="%, ms, $…" />
          </label>
          <label className="cd-field">
            <span className="cd-field-lbl">Plan value</span>
            <input className="cd-um-input" type="number" value={planValue} onChange={e => setPlanValue(e.target.value)} placeholder="0" />
          </label>
        </div>
        <label className="cd-field">
          <span className="cd-field-lbl">Good direction</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            {(['up', 'down'] as const).map(d => (
              <button
                key={d}
                type="button"
                className={'cd-btn' + (good === d ? ' cd-btn-primary' : '')}
                style={{ fontSize: 12 }}
                onClick={() => setGood(d)}
              >
                {d === 'up' ? '↑ Higher is better' : '↓ Lower is better'}
              </button>
            ))}
          </div>
        </label>
        {units.length > 0 && (
          <label className="cd-field">
            <span className="cd-field-lbl">Unit</span>
            <select className="cd-um-input" value={unitId ?? ''} onChange={e => handleUnitChange(e.target.value)}>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        {members.length > 0 && (
          <label className="cd-field">
            <span className="cd-field-lbl">Owner</span>
            <select
              className="cd-um-input"
              value={ownerId ?? ''}
              onChange={e => {
                setOwnerId(e.target.value)
                const m = members.find(p => p.id === e.target.value)
                if (m) setRoleName(m.role)
              }}
            >
              {members.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="cd-field">
          <span className="cd-field-lbl">Role label (for grouping)</span>
          <input className="cd-um-input" value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="e.g. Engineering Lead" />
        </label>
        {error && <p className="cd-um-error">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="cd-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="cd-btn cd-btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
          >
            {saving ? 'Adding…' : 'Add KPI'}
          </button>
        </div>
      </div>
    </CdModal>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

type GroupBy = 'role' | 'owner' | 'all'

export function KPIsPage() {
  usePageTitle('KPIs')
  const { activeCycle } = useCycle()
  const { kpis, loading, isAdmin, updateActual, reload } = useKPIs(activeCycle?.id ?? null)
  const [groupBy, setGroupBy] = useState<GroupBy>('role')
  const [addOpen, setAddOpen] = useState(false)
  const { kpiModalOpen, setKpiModalOpen } = usePageActionStore()

  useEffect(() => {
    if (kpiModalOpen) {
      setAddOpen(true)
      setKpiModalOpen(false)
    }
  }, [kpiModalOpen, setKpiModalOpen])

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading…</p></div>

  // Compute groups
  const getGroupKey = (k: KPI): string => {
    if (groupBy === 'role') return k.role_name || '—'
    if (groupBy === 'owner') return k.owner?.name ?? '—'
    return 'All KPIs'
  }

  const grouped = kpis.reduce<Record<string, KPI[]>>((acc, k) => {
    const key = getGroupKey(k)
    ;(acc[key] = acc[key] || []).push(k)
    return acc
  }, {})

  const onTrackCount = kpis.filter(isOnTrack).length
  const offCount = kpis.length - onTrackCount

  return (
    <div className="cd-page">
      {/* Page header matching design */}
      <header className="cd-pgh">
        <div>
          <div className="cd-pgh-eyebrow">{activeCycle?.label ?? ''} · Team KPIs</div>
          <h1 className="cd-pgh-title">How is each role performing?</h1>
          <p className="cd-pgh-sub">Recurring metrics tied to roles. Plan vs Plan-to-date vs Actual, with this week's trend.</p>
        </div>
        <div className="cd-pg-act">
          <Segmented<GroupBy>
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'role',  label: 'By role' },
              { value: 'owner', label: 'By owner' },
              { value: 'all',   label: 'Flat' },
            ]}
          />
          {isAdmin && (
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              onClick={() => setAddOpen(true)}
            >
              <Icon name="plus" size={14} /> Add KPI
            </button>
          )}
        </div>
      </header>

      {/* Summary stats */}
      <div className="cd-okrs-summary">
        <div className="cd-stat">
          <span className="cd-stat-label">KPIs tracked</span>
          <span className="cd-stat-value">{kpis.length}</span>
          <span className="cd-stat-delta">Across {Object.keys(grouped).length} {groupBy === 'role' ? 'roles' : groupBy === 'owner' ? 'owners' : 'total'}</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-label">On plan</span>
          <span className="cd-stat-value" style={{ color: 'var(--ok)' }}>{onTrackCount}</span>
          <span className="cd-stat-delta">Within 5% of plan-to-date</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-label">Off plan</span>
          <span className="cd-stat-value" style={{ color: offCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>{offCount}</span>
          <span className="cd-stat-delta">Needs attention</span>
        </div>
        <div className="cd-stat">
          <span className="cd-stat-label">Last updated</span>
          <span className="cd-stat-value">Today</span>
          <span className="cd-stat-delta">Auto-sync</span>
        </div>
      </div>

      {/* KPI table */}
      <div className="cd-card" style={{ padding: 0 }}>
        <div className="cd-kpi-table">
          <div className="cd-kpi-hd">
            <span>KPI</span>
            <span>Owner</span>
            <span className="cd-num-col">Plan</span>
            <span className="cd-num-col">Plan-to-date</span>
            <span className="cd-num-col">Actual</span>
            <span className="cd-num-col">Δ vs PTD</span>
            <span>13-week trend</span>
          </div>

          {kpis.length === 0 && (
            <EmptyState
              icon="chart-bar"
              title="No KPIs for this cycle"
              description="Track recurring metrics alongside your OKRs"
              action={isAdmin ? { label: 'Add KPI', onClick: () => setAddOpen(true) } : undefined}
            />
          )}

          {Object.entries(grouped).map(([role, items]) => (
            <div key={role}>
              <div className="cd-kpi-grp">
                <span className="cd-kpi-grp-name">{role}</span>
                <span className="cd-kpi-grp-meta">
                  {items.length} KPI{items.length !== 1 ? 's' : ''}
                  {groupBy === 'role' && items[0]?.owner?.name
                    ? ` · owned by ${items[0].owner.name.split(' ')[0]}`
                    : ''}
                </span>
              </div>
              {items.map(k => (
                <KPIRow
                  key={k.id}
                  kpi={k}
                  onSave={v => updateActual(k.id, v)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {addOpen && activeCycle?.id && (
        <AddKPIModal
          cycleId={activeCycle.id}
          onClose={() => setAddOpen(false)}
          onCreated={reload}
        />
      )}
    </div>
  )
}
