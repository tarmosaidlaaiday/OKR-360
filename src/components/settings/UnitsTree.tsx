import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Level, Unit } from '../../types/cadence'
import { usePageActionStore } from '../../stores/pageActionStore'
import {
  listUsers,
  upsertMembership as doUpsertMembership,
  removeMembership as doRemoveMembership,
} from '../../services/userManagement.service'
import type { ManagedUser, UnitRole } from '../../services/userManagement.service'

// ── uid helper ────────────────────────────────────────────────────────────
let _uidSeq = 0
function uid() { return `new_${Date.now()}_${++_uidSeq}` }

// ── Tree building helpers ─────────────────────────────────────────────────

interface UnitNodeData extends Unit {
  children: UnitNodeData[]
  depth: number
}

function buildUnitTree(units: Unit[]): UnitNodeData[] {
  const byId = new Map<string, UnitNodeData>()
  for (const u of units) byId.set(u.id, { ...u, children: [], depth: 0 })

  const roots: UnitNodeData[] = []
  for (const u of units) {
    const node = byId.get(u.id)!
    if (u.parent_id && byId.has(u.parent_id)) {
      byId.get(u.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  function setDepth(node: UnitNodeData, d: number) {
    node.depth = d
    node.children.forEach(c => setDepth(c, d + 1))
  }
  roots.forEach(r => setDepth(r, 0))
  return roots
}

function flattenWithDepth(nodes: UnitNodeData[]): UnitNodeData[] {
  const out: UnitNodeData[] = []
  function walk(ns: UnitNodeData[]) { for (const n of ns) { out.push(n); walk(n.children) } }
  walk(nodes)
  return out
}

// ── Avatar color helper ───────────────────────────────────────────────────

function nameColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360}, 55%, 48%)`
}

// ── UnitMembersPicker ────────────────────────────────────────────────────

interface UnitMembersPickerProps {
  unitId: string
  allUsers: ManagedUser[]
  loadingUsers: boolean
  onOpen: () => void
  onAssign: (personId: string, unitId: string) => void
  onUnassign: (personId: string, unitId: string) => void
  onInvite: (unitId: string) => void
}

function UnitMembersPicker({
  unitId,
  allUsers,
  loadingUsers,
  onOpen,
  onAssign,
  onUnassign,
  onInvite,
}: UnitMembersPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const isNew = unitId.startsWith('new_')

  // Members of this unit
  const members = allUsers.filter(u => u.memberships.some(m => m.unit_id === unitId))

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleToggle() {
    if (isNew) return
    if (!open) onOpen()
    setOpen(o => !o)
    setSearch('')
  }

  // Avatar stack
  const avatarSlots = members.slice(0, 3)
  const extra = members.length - 3

  const filtered = allUsers.filter(u =>
    !search ||
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (u.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="cd-unit-members-wrap" ref={wrapRef}>
      <button
        type="button"
        className="cd-unit-members-btn"
        onClick={handleToggle}
        disabled={isNew}
        title={isNew ? 'Save first to assign people' : 'Assign people'}
      >
        {members.length === 0 ? (
          <span className="cd-unit-pip cd-unit-pip--empty" style={{ background: 'var(--ink-faint)' }}>+</span>
        ) : (
          <>
            {avatarSlots.map(u => (
              <span
                key={u.id}
                className="cd-unit-pip"
                style={{ background: nameColor(u.full_name) }}
                title={u.full_name}
              >
                {u.full_name.charAt(0).toUpperCase()}
              </span>
            ))}
            {extra > 0 && (
              <span className="cd-unit-pip cd-unit-pip--more">+{extra}</span>
            )}
          </>
        )}
      </button>

      {open && (
        <div className="cd-member-picker">
          <input
            className="cd-member-picker-search"
            placeholder="Search people…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="cd-member-picker-list">
            {loadingUsers && (
              <div className="cd-member-picker-hint">Loading…</div>
            )}
            {!loadingUsers && filtered.length === 0 && (
              <div className="cd-member-picker-hint">No users found</div>
            )}
            {filtered.map(u => {
              const checked = u.memberships.some(m => m.unit_id === unitId)
              return (
                <label key={u.id} className="cd-member-picker-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) onUnassign(u.id, unitId)
                      else onAssign(u.id, unitId)
                    }}
                  />
                  <span
                    className="cd-unit-pip"
                    style={{ background: nameColor(u.full_name), flexShrink: 0 }}
                  >
                    {u.full_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="cd-member-picker-name">{u.full_name}</span>
                  {u.status === 'pending' && (
                    <span className="cd-member-picker-badge">pending</span>
                  )}
                </label>
              )
            })}
          </div>
          <button
            type="button"
            className="cd-member-picker-invite"
            onClick={() => { onInvite(unitId); setOpen(false) }}
          >
            + Invite someone new…
          </button>
        </div>
      )}
    </div>
  )
}

// ── PastePopover ──────────────────────────────────────────────────────────

interface PastePopoverProps {
  onCreate: (names: string[]) => void
  onClose: () => void
}

function PastePopover({ onCreate, onClose }: PastePopoverProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const names = text.split('\n').map(s => s.trim()).filter(Boolean)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="cd-paste-popover">
      <textarea
        ref={textareaRef}
        className="cd-paste-textarea"
        rows={5}
        placeholder={'Paste names, one per line:\nSales\nMarketing\nEngineering'}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="cd-paste-actions">
        <button
          type="button"
          className="cd-btn cd-btn-primary cd-btn-tiny"
          disabled={names.length === 0}
          onClick={() => { onCreate(names); onClose() }}
        >
          {names.length > 0 ? `Create ${names.length} unit${names.length !== 1 ? 's' : ''}` : 'Create units'}
        </button>
        <button type="button" className="cd-btn cd-btn-tiny" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── UnitRow ───────────────────────────────────────────────────────────────

interface UnitRowProps {
  unit: UnitNodeData
  levels: Level[]
  levelFilter: string | null
  initEditing: boolean
  onFocusConsumed: () => void
  onAddChild: (parentId: string, parentLevelId: string | null) => void
  onAddSibling: (parentId: string | null, parentLevelId: string | null) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onChangeLevel: (id: string, levelId: string) => void
  onPasteForUnit: (parentId: string | null, levelId: string | null) => void
  allUsers: ManagedUser[]
  loadingUsers: boolean
  onUsersOpen: () => void
  onAssign: (personId: string, unitId: string) => void
  onUnassign: (personId: string, unitId: string) => void
  onInvite: (unitId: string) => void
}

function UnitRow({
  unit,
  levels,
  levelFilter,
  initEditing,
  onFocusConsumed,
  onAddChild,
  onAddSibling,
  onDelete,
  onRename,
  onChangeLevel,
  onPasteForUnit,
  allUsers,
  loadingUsers,
  onUsersOpen,
  onAssign,
  onUnassign,
  onInvite,
}: UnitRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(unit.name)
  const level = levels.find(l => l.id === unit.level_id)

  // Auto-enter edit mode when initEditing is set
  useEffect(() => {
    if (initEditing) {
      setEditing(true)
      setDraft('')
      onFocusConsumed()
    }
  // onFocusConsumed is stable (useCallback in parent), safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initEditing])

  function commitName() {
    const committed = draft.trim() || unit.name
    onRename(unit.id, committed)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const committed = draft.trim() || unit.name
      onRename(unit.id, committed)
      setEditing(false)
      // Create a sibling at the same level/parent
      onAddSibling(unit.parent_id, unit.level_id)
    } else if (e.key === 'Escape') {
      commitName()
    }
  }

  if (levelFilter && unit.level_id !== levelFilter) return null

  return (
    <div
      className="cd-unit-row"
      style={{ paddingLeft: 12 + unit.depth * 20 }}
    >
      <span
        className="cd-unit-depth-line"
        style={{ left: 12 + (unit.depth - 1) * 20, display: unit.depth > 0 ? undefined : 'none' }}
      />

      {/* Level dot */}
      <span
        className="cd-unit-dot"
        style={{ background: level?.color ?? 'var(--ink-faint)' }}
        title={level?.name}
      />

      {/* Name */}
      {editing ? (
        <input
          autoFocus
          className="cd-unit-name-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button type="button" className="cd-unit-name" onClick={() => setEditing(true)}>
          {unit.name}
        </button>
      )}

      {/* People picker */}
      <UnitMembersPicker
        unitId={unit.id}
        allUsers={allUsers}
        loadingUsers={loadingUsers}
        onOpen={onUsersOpen}
        onAssign={onAssign}
        onUnassign={onUnassign}
        onInvite={onInvite}
      />

      {/* Level selector */}
      <select
        className="cd-unit-level-select"
        value={unit.level_id ?? ''}
        onChange={e => onChangeLevel(unit.id, e.target.value)}
      >
        <option value="">No level</option>
        {levels.filter(l => l.enabled).map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>

      {/* Actions */}
      <div className="cd-unit-actions">
        <button
          type="button"
          className="cd-unit-action"
          onClick={() => onPasteForUnit(unit.parent_id, unit.level_id)}
          title="Bulk paste sibling units"
        >
          ⊞ paste
        </button>
        <button
          type="button"
          className="cd-unit-action"
          onClick={() => onAddChild(unit.id, unit.level_id)}
          title="Add child unit"
        >
          + child
        </button>
        <button
          type="button"
          className="cd-unit-action cd-unit-action--del"
          onClick={() => onDelete(unit.id)}
          title="Delete unit"
        >
          ✕
        </button>
      </div>

    </div>
  )
}

// ── Starter templates ─────────────────────────────────────────────────────

interface OrgTemplatesProps {
  levels: Level[]
  onApply: (units: Unit[]) => void
  onBlank: () => void
}

function OrgTemplates({ levels, onApply, onBlank }: OrgTemplatesProps) {
  const enabledLevels = levels.filter(l => l.enabled)

  // Match by name for the default hierarchy (Group → Company → Division → Team).
  // Fall back gracefully if levels have been renamed or the org has fewer tiers.
  const norm = (s: string) => s.trim().toLowerCase()
  const companyLevel =
    enabledLevels.find(l => norm(l.name) === 'company') ??
    enabledLevels[Math.min(1, enabledLevels.length - 1)] ??
    null

  const teamLevel =
    enabledLevels.find(l => norm(l.name) === 'team') ??
    enabledLevels[enabledLevels.length - 1] ??
    null

  // If both resolve to the same level (e.g. only one level exists), root and
  // children share a level — not ideal but not a silent wrong-level mismatch.
  const childLevelId = teamLevel?.id ?? companyLevel?.id ?? null

  function makeCompanyPlusTeams() {
    const companyId = uid()
    const company: Unit = { id: companyId, name: 'Company', level_id: companyLevel?.id ?? null, parent_id: null, position: 0 }
    const teams = ['Team 1', 'Team 2', 'Team 3'].map((name, i) => ({
      id: uid(), name, level_id: childLevelId, parent_id: companyId, position: i,
    }))
    onApply([company, ...teams])
  }

  function makeDepartments() {
    const companyId = uid()
    const company: Unit = { id: companyId, name: 'Company', level_id: companyLevel?.id ?? null, parent_id: null, position: 0 }
    const depts = ['Sales', 'Marketing', 'Engineering', 'Operations'].map((name, i) => ({
      id: uid(), name, level_id: childLevelId, parent_id: companyId, position: i,
    }))
    onApply([company, ...depts])
  }

  return (
    <div className="cd-org-templates">
      <button type="button" className="cd-org-template-card" onClick={makeCompanyPlusTeams}>
        <span className="cd-org-template-title">Company + Teams</span>
        <span className="cd-org-template-desc">Company with Team 1, 2, 3 as sub-units</span>
      </button>
      <button type="button" className="cd-org-template-card" onClick={makeDepartments}>
        <span className="cd-org-template-title">Departments</span>
        <span className="cd-org-template-desc">Company with Sales, Marketing, Engineering, Operations</span>
      </button>
      <button type="button" className="cd-org-template-card cd-org-template-card--blank" onClick={onBlank}>
        <span className="cd-org-template-title">Start blank</span>
        <span className="cd-org-template-desc">Add one empty unit to begin typing</span>
      </button>
    </div>
  )
}

// ── UnitsTree ─────────────────────────────────────────────────────────────

interface UnitsTreeProps {
  units: Unit[]
  levels: Level[]
  onChange: (units: Unit[]) => void
}

export function UnitsTree({ units, levels, onChange }: UnitsTreeProps) {
  const navigate = useNavigate()
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [pasteTarget, setPasteTarget] = useState<{ parentId: string | null; levelId: string | null } | null>(null)
  const [showHeaderPaste, setShowHeaderPaste] = useState(false)

  // User data for picker (lazy loaded)
  const [allUsers, setAllUsers] = useState<ManagedUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersFetched, setUsersFetched] = useState(false)

  const { addUnitOpen, setAddUnitOpen, setAddUserOpen, setInviteForUnitId } = usePageActionStore()

  const tree = buildUnitTree(units)
  const flat = flattenWithDepth(tree)

  // Derive whether "+ Level above" should be enabled
  const enabledLevels = levels.filter(l => l.enabled)
  const rootUnits = units.filter(u => u.parent_id === null)
  let topmostRootLevelIdx = enabledLevels.length
  for (const u of rootUnits) {
    const idx = enabledLevels.findIndex(l => l.id === u.level_id)
    if (idx !== -1 && idx < topmostRootLevelIdx) topmostRootLevelIdx = idx
  }
  const canAddLevelAbove = rootUnits.length > 0 && topmostRootLevelIdx > 0 && topmostRootLevelIdx < enabledLevels.length
  const addLevelAboveTitle = rootUnits.length === 0
    ? 'Add units first'
    : !canAddLevelAbove
      ? 'Add another hierarchy level first under Hierarchy levels above'
      : `Insert a new ${enabledLevels[topmostRootLevelIdx - 1]?.name ?? ''} unit above all current top-level units`

  useEffect(() => {
    if (addUnitOpen) {
      addRoot()
      setAddUnitOpen(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addUnitOpen])

  function addRoot() {
    const topLevel = levels.filter(l => l.enabled)[0] ?? null
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: topLevel?.id ?? null,
      parent_id: null,
      position: units.length,
    }
    onChange([...units, newUnit])
    setPendingFocusId(newId)
  }

  function addLevelAbove() {
    const enabledLevels = levels.filter(l => l.enabled)
    const rootUnits = units.filter(u => u.parent_id === null)

    // Find the lowest index (topmost in hierarchy) among root unit levels
    let topmostIdx = enabledLevels.length // sentinel: no roots with known level
    for (const u of rootUnits) {
      const idx = enabledLevels.findIndex(l => l.id === u.level_id)
      if (idx !== -1 && idx < topmostIdx) topmostIdx = idx
    }

    // Ancestor level is one step above (lower index) the current topmost
    if (topmostIdx <= 0 || topmostIdx === enabledLevels.length) return

    const ancestorLevel = enabledLevels[topmostIdx - 1]
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: ancestorLevel.id,
      parent_id: null,
      position: 0,
    }

    // Reparent every current root unit under the new ancestor
    const updatedUnits = units.map(u =>
      u.parent_id === null ? { ...u, parent_id: newId } : u
    )

    onChange([newUnit, ...updatedUnits])
    setPendingFocusId(newId)
  }

  function addChild(parentId: string, parentLevelId: string | null) {
    const parentLevelIdx = levels.findIndex(l => l.id === parentLevelId)
    const childLevel = parentLevelIdx >= 0 ? levels[parentLevelIdx + 1] ?? null : null
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: childLevel?.id ?? parentLevelId,
      parent_id: parentId,
      position: units.filter(u => u.parent_id === parentId).length,
    }
    onChange([...units, newUnit])
    setPendingFocusId(newId)
  }

  function addSibling(parentId: string | null, levelId: string | null) {
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: levelId,
      parent_id: parentId,
      position: units.filter(u => u.parent_id === parentId).length,
    }
    onChange([...units, newUnit])
    setPendingFocusId(newId)
  }

  function deleteUnit(id: string) {
    onChange(
      units
        .filter(u => u.id !== id)
        .map(u => u.parent_id === id ? { ...u, parent_id: null } : u)
    )
  }

  function renameUnit(id: string, name: string) {
    onChange(units.map(u => u.id === id ? { ...u, name } : u))
  }

  function changeLevel(id: string, levelId: string) {
    onChange(units.map(u => u.id === id ? { ...u, level_id: levelId || null } : u))
  }

  // Paste handlers
  function handlePasteForUnit(parentId: string | null, levelId: string | null) {
    setShowHeaderPaste(false)
    setPasteTarget(prev =>
      prev?.parentId === parentId ? null : { parentId, levelId }
    )
  }

  function handlePasteCreate(names: string[], parentId: string | null, levelId: string | null) {
    const position0 = units.filter(u => u.parent_id === parentId).length
    const newUnits: Unit[] = names.map((name, i) => ({
      id: uid(),
      name,
      level_id: levelId,
      parent_id: parentId,
      position: position0 + i,
    }))
    onChange([...units, ...newUnits])
  }

  function handleHeaderPasteCreate(names: string[]) {
    handlePasteCreate(names, null, levels.filter(l => l.enabled)[0]?.id ?? null)
  }

  // Stable callback so UnitRow doesn't re-trigger effect
  const handleFocusConsumed = useCallback(() => {
    setPendingFocusId(null)
  }, [])

  // Users lazy load
  function handleUsersOpen() {
    if (usersFetched) return
    setLoadingUsers(true)
    listUsers()
      .then(users => {
        setAllUsers(users)
        setUsersFetched(true)
      })
      .catch(console.error)
      .finally(() => setLoadingUsers(false))
  }

  function handleAssign(personId: string, unitId: string) {
    // Optimistic update
    setAllUsers(prev => prev.map(u => {
      if (u.id !== personId) return u
      const alreadyMember = u.memberships.some(m => m.unit_id === unitId)
      if (alreadyMember) return u
      return {
        ...u,
        memberships: [...u.memberships, {
          id: 'tmp',
          unit_id: unitId,
          unit_name: '',
          unit_level_color: null,
          unit_level_name: null,
          unit_level_depth: null,
          role: 'member' as UnitRole,
          is_primary: false,
        }],
      }
    }))
    doUpsertMembership(personId, unitId, 'member', false).catch(err => {
      console.error('Failed to assign membership', err)
      // Revert on error
      setAllUsers(prev => prev.map(u => {
        if (u.id !== personId) return u
        return { ...u, memberships: u.memberships.filter(m => !(m.unit_id === unitId && m.id === 'tmp')) }
      }))
    })
  }

  function handleUnassign(personId: string, unitId: string) {
    // Optimistic update
    setAllUsers(prev => prev.map(u => {
      if (u.id !== personId) return u
      return { ...u, memberships: u.memberships.filter(m => m.unit_id !== unitId) }
    }))
    doRemoveMembership(personId, unitId).catch(err => {
      console.error('Failed to remove membership', err)
      // Revert: refetch to get correct state
      listUsers().then(setAllUsers).catch(() => {})
    })
  }

  function handleInvite(unitId: string) {
    setInviteForUnitId(unitId)
    setAddUserOpen(true)
    navigate('/users')
  }

  // Find the last unit in each parentId group to position the paste popover
  // We render PastePopover as a separate row after the last sibling in the group
  const rowsWithPaste: Array<UnitNodeData | { type: 'paste'; parentId: string | null; levelId: string | null }> = []
  if (pasteTarget) {
    // We'll inject a paste row after the last unit matching the pasteTarget.parentId
    let lastMatchIdx = -1
    flat.forEach((node, idx) => {
      if (!levelFilter || node.level_id === levelFilter) {
        if (node.parent_id === pasteTarget.parentId) lastMatchIdx = idx
      }
    })
    flat.forEach((node, idx) => {
      rowsWithPaste.push(node)
      if (idx === lastMatchIdx) {
        rowsWithPaste.push({ type: 'paste', parentId: pasteTarget.parentId, levelId: pasteTarget.levelId })
      }
    })
    // If no matching unit found (new parent), append at end
    if (lastMatchIdx === -1) {
      rowsWithPaste.push({ type: 'paste', parentId: pasteTarget.parentId, levelId: pasteTarget.levelId })
    }
  }

  const renderRows = pasteTarget ? rowsWithPaste : (flat as Array<UnitNodeData | { type: 'paste'; parentId: string | null; levelId: string | null }>)

  return (
    <div className="cd-set-section">
      <div className="cd-set-section-hd">
        <h3 className="cd-set-section-title">Org units</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="cd-btn cd-btn-secondary cd-btn-tiny"
            type="button"
            onClick={() => { setShowHeaderPaste(h => !h); setPasteTarget(null) }}
          >
            ⊞ Paste list
          </button>
          <button
            className="cd-btn cd-btn-secondary cd-btn-tiny"
            type="button"
            onClick={addLevelAbove}
            disabled={!canAddLevelAbove}
            title={addLevelAboveTitle}
          >
            ↑ Level above
          </button>
          <button className="cd-btn cd-btn-secondary cd-btn-tiny" type="button" onClick={addRoot}>
            + Add unit
          </button>
        </div>
      </div>

      {/* Header paste popover */}
      {showHeaderPaste && (
        <PastePopover
          onCreate={handleHeaderPasteCreate}
          onClose={() => setShowHeaderPaste(false)}
        />
      )}

      {/* Level filter */}
      {levels.length > 1 && (
        <div className="cd-unit-level-filter">
          <button
            type="button"
            className={'cd-okr-level-filter' + (!levelFilter ? ' is-on' : '')}
            onClick={() => setLevelFilter(null)}
          >All</button>
          {levels.filter(l => l.enabled).map(l => (
            <button
              key={l.id}
              type="button"
              className={'cd-okr-level-filter' + (levelFilter === l.id ? ' is-on' : '')}
              style={{ '--lf-color': l.color } as React.CSSProperties}
              onClick={() => setLevelFilter(levelFilter === l.id ? null : l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}

      <div className="cd-units-list">
        {units.length === 0 ? (
          <>
            <OrgTemplates
              levels={levels}
              onApply={newUnits => {
                onChange(newUnits)
              }}
              onBlank={addRoot}
            />
            <p className="cd-empty-hint">No units yet. Choose a template above or add one manually.</p>
          </>
        ) : (
          renderRows.map((item, idx) => {
            if ('type' in item && item.type === 'paste') {
              return (
                <div key={`paste-${idx}`} style={{ marginLeft: 12 }}>
                  <PastePopover
                    onCreate={names => handlePasteCreate(names, item.parentId, item.levelId)}
                    onClose={() => setPasteTarget(null)}
                  />
                </div>
              )
            }
            const node = item as UnitNodeData
            return (
              <Fragment key={node.id}>
                <UnitRow
                  unit={node}
                  levels={levels}
                  levelFilter={levelFilter}
                  initEditing={pendingFocusId === node.id}
                  onFocusConsumed={handleFocusConsumed}
                  onAddChild={addChild}
                  onAddSibling={addSibling}
                  onDelete={deleteUnit}
                  onRename={renameUnit}
                  onChangeLevel={changeLevel}
                  onPasteForUnit={handlePasteForUnit}
                  allUsers={allUsers}
                  loadingUsers={loadingUsers}
                  onUsersOpen={handleUsersOpen}
                  onAssign={handleAssign}
                  onUnassign={handleUnassign}
                  onInvite={handleInvite}
                />
              </Fragment>
            )
          })
        )}
      </div>
    </div>
  )
}
