import { useState, useMemo, useEffect } from 'react'
import { getErrorMessage } from '../lib/errors'
import { usePageActionStore } from '../stores/pageActionStore'
import { useUserManagement } from '../hooks/useUserManagement'
import { useOrg } from '../context/OrgContext'
import { useAuth } from '../context/AuthContext'
import { Avatar } from '../components/cadence/Avatar'
import { Icon } from '../components/cadence/Icon'
import { profileToPerson } from '../lib/cadenceUtils'
import { getPendingApprovals, approveUser, rejectUser } from '../services/pendingApprovals.service'
import type { ManagedUser, UnitRole, UserStatus } from '../services/userManagement.service'
import type { PendingApproval } from '../types/cadence'

// ── Relative time helper ──────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

// ── Helpers ───────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'admins' | 'pending'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', lead: 'Lead', member: 'Member', viewer: 'Viewer', contributor: 'Contributor',
}

function StatusBadge({ status }: { status: UserStatus | 'demo' }) {
  const cfgMap: Record<string, { label: string; color: string }> = {
    active:   { label: 'Active',    color: 'var(--ok)' },
    pending:  { label: 'Pending',   color: 'var(--warn)' },
    inactive: { label: 'Suspended', color: 'var(--ink-faint)' },
    demo:     { label: 'Demo',      color: 'var(--accent)' },
  }
  const cfg = cfgMap[status] ?? { label: status, color: 'var(--ink-faint)' }
  return (
    <span className="cd-um-badge" style={{ color: cfg.color, borderColor: `color-mix(in oklab, ${cfg.color} 30%, transparent)` }}>
      {cfg.label}
    </span>
  )
}

function RoleBadge({ role }: { role: string }) {
  const color = role === 'admin' ? 'var(--accent)'
    : role === 'lead' ? 'var(--ok)'
    : 'var(--ink-faint)'
  return (
    <span className="cd-um-badge" style={{ color, borderColor: `color-mix(in oklab, ${color} 25%, transparent)` }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

// ── Password strength ─────────────────────────────────────────────────────

function passwordStrength(pw: string): { label: string; color: string; score: number } {
  if (pw.length < 8) return { label: 'Too short', color: 'var(--bad)', score: 0 }
  let score = 0
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { label: 'Weak', color: 'var(--bad)', score: 1 }
  if (score === 2) return { label: 'Fair', color: 'var(--warn)', score: 2 }
  return { label: 'Strong', color: 'var(--ok)', score: 3 }
}

function PasswordInput({
  value,
  onChange,
  placeholder = 'Password',
  showStrength = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  showStrength?: boolean
}) {
  const [show, setShow] = useState(false)
  const strength = showStrength ? passwordStrength(value) : null
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="cd-um-input"
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2 }}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? '🙈' : '👁'}
      </button>
      {showStrength && value.length > 0 && strength && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= strength.score ? strength.color : 'var(--line)', transition: 'background 0.2s' }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: strength.color, whiteSpace: 'nowrap' }}>{strength.label}</span>
        </div>
      )}
    </div>
  )
}

// ── Add user form (invite email default, manual password option) ──────────

