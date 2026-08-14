import { useEffect, useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useOrg } from '../context/OrgContext'
import { saveLevels, deleteLevel } from '../services/levels.service'
import { saveUnits, createUnit, deleteUnit } from '../services/units.service'
import { saveOrgSettings } from '../services/orgSettings.service'
import { LevelsEditor } from '../components/settings/LevelsEditor'
import { UnitsTree } from '../components/settings/UnitsTree'
import { CascadeSettings } from '../components/settings/CascadeSettings'
import type { Level, Unit, OrgSettings } from '../types/cadence'

export function OrgStructurePage() {
  const { levels: ctxLevels, units: ctxUnits, settings: ctxSettings, org, refresh } = useOrg()

  // Local draft state — what the user is editing
  const [draftLevels, setDraftLevels]     = useState<Level[]>(ctxLevels)
  const [draftUnits, setDraftUnits]       = useState<Unit[]>(ctxUnits)
  const [draftSettings, setDraftSettings] = useState<OrgSettings>(ctxSettings)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  // Sync with context when it loads
  useEffect(() => { setDraftLevels(ctxLevels) }, [ctxLevels])
  useEffect(() => { setDraftUnits(ctxUnits)   }, [ctxUnits])
  useEffect(() => { setDraftSettings(ctxSettings) }, [ctxSettings])

  const unitCounts: Record<string, number> = {}
  for (const u of draftUnits) {
    if (u.level_id) unitCounts[u.level_id] = (unitCounts[u.level_id] ?? 0) + 1
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Levels — only upsert levels with real DB UUIDs. Fallback levels
      // (ids like 'group', 'company') are placeholders used when an org has
      // no levels yet; upserting them would fail Postgres UUID type checking.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const realLevels = draftLevels.filter(l => UUID_RE.test(l.id))
      if (realLevels.length) await saveLevels(realLevels)

      const removedLevelIds = ctxLevels
        .filter(l => !draftLevels.find(dl => dl.id === l.id))
        .map(l => l.id)
      for (const id of removedLevelIds) await deleteLevel(id)

      // Units — delete removed ones, then upsert remaining
      const removedUnitIds = ctxUnits
        .filter(u => !draftUnits.find(du => du.id === u.id))
        .map(u => u.id)
      for (const id of removedUnitIds) await deleteUnit(id)

      // Upsert remaining — split new vs existing
      const existingUnits = draftUnits.filter(u => !u.id.startsWith('new_'))
      const newUnits = draftUnits.filter(u => u.id.startsWith('new_'))

      // Insert new units in dependency order, resolving temp IDs to real UUIDs.
      // A new unit can only be inserted once its parent (if also new) has been
      // inserted and its real id is known.
      const tempToReal = new Map<string, string>()
      const resolveParentId = (parentId: string | null): string | null => {
        if (parentId === null) return null
        if (tempToReal.has(parentId)) return tempToReal.get(parentId)!
        if (UUID_RE.test(parentId)) return parentId
        throw new Error(`Cannot resolve parent_id "${parentId}" — no matching inserted unit found`)
      }
      const pending = [...newUnits]
      while (pending.length > 0) {
        const before = pending.length
        for (let i = pending.length - 1; i >= 0; i--) {
          const u = pending[i]
          // Check whether this unit's parent_id is resolvable right now
          const parentIsNull = u.parent_id === null
          const parentIsRealUUID = u.parent_id !== null && UUID_RE.test(u.parent_id)
          const parentIsResolved = u.parent_id !== null && tempToReal.has(u.parent_id)
          if (!parentIsNull && !parentIsRealUUID && !parentIsResolved) continue

          const levelId = UUID_RE.test(u.level_id ?? '') ? u.level_id : null
          const parentId = resolveParentId(u.parent_id ?? null)
          if (parentId !== null && !UUID_RE.test(parentId)) {
            throw new Error(`Unit "${u.name}": resolved parent_id "${parentId}" is not a valid UUID`)
          }
          const created = await createUnit({ name: u.name, level_id: levelId, parent_id: parentId, position: u.position, org_id: org?.id })
          tempToReal.set(u.id, created.id)
          pending.splice(i, 1)
        }
        if (pending.length === before) {
          // No progress — cycle or orphaned reference in new units
          const names = pending.map(u => `"${u.name}" (parent_id: ${u.parent_id})`).join(', ')
          throw new Error(`Could not resolve parent references for new units: ${names}`)
        }
      }

      // Before saving existing units, remap any parent_id that points at a
      // temp id (e.g. an existing unit reparented under a brand-new ancestor),
      // and nullify any level_id that is not a valid UUID (stale fallback
      // placeholder values like 'group' or 'company' from OrgContext defaults).
      const remappedExistingUnits = existingUnits.map(u => {
        let out = u
        // Remap temp parent_id to real UUID
        if (out.parent_id !== null && !UUID_RE.test(out.parent_id)) {
          const resolved = tempToReal.get(out.parent_id)
          if (!resolved) {
            throw new Error(`Unit "${u.name}": parent_id "${u.parent_id}" is a temp id but was not inserted in this save`)
          }
          if (!UUID_RE.test(resolved)) {
            throw new Error(`Unit "${u.name}": resolved parent_id "${resolved}" is not a valid UUID`)
          }
          out = { ...out, parent_id: resolved }
        }
        // Nullify stale placeholder level_id values (e.g. 'group', 'company')
        // that predate real levels being configured — same guard already applied
        // to new units in the insertion loop above.
        if (out.level_id != null && !UUID_RE.test(out.level_id)) {
          out = { ...out, level_id: null }
        }
        return out
      })

      // Final safety net: catch any remaining invalid field values before they
      // reach the DB and produce a cryptic Postgres UUID type error.
      for (const u of remappedExistingUnits) {
        if (u.parent_id !== null && !UUID_RE.test(u.parent_id)) {
          throw new Error(`Unit "${u.name}": parent_id "${u.parent_id}" is not a valid UUID — cannot save`)
        }
        if (u.level_id != null && !UUID_RE.test(u.level_id)) {
          throw new Error(`Unit "${u.name}": level_id "${u.level_id}" is not a valid UUID — cannot save`)
        }
      }
      if (remappedExistingUnits.length) await saveUnits(remappedExistingUnits)

      // Settings
      await saveOrgSettings(draftSettings)

      refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const isDirty =
    JSON.stringify(draftLevels) !== JSON.stringify(ctxLevels) ||
    JSON.stringify(draftUnits) !== JSON.stringify(ctxUnits) ||
    JSON.stringify(draftSettings) !== JSON.stringify(ctxSettings)

  return (
    <div className="cd-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Org structure</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>Configure your hierarchy, units, and cascade behaviour</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 13, color: 'var(--ok)' }}>Saved</span>}
          {error && <span style={{ fontSize: 13, color: 'var(--bad)' }}>{error}</span>}
          <button
            className="cd-btn cd-btn-primary"
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="cd-org-layout">
        {/* Left column: Levels + Units */}
        <div className="cd-org-left">
          <LevelsEditor
            levels={draftLevels}
            onChange={setDraftLevels}
            unitCounts={unitCounts}
          />
          <UnitsTree
            units={draftUnits}
            levels={draftLevels}
            onChange={setDraftUnits}
          />
        </div>

        {/* Right column: Cascade toggles */}
        <div className="cd-org-right">
          <CascadeSettings
            settings={draftSettings}
            onChange={setDraftSettings}
          />
        </div>
      </div>
    </div>
  )
}
