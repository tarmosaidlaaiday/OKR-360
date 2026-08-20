import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Unit } from '../../types/cadence'
import { LEVEL_COLORS } from '../../types/cadence'
import { usePageActionStore } from '../../stores/pageActionStore'
import {
  listUsers,
  upsertMembership as doUpsertMembership,
  removeMembership as doRemoveMembership,
} from '../../services/userManagement.service'
import type { ManagedUser, UnitRole } from '../../services/userManagement.service'
import { suggestOrgStructure } from '../../services/aiSuggestions.service'
import type { OrgTreeNode } from '../../services/aiSuggestions.service'

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

  const members = allUsers.filter(u => u.memberships.some(m => m.unit_id === unitId))

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
  initEditing: boolean
  onFocusConsumed: () => void
  onAddChild: (parentId: string) => void
  onAddSibling: (parentId: string | null) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onPasteForUnit: (parentId: string | null) => void
  allUsers: ManagedUser[]
  loadingUsers: boolean
  onUsersOpen: () => void
  onAssign: (personId: string, unitId: string) => void
  onUnassign: (personId: string, unitId: string) => void
  onInvite: (unitId: string) => void
}

function UnitRow({
  unit,
  initEditing,
  onFocusConsumed,
  onAddChild,
  onAddSibling,
  onDelete,
  onRename,
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
  const dotColor = LEVEL_COLORS[Math.min(unit.depth, LEVEL_COLORS.length - 1)]

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
      onAddSibling(unit.parent_id)
    } else if (e.key === 'Escape') {
      commitName()
    }
  }

  return (
    <div
      className="cd-unit-row"
      style={{ paddingLeft: 12 + unit.depth * 20 }}
    >
      <span
        className="cd-unit-depth-line"
        style={{ left: 12 + (unit.depth - 1) * 20, display: unit.depth > 0 ? undefined : 'none' }}
      />

      {/* Depth color dot */}
      <span
        className="cd-unit-dot"
        style={{ background: dotColor }}
        title={`Depth ${unit.depth}`}
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

      {/* Actions */}
      <div className="cd-unit-actions">
        <button
          type="button"
          className="cd-unit-action"
          onClick={() => onPasteForUnit(unit.parent_id)}
          title="Bulk paste sibling units"
        >
          ⊞ paste
        </button>
        <button
          type="button"
          className="cd-unit-action"
          onClick={() => onAddChild(unit.id)}
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

// ── treeToUnits helper ────────────────────────────────────────────────────

/** Convert a recursive AI tree into a flat Unit[] using temp ids. */
function treeToUnits(nodes: OrgTreeNode[], parentId: string | null = null, counter = { n: 0 }): Unit[] {
  const result: Unit[] = []
  for (const node of nodes) {
    const id = uid()
    result.push({ id, name: node.name, level_id: null, parent_id: parentId, position: counter.n++ })
    if (node.children?.length) {
      result.push(...treeToUnits(node.children, id, counter))
    }
  }
  return result
}

// ── AIGeneratorPanel ──────────────────────────────────────────────────────

interface AIGeneratorPanelProps {
  onGenerate: (units: Unit[]) => void
  onCancel?: () => void
}

function AIGeneratorPanel({ onGenerate, onCancel }: AIGeneratorPanelProps) {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate() {
    if (!description.trim()) return
    setLoading(true)
    setError(null)
    try {
      const nodes = await suggestOrgStructure(description)
      const units = treeToUnits(nodes)
      if (units.length === 0) {
        setError('The AI returned an empty structure. Try a more detailed description.')
        return
      }
      onGenerate(units)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI suggestion failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
        Describe your company's structure in plain language. The AI will build a draft you can edit before saving.
      </p>
      <textarea
        className="cd-paste-textarea"
        rows={7}
        placeholder="e.g. We're a 40-person marketing agency with Creative, Client Services, and Operations departments. Creative has Design and Copywriting teams."
        value={description}
        onChange={e => setDescription(e.target.value)}
        disabled={loading}
      />
      {error && (
        <p style={{ fontSize: 13, color: 'var(--bad)', margin: '6px 0 0' }}>{error}</p>
      )}
      <div className="cd-paste-actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="cd-btn cd-btn-primary cd-btn-tiny"
          onClick={handleGenerate}
          disabled={!description.trim() || loading}
        >
          {loading ? 'Generating…' : 'Generate structure'}
        </button>
        {onCancel && (
          <button type="button" className="cd-btn cd-btn-tiny" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

// ── Starter templates ─────────────────────────────────────────────────────

interface OrgTemplatesProps {
  onApply: (units: Unit[]) => void
  onBlank: () => void
}

function OrgTemplates({ onApply, onBlank }: OrgTemplatesProps) {
  const [mode, setMode] = useState<'choice' | 'templates' | 'ai'>('choice')

  /** Build a simple two-level structure: one root named "Company" with leaves as children. */
  function makeHierarchy(leafNames: string[]): Unit[] {
    const rootId = uid()
    const root: Unit = { id: rootId, name: 'Company', level_id: null, parent_id: null, position: 0 }
    const leaves: Unit[] = leafNames.map((name, i) => ({
      id: uid(), name, level_id: null, parent_id: rootId, position: i,
    }))
    return [root, ...leaves]
  }

  if (mode === 'choice') {
    return (
      <div className="cd-org-method-choice">
        <button type="button" className="cd-org-method-card" onClick={() => setMode('templates')}>
          <span className="cd-org-method-icon">⊞</span>
          <span className="cd-org-method-title">Use a template</span>
          <span className="cd-org-method-desc">Start from a ready-made structure</span>
        </button>
        <button
          type="button"
          className="cd-org-method-card"
          onClick={() => setMode('ai')}
        >
          <span className="cd-org-method-icon">✦</span>
          <span className="cd-org-method-title">Describe your company</span>
          <span className="cd-org-method-desc">Let AI generate a structure from a plain-language description</span>
        </button>
        <button type="button" className="cd-org-method-card" onClick={onBlank}>
          <span className="cd-org-method-icon">+</span>
          <span className="cd-org-method-title">Build step by step</span>
          <span className="cd-org-method-desc">Add units one at a time from scratch</span>
        </button>
      </div>
    )
  }

  if (mode === 'ai') {
    return (
      <div>
        <button type="button" className="cd-org-template-back" onClick={() => setMode('choice')}>
          ← Back
        </button>
        <AIGeneratorPanel onGenerate={units => onApply(units)} />
      </div>
    )
  }

  // mode === 'templates'
  return (
    <div>
      <button type="button" className="cd-org-template-back" onClick={() => setMode('choice')}>
        ← Back
      </button>
      <div className="cd-org-templates">
        <button
          type="button"
          className="cd-org-template-card"
          onClick={() => onApply(makeHierarchy(['Team 1', 'Team 2', 'Team 3']))}
        >
          <span className="cd-org-template-title">Teams</span>
          <span className="cd-org-template-desc">Company → Team 1, Team 2, Team 3</span>
        </button>
        <button
          type="button"
          className="cd-org-template-card"
          onClick={() => onApply(makeHierarchy(['Sales', 'Marketing', 'Engineering', 'Operations']))}
        >
          <span className="cd-org-template-title">Departments</span>
          <span className="cd-org-template-desc">Company → Sales, Marketing, Engineering, Operations</span>
        </button>
      </div>
    </div>
  )
}

// ── UnitsTree ─────────────────────────────────────────────────────────────

interface UnitsTreeProps {
  units: Unit[]
  onChange: (units: Unit[]) => void
}

export function UnitsTree({ units, onChange }: UnitsTreeProps) {
  const navigate = useNavigate()
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [pasteTarget, setPasteTarget] = useState<{ parentId: string | null } | null>(null)
  const [showHeaderPaste, setShowHeaderPaste] = useState(false)
  const [showAiPanel, setShowAiPanel] = useState(false)

  // User data for picker (lazy loaded)
  const [allUsers, setAllUsers] = useState<ManagedUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersFetched, setUsersFetched] = useState(false)

  const { addUnitOpen, setAddUnitOpen, setAddUserOpen, setInviteForUnitId } = usePageActionStore()

  const tree = buildUnitTree(units)
  const flat = flattenWithDepth(tree)

  // "+ Level above" is available as long as there are existing root units to
  // reparent. The new ancestor's level_id is auto-derived from depth on save.
  const rootUnits = units.filter(u => u.parent_id === null)
  const canAddLevelAbove = rootUnits.length > 0

  useEffect(() => {
    if (addUnitOpen) {
      addRoot()
      setAddUnitOpen(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addUnitOpen])

  function addRoot() {
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: null, // auto-assigned on save based on depth
      parent_id: null,
      position: units.length,
    }
    onChange([...units, newUnit])
    setPendingFocusId(newId)
  }

  function addLevelAbove() {
    if (!canAddLevelAbove) return
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: null, // auto-assigned on save based on depth
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

  function addChild(parentId: string) {
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: null, // auto-assigned on save based on depth
      parent_id: parentId,
      position: units.filter(u => u.parent_id === parentId).length,
    }
    onChange([...units, newUnit])
    setPendingFocusId(newId)
  }

  function addSibling(parentId: string | null) {
    const newId = uid()
    const newUnit: Unit = {
      id: newId,
      name: 'New unit',
      level_id: null, // auto-assigned on save based on depth
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

  // Paste handlers
  function handlePasteForUnit(parentId: string | null) {
    setShowHeaderPaste(false)
    setPasteTarget(prev =>
      prev?.parentId === parentId ? null : { parentId }
    )
  }

  function handlePasteCreate(names: string[], parentId: string | null) {
    const position0 = units.filter(u => u.parent_id === parentId).length
    const newUnits: Unit[] = names.map((name, i) => ({
      id: uid(),
      name,
      level_id: null,
      parent_id: parentId,
      position: position0 + i,
    }))
    onChange([...units, ...newUnits])
  }

  function handleHeaderPasteCreate(names: string[]) {
    handlePasteCreate(names, null)
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
      setAllUsers(prev => prev.map(u => {
        if (u.id !== personId) return u
        return { ...u, memberships: u.memberships.filter(m => !(m.unit_id === unitId && m.id === 'tmp')) }
      }))
    })
  }

  function handleUnassign(personId: string, unitId: string) {
    setAllUsers(prev => prev.map(u => {
      if (u.id !== personId) return u
      return { ...u, memberships: u.memberships.filter(m => m.unit_id !== unitId) }
    }))
    doRemoveMembership(personId, unitId).catch(err => {
      console.error('Failed to remove membership', err)
      listUsers().then(setAllUsers).catch(err => console.error('UnitsTree: listUsers refetch failed', err))
    })
  }

  function handleInvite(unitId: string) {
    setInviteForUnitId(unitId)
    setAddUserOpen(true)
    navigate('/users')
  }

  // Inject paste popover row after the last sibling in the paste target group
  const rowsWithPaste: Array<UnitNodeData | { type: 'paste'; parentId: string | null }> = []
  if (pasteTarget) {
    let lastMatchIdx = -1
    flat.forEach((node, idx) => {
      if (node.parent_id === pasteTarget.parentId) lastMatchIdx = idx
    })
    flat.forEach((node, idx) => {
      rowsWithPaste.push(node)
      if (idx === lastMatchIdx) {
        rowsWithPaste.push({ type: 'paste', parentId: pasteTarget.parentId })
      }
    })
    if (lastMatchIdx === -1) {
      rowsWithPaste.push({ type: 'paste', parentId: pasteTarget.parentId })
    }
  }

  const renderRows = pasteTarget ? rowsWithPaste : (flat as Array<UnitNodeData | { type: 'paste'; parentId: string | null }>)

  return (
    <div className="cd-set-section">
      <div className="cd-set-section-hd">
        <h3 className="cd-set-section-title">Org units</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="cd-btn cd-btn-secondary cd-btn-tiny"
            type="button"
            onClick={() => { setShowAiPanel(v => !v); setShowHeaderPaste(false); setPasteTarget(null) }}
          >
            ✦ Generate with AI
          </button>
          <button
            className="cd-btn cd-btn-secondary cd-btn-tiny"
            type="button"
            onClick={() => { setShowHeaderPaste(h => !h); setShowAiPanel(false); setPasteTarget(null) }}
          >
            ⊞ Paste list
          </button>
          <button
            className="cd-btn cd-btn-secondary cd-btn-tiny"
            type="button"
            onClick={addLevelAbove}
            disabled={!canAddLevelAbove}
            title={canAddLevelAbove
              ? 'Insert a new unit above all current top-level units'
              : 'Add units first'}
          >
            ↑ Level above
          </button>
          <button className="cd-btn cd-btn-secondary cd-btn-tiny" type="button" onClick={addRoot}>
            + Add unit
          </button>
        </div>
      </div>

      {/* AI generator panel — always available, additive when units already exist */}
      {showAiPanel && (
        <AIGeneratorPanel
          onGenerate={newUnits => {
            onChange([...units, ...newUnits])
            setShowAiPanel(false)
          }}
          onCancel={() => setShowAiPanel(false)}
        />
      )}

      {/* Header paste popover */}
      {showHeaderPaste && (
        <PastePopover
          onCreate={handleHeaderPasteCreate}
          onClose={() => setShowHeaderPaste(false)}
        />
      )}

      <div className="cd-units-list">
        {units.length === 0 ? (
          <OrgTemplates
            onApply={newUnits => onChange(newUnits)}
            onBlank={addRoot}
          />
        ) : (
          renderRows.map((item, idx) => {
            if ('type' in item && item.type === 'paste') {
              return (
                <div key={`paste-${idx}`} style={{ marginLeft: 12 }}>
                  <PastePopover
                    onCreate={names => handlePasteCreate(names, item.parentId)}
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
                  initEditing={pendingFocusId === node.id}
                  onFocusConsumed={handleFocusConsumed}
                  onAddChild={addChild}
                  onAddSibling={addSibling}
                  onDelete={deleteUnit}
                  onRename={renameUnit}
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