function CreateUserForm({
  units,
  scopeUnitIds,
  isGlobalAdmin,
  allowedRoles,
  orgId,
  defaultUnitId,
  onCreate,
  onInvite,
  onCancel,
}: {
  units: { id: string; name: string }[]
  scopeUnitIds: Set<string>
  isGlobalAdmin: boolean
  allowedRoles: UnitRole[]
  orgId: string | null
  defaultUnitId?: string
  onCreate: (p: { name: string; email: string; password: string; unit_id: string; role: UnitRole; must_change_password: boolean }) => Promise<void>
  onInvite: (p: { full_name: string; email: string; unit_id: string; role: UnitRole; org_id: string }) => Promise<void>
  onCancel: () => void
}) {
  const { setInviteForUnitId } = usePageActionStore()
  const [manualMode, setManualMode] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', password: '', unit_id: defaultUnitId ?? '', role: 'member' as UnitRole, must_change_password: true,
  })

  // Clear the pre-fill from the store once consumed
  useEffect(() => {
    return () => { setInviteForUnitId(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const availableUnits = isGlobalAdmin ? units : units.filter(u => scopeUnitIds.has(u.id))
  const strength = passwordStrength(form.password)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email || !form.unit_id) { setErr('Name, email, and unit are required'); return }
    if (!orgId) { setErr('No organisation found'); return }
    setSubmitting(true)
    setErr(null)
    try {
      await onInvite({ full_name: form.name, email: form.email, unit_id: form.unit_id, role: form.role, org_id: orgId })
      setSuccess(`Invitation sent to ${form.email}. They'll receive a magic-link to set up their account.`)
    } catch (ex) {
      setErr(getErrorMessage(ex))
      setSubmitting(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email || !form.password || !form.unit_id) {
      setErr('All fields are required'); return
    }
    if (form.password.length < 8) { setErr('Password must be at least 8 characters'); return }
    if (!/[0-9]/.test(form.password)) { setErr('Password must contain at least one number'); return }
    setSubmitting(true)
    setErr(null)
    try {
      await onCreate(form)
      setSuccess(`Account created for ${form.name}. They can sign in with ${form.email} and the password you set.`)
    } catch (ex) {
      setErr(getErrorMessage(ex))
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="cd-um-invite-form">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <Icon name="check" size={14} /> {manualMode ? 'User created' : 'Invitation sent'}
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-mid)', margin: 0 }}>{success}</p>
          <button type="button" className="cd-btn" onClick={onCancel} style={{ alignSelf: 'flex-start' }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <form className="cd-um-invite-form" onSubmit={manualMode ? handleCreate : handleInvite}>
      <div className="cd-um-invite-title">Add user</div>

      {/* Mode toggle */}
      <div className="cd-um-mode-toggle">
        <button
          type="button"
          className={`cd-um-mode-btn ${!manualMode ? 'is-on' : ''}`}
          onClick={() => { setManualMode(false); setErr(null) }}
        >
          <Icon name="mail" size={12} /> Send email invitation
        </button>
        <button
          type="button"
          className={`cd-um-mode-btn ${manualMode ? 'is-on' : ''}`}
          onClick={() => { setManualMode(true); setErr(null) }}
        >
          <Icon name="shield" size={12} /> Set password manually
        </button>
      </div>

      <input
        className="cd-um-input" placeholder="Full name *" required
        value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
      />
      <input
        className="cd-um-input" type="email" placeholder="Email address *" required
        value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
      />
      {manualMode && (
        <PasswordInput
          value={form.password}
          onChange={v => setForm(p => ({ ...p, password: v }))}
          placeholder="Temporary password *"
          showStrength
        />
      )}
      <select
        className="cd-um-select" required
        value={form.unit_id} onChange={e => setForm(p => ({ ...p, unit_id: e.target.value }))}
      >
        <option value="">Primary unit *</option>
        {availableUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select
        className="cd-um-select"
        value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value as UnitRole }))}
      >
        {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      {manualMode && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '6px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          <input
            type="checkbox"
            checked={form.must_change_password}
            onChange={e => setForm(p => ({ ...p, must_change_password: e.target.checked }))}
          />
          Require password change on first sign-in
        </label>
      )}
      {err && <div className="cd-um-error">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          className="cd-btn cd-btn-primary"
          disabled={submitting || (manualMode && strength.score === 0)}
          style={{ flex: 1 }}
        >
          {submitting
            ? (manualMode ? 'Creating…' : 'Sending…')
            : (manualMode ? 'Create user →' : 'Send invitation →')}
        </button>
        <button type="button" className="cd-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ── Reset password inline form ────────────────────────────────────────────

function ResetPasswordForm({
  targetName,
  onReset,
  onCancel,
}: {
  targetName: string
  onReset: (newPassword: string) => Promise<void>
  onCancel: () => void
}) {
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSet() {
    if (pw.length < 8) { setErr('Min 8 characters'); return }
    setSaving(true)
    setErr(null)
    try {
      await onReset(pw)
      setSuccess(true)
    } catch (ex) {
      setErr(getErrorMessage(ex))
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="cd-um-reset-form">
        <span style={{ color: 'var(--ok)', fontSize: 13 }}>
          <Icon name="check" size={12} /> Password reset. Share the new password with {targetName}.
        </span>
        <button type="button" className="cd-btn" style={{ fontSize: 12 }} onClick={onCancel}>Close</button>
      </div>
    )
  }

  return (
    <div className="cd-um-reset-form">
      <span style={{ fontSize: 12, color: 'var(--ink-mid)', fontWeight: 500 }}>Reset password</span>
      <PasswordInput value={pw} onChange={setPw} placeholder="New password" showStrength />
      {err && <div className="cd-um-error" style={{ fontSize: 12 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="cd-btn cd-btn-primary" onClick={handleSet} disabled={saving || pw.length < 8} style={{ fontSize: 12 }}>
          {saving ? 'Setting…' : 'Set password'}
        </button>
        <button type="button" className="cd-btn" onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  )
}

// ── Left panel: user list ─────────────────────────────────────────────────

function UserList({
  users,
  selected,
  onSelect,
  isGlobalAdmin,
  units,
  scopeUnitIds,
  allowedRoles,
  orgId,
  onCreate,
  onInvite,
}: {
  users: ManagedUser[]
  selected: string | null
  onSelect: (id: string) => void
  isGlobalAdmin: boolean
  units: { id: string; name: string }[]
  scopeUnitIds: Set<string>
  allowedRoles: UnitRole[]
  orgId: string | null
  onCreate: (p: { name: string; email: string; password: string; unit_id: string; role: UnitRole; must_change_password: boolean }) => Promise<void>
  onInvite: (p: { full_name: string; email: string; unit_id: string; role: UnitRole; org_id: string }) => Promise<void>
}) {
  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const { addUserOpen, setAddUserOpen, inviteForUnitId } = usePageActionStore()

  useEffect(() => {
    if (addUserOpen) {
      setShowCreate(true)
      setAddUserOpen(false)
    }
  }, [addUserOpen, setAddUserOpen])

  const filtered = useMemo(() => {
    let list = users
    if (tab === 'admins') list = list.filter(u => u.is_global_admin || u.memberships.some(m => m.role === 'admin' || m.role === 'lead'))
    if (tab === 'pending') list = list.filter(u => u.status === 'pending')
    if (search) list = list.filter(u =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    )
    return list
  }, [users, tab, search])

  return (
    <div className="cd-um-list-panel">
      <div className="cd-um-search-wrap">
        <Icon name="search" size={14} />
        <input
          className="cd-um-search"
          placeholder="Search users…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="cd-um-tabs">
        {(['all', 'admins', 'pending'] as FilterTab[]).map(t => (
          <button key={t} type="button"
            className={'cd-um-tab' + (tab === t ? ' is-on' : '')}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'all' && ` (${users.length})`}
            {t === 'pending' && ` (${users.filter(u => u.status === 'pending').length})`}
          </button>
        ))}
      </div>
      {!showCreate && (
        <button type="button" className="cd-btn cd-btn-primary cd-um-invite-btn" onClick={() => setShowCreate(true)}>
          <Icon name="plus" size={13} /> Add user
        </button>
      )}
      {showCreate && (
        <CreateUserForm
          units={units}
          scopeUnitIds={scopeUnitIds}
          isGlobalAdmin={isGlobalAdmin}
          allowedRoles={allowedRoles}
          orgId={orgId}
          defaultUnitId={inviteForUnitId ?? undefined}
          onCreate={async payload => { await onCreate(payload); setShowCreate(false) }}
          onInvite={async payload => { await onInvite(payload); setShowCreate(false) }}
          onCancel={() => setShowCreate(false)}
        />
      )}
      <div className="cd-um-list">
        {filtered.length === 0 && (
          <div className="cd-empty-hint" style={{ padding: '16px 12px' }}>No users found</div>
        )}
        {filtered.map(u => {
          const person = profileToPerson({ id: u.id, full_name: u.full_name, avatar_url: u.avatar_url, role: u.role })
          return (
            <div
              key={u.id}
              className={'cd-um-list-item' + (selected === u.id ? ' is-selected' : '')}
              onClick={() => onSelect(u.id)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelect(u.id)}
            >
              <Avatar person={person} size={30} />
              <div className="cd-um-list-info">
                <div className="cd-um-list-name">
                  {u.full_name}
                  {u.is_global_admin && (
                    <span title="Global admin" style={{ color: 'var(--accent)', marginLeft: 4 }}>
                      <Icon name="shield" size={11} />
                    </span>
                  )}
                </div>
                <div className="cd-um-list-sub">{u.job_title ?? u.email ?? '—'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <StatusBadge status={(u.status as any)} />
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{relativeTime(u.last_active_at)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Add to unit inline form ───────────────────────────────────────────────

function AddToUnitForm({
  units, scopeUnitIds, isGlobalAdmin, allowedRoles, onAdd, onCancel,
}: {
  units: { id: string; name: string }[]
  scopeUnitIds: Set<string>
  isGlobalAdmin: boolean
  allowedRoles: UnitRole[]
  onAdd: (unitId: string, role: UnitRole) => Promise<void>
  onCancel: () => void
}) {
  const [unitId, setUnitId] = useState('')
  const [role, setRole] = useState<UnitRole>('member')
  const [adding, setAdding] = useState(false)
  const available = isGlobalAdmin ? units : units.filter(u => scopeUnitIds.has(u.id))

  async function handleAdd() {
    if (!unitId) return
    setAdding(true)
    try { await onAdd(unitId, role) } finally { setAdding(false) }
  }

  return (
    <div className="cd-um-add-unit-form">
      <select className="cd-um-select" value={unitId} onChange={e => setUnitId(e.target.value)}>
        <option value="">Select unit…</option>
        {available.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select className="cd-um-select" value={role} onChange={e => setRole(e.target.value as UnitRole)}>
        {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="cd-btn cd-btn-primary" onClick={handleAdd} disabled={!unitId || adding}>
          {adding ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="cd-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Right panel: user detail ──────────────────────────────────────────────

function UserDetail({
  user: u, isGlobalAdmin, viewerIsMe, units, scopeUnitIds, allowedRoles,
  canManageUnit, onUpsertMembership, onRemoveMembership, onSetStatus, onResetPassword,
}: {
  user: ManagedUser
  isGlobalAdmin: boolean
  viewerIsMe: boolean
  units: { id: string; name: string }[]
  scopeUnitIds: Set<string>
  allowedRoles: UnitRole[]
  canManageUnit: (unitId: string) => boolean
  onUpsertMembership: (targetId: string, unitId: string, role: UnitRole) => Promise<void>
  onRemoveMembership: (targetId: string, unitId: string) => Promise<void>
  onSetStatus: (targetId: string, status: UserStatus) => Promise<void>
  onResetPassword: (targetId: string, newPassword: string) => Promise<void>
}) {
  const person = profileToPerson({ id: u.id, full_name: u.full_name, avatar_url: u.avatar_url, role: u.role })
  const [showAddUnit, setShowAddUnit] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [deactivateConfirm, setDeactivateConfirm] = useState(false)
  const [working, setWorking] = useState(false)
  const [roleEditing, setRoleEditing] = useState<string | null>(null)

  const adminUnits = u.memberships.filter(m => m.role === 'admin' || m.role === 'lead')
  const memberUnits = u.memberships

  async function handleDeactivate() {
    setWorking(true)
    try { await onSetStatus(u.id, 'inactive'); setDeactivateConfirm(false) } finally { setWorking(false) }
  }

  async function handleReactivate() {
    setWorking(true)
    try { await onSetStatus(u.id, 'active') } finally { setWorking(false) }
  }

  return (
    <div className="cd-um-detail">
      {/* ── Profile header ── */}
      <div className="cd-um-detail-hd">
        <Avatar person={person} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="cd-um-detail-name">{u.full_name}</span>
            {u.is_global_admin && (
              <span className="cd-um-global-badge"><Icon name="shield" size={11} /> Global admin</span>
            )}
            <StatusBadge status={u.status} />
          </div>
          <div className="cd-um-detail-email">{u.email ?? '—'}</div>
          {u.job_title && <div className="cd-um-detail-title">{u.job_title}</div>}
        </div>
        {/* Reset password button (admin, not for own account) */}
        {isGlobalAdmin && !viewerIsMe && !u.is_global_admin && (
          <button
            type="button"
            className="cd-btn"
            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            onClick={() => setShowReset(r => !r)}
          >
            {showReset ? 'Cancel' : 'Reset password'}
          </button>
        )}
      </div>

      {/* Reset password inline form */}
      {showReset && (
        <ResetPasswordForm
          targetName={u.full_name.split(' ')[0]}
          onReset={pw => onResetPassword(u.id, pw)}
          onCancel={() => setShowReset(false)}
        />
      )}

      {/* ── Unit memberships ── */}
      <div className="cd-um-section">
        <div className="cd-um-section-title">Unit memberships</div>
        {u.memberships.length === 0 && (
          <div className="cd-empty-hint" style={{ padding: '8px 0' }}>No unit memberships yet</div>
        )}
        <div className="cd-um-units-table">
          {u.memberships.map(m => {
            const canEdit = canManageUnit(m.unit_id)
            return (
              <div key={m.unit_id} className="cd-um-unit-row">
                <span className="cd-um-level-dot" style={{ background: m.unit_level_color ?? 'var(--ink-faint)' }} title={m.unit_level_name ?? ''} />
                <span className="cd-um-unit-name">
                  {m.is_primary && <span title="Primary unit" style={{ color: 'var(--warn)', marginRight: 3 }}>★</span>}
                  {m.unit_name}
                </span>
                <span className="cd-um-unit-level">{m.unit_level_name ?? '—'}</span>
                {canEdit && roleEditing === m.unit_id ? (
                  <select
                    className="cd-um-select cd-um-select-sm"
                    value={m.role}
                    onChange={async e => {
                      await onUpsertMembership(u.id, m.unit_id, e.target.value as UnitRole)
                      setRoleEditing(null)
                    }}
                    onBlur={() => setRoleEditing(null)}
                    autoFocus
                  >
                    {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (
                  <span
                    className={'cd-um-role-badge' + (canEdit ? ' is-clickable' : '')}
                    onClick={() => canEdit && setRoleEditing(m.unit_id)}
                    title={canEdit ? 'Click to change role' : undefined}
                  >
                    <RoleBadge role={m.role} />
                  </span>
                )}
                <button
                  type="button" className="cd-btn-icon"
                  title={canEdit ? 'Remove from unit' : 'No permission'}
                  disabled={!canEdit}
                  onClick={() => canEdit && onRemoveMembership(u.id, m.unit_id)}
                  style={{ opacity: canEdit ? 1 : 0.3 }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            )
          })}
        </div>
        {!showAddUnit && (
          <button type="button" className="cd-btn" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setShowAddUnit(true)}>
            <Icon name="plus" size={12} /> Add to unit
          </button>
        )}
        {showAddUnit && (
          <AddToUnitForm
            units={units} scopeUnitIds={scopeUnitIds} isGlobalAdmin={isGlobalAdmin} allowedRoles={allowedRoles}
            onAdd={async (unitId, role) => { await onUpsertMembership(u.id, unitId, role); setShowAddUnit(false) }}
            onCancel={() => setShowAddUnit(false)}
          />
        )}
      </div>

      {/* ── Permissions summary ── */}
      <div className="cd-um-section">
        <div className="cd-um-section-title">Permissions</div>
        <div className="cd-um-perms">
          {u.is_global_admin ? (
            <div className="cd-um-perm-row cd-um-perm-full">
              <Icon name="shield" size={13} />
              Full system access — all settings, all users, all units
            </div>
          ) : (
            <>
              <div className="cd-um-perm-row">
                <Icon name="target" size={13} />
                <span>Sees OKRs in: {memberUnits.length ? memberUnits.map(m => m.unit_name).join(', ') + ' + parent levels' : 'No units assigned'}</span>
              </div>
              <div className="cd-um-perm-row">
                <Icon name="chart" size={13} />
                <span>{adminUnits.length ? `Can set KPIs in: ${adminUnits.map(m => m.unit_name).join(', ')}` : 'No KPI access'}</span>
              </div>
              <div className="cd-um-perm-row">
                <Icon name="users" size={13} />
                <span>{adminUnits.length ? `Can manage users in: ${adminUnits.map(m => m.unit_name).join(', ')} and sub-units` : 'Cannot manage users'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Danger zone ── */}
      {isGlobalAdmin && !u.is_global_admin && !viewerIsMe && (
        <div className="cd-um-section cd-um-danger">
          <div className="cd-um-section-title" style={{ color: 'var(--bad)' }}>Danger zone</div>
          {u.status === 'inactive' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-soft)', flex: 1 }}>This account is deactivated.</span>
              <button type="button" className="cd-btn" onClick={handleReactivate} disabled={working}>
                {working ? 'Working…' : 'Reactivate'}
              </button>
            </div>
          ) : deactivateConfirm ? (
            <div className="cd-um-confirm">
              <span style={{ fontSize: 13 }}>Deactivate <strong>{u.full_name}</strong>? This removes access immediately.</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="cd-btn cd-btn-danger" onClick={handleDeactivate} disabled={working}>
                  {working ? 'Deactivating…' : 'Confirm deactivate'}
                </button>
                <button type="button" className="cd-btn" onClick={() => setDeactivateConfirm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-soft)', flex: 1 }}>Deactivate account — removes access immediately, data is retained.</span>
              <button type="button" className="cd-btn cd-btn-danger" onClick={() => setDeactivateConfirm(true)}>Deactivate</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pending approvals banner ──────────────────────────────────────────────

function PendingApprovalsBanner({
  orgId,
  units,
  onApproved,
}: {
  orgId: string | null
  units: { id: string; name: string }[]
  onApproved: () => void
}) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [selectedUnit, setSelectedUnit] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    getPendingApprovals(orgId).then(setApprovals).catch(() => {})
  }, [orgId])

  if (approvals.length === 0) return null

  async function handleApprove(a: PendingApproval) {
    const unitId = selectedUnit[a.person_id] ?? units[0]?.id
    if (!unitId) return
    setWorking(a.person_id)
    try {
      await approveUser(a.person_id, unitId, 'member', '')
      setApprovals(prev => prev.filter(x => x.person_id !== a.person_id))
      onApproved()
    } finally {
      setWorking(null)
    }
  }

  async function handleReject(a: PendingApproval) {
    setWorking(a.person_id)
    try {
      await rejectUser(a.person_id)
      setApprovals(prev => prev.filter(x => x.person_id !== a.person_id))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="cd-approvals-banner">
      <div className="cd-approvals-title">
        <Icon name="bell" size={14} />
        {approvals.length} pending approval{approvals.length !== 1 ? 's' : ''}
      </div>
      {approvals.map(a => (
        <div key={a.person_id} className="cd-approvals-row">
          <div className="cd-approvals-info">
            <strong>{a.full_name}</strong>
            <span className="cd-approvals-email">{a.email}</span>
            <span className="cd-approvals-date">
              {new Date(a.requested_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          </div>
          <select
            className="cd-um-select"
            style={{ minWidth: 140 }}
            value={selectedUnit[a.person_id] ?? units[0]?.id ?? ''}
            onChange={e => setSelectedUnit(prev => ({ ...prev, [a.person_id]: e.target.value }))}
          >
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button
            type="button"
            className="cd-btn cd-btn-primary"
            disabled={working === a.person_id}
            onClick={() => handleApprove(a)}
          >
            Approve
          </button>
          <button
            type="button"
            className="cd-btn"
            disabled={working === a.person_id}
            onClick={() => handleReject(a)}
          >
            Reject
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function UserManagementPage() {
  const { user: authUser, orgId } = useAuth()
  const { units } = useOrg()
  const {
    users, loading, error,
    isGlobalAdmin, canManageUnit, allowedRoles,
    scope,
    upsertMembership, removeMembership, setUserStatus, createUser, inviteUser, resetPassword,
  } = useUserManagement()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedUser = users.find(u => u.id === selectedId) ?? null
  const scopeUnitIds = new Set(scope.map(s => s.unit_id))
  const scopeUnitNames = units.filter(u => scope.some(s => s.unit_id === u.id && s.depth === 0)).map(u => u.name)

  // Build tree-ordered flat list with indented names for selects
  const flatUnits = useMemo(() => {
    type N = { id: string; name: string; parent_id: string | null; children: N[] }
    const byId = new Map<string, N>()
    for (const u of units) byId.set(u.id, { id: u.id, name: u.name, parent_id: u.parent_id, children: [] })
    const roots: N[] = []
    for (const u of units) {
      const node = byId.get(u.id)!
      if (u.parent_id && byId.has(u.parent_id)) byId.get(u.parent_id)!.children.push(node)
      else roots.push(node)
    }
    const result: { id: string; name: string }[] = []
    function walk(nodes: N[], depth: number) {
      for (const n of nodes) {
        const prefix = depth === 0 ? '' : '\u00a0\u00a0\u00a0\u00a0'.repeat(depth) + '└ '
        result.push({ id: n.id, name: prefix + n.name })
        walk(n.children, depth + 1)
      }
    }
    walk(roots, 0)
    return result
  }, [units])

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading users…</p></div>
  if (error) return (
    <div className="cd-page">
      <div style={{ color: 'var(--bad)', padding: 20 }}>
        <strong>Failed to load users</strong><br />
        <code style={{ fontSize: 12, whiteSpace: 'pre-wrap', display: 'block', marginTop: 8, color: 'var(--ink-mid)' }}>{error}</code>
        <p style={{ fontSize: 12, marginTop: 8, color: 'var(--ink-soft)' }}>
          Check the browser console for full error details (code, hint, details).
          Most likely cause: run migration <code>20260515_010_schema_backfill.sql</code> in Supabase.
        </p>
      </div>
    </div>
  )

  function handleReload() {
    window.location.reload()
  }

  return (
    <div className="cd-page" style={{ gap: 0, overflow: 'hidden', height: '100%', paddingBottom: 0 }}>
      {isGlobalAdmin && (
        <PendingApprovalsBanner
          orgId={orgId}
          units={flatUnits}
          onApproved={handleReload}
        />
      )}
      {!isGlobalAdmin && scopeUnitNames.length > 0 && (
        <div className="cd-um-scope-banner">
          <Icon name="info" size={14} />
          <span>Managing users in: <strong>{scopeUnitNames.join(', ')}</strong> and their sub-units</span>
        </div>
      )}
      <div className="cd-um-layout">
        <UserList
          users={users}
          selected={selectedId}
          onSelect={setSelectedId}
          isGlobalAdmin={isGlobalAdmin}
          units={flatUnits}
          scopeUnitIds={scopeUnitIds}
          allowedRoles={allowedRoles()}
          orgId={orgId}
          onCreate={createUser}
          onInvite={inviteUser}
        />
        <div className="cd-um-detail-wrap">
          {selectedUser ? (
            <UserDetail
              user={selectedUser}
              isGlobalAdmin={isGlobalAdmin}
              viewerIsMe={selectedUser.id === authUser?.id}
              units={flatUnits}
              scopeUnitIds={scopeUnitIds}
              allowedRoles={allowedRoles()}
              canManageUnit={canManageUnit}
              onUpsertMembership={upsertMembership}
              onRemoveMembership={removeMembership}
              onSetStatus={setUserStatus}
              onResetPassword={resetPassword}
            />
          ) : (
            <div className="cd-um-empty-detail">
              <Icon name="users" size={32} />
              <div>Select a user to view details</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
