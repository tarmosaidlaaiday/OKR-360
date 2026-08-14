import { useEffect, useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useOrg } from '../context/OrgContext'
import { createLevel } from '../services/levels.service'
import { saveUnits, createUnit, deleteUnit } from '../services/units.service'
import { saveOrgSettings } from '../services/orgSettings.service'
import { UnitsTree } from '../components/settings/UnitsTree'
import { CascadeSettings } from '../components/settings/CascadeSettings'
import type { Unit, OrgSettings } from '../types/cadence'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PALETTE = ['#6366f1', '#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#14b8a6', '#eab308']

/**
 * Compute depth for every unit in a flat list (root = 0).
 * Works with both real UUIDs and temporary new_ ids since depth is structural.
 * Includes a cycle guard so a broken parent_id chain can't loop forever.
 */
function computeDepths(units: Unit[]): Map<string, number> {
  const byId = new Map<string, Unit>()
  for (const u of units) byId.set(u.id, u)
  const result = new Map<string, number>()
  function depth(id: string, visiting = new Set<string>()): number {
    if (result.has(id)) return result.get(id)!
    if (visiting.has(id)) { result.set(id, 0); return 0 } // cycle guard
    visiting.add(id)
    const u = byId.get(id)
    if (!u || !u.parent_id || !byId.has(u.parent_id)) {
      result.set(id, 0)
      return 0
    }
    const d = depth(u.parent_id, visiting) + 1
    result.set(id, d)
    return d
  }
  for (const u of units) depth(u.id)
  return result
}

export function OrgStructurePage() {
  const { levels: ctxLevels, units: ctxUnits, settings: ctxSettings, org, refresh } = useOrg()

  const [draftUnits, setDraftUnits]       = useState<Unit[]>(ctxUnits)
  const [draftSettings, setDraftSettings] = useState<OrgSettings>(ctxSettings)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  useEffect(() => { setDraftUnits(ctxUnits)       }, [ctxUnits])
  useEffect(() => { setDraftSettings(ctxSettings) }, [ctxSettings])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // ── Auto-manage levels by depth ──────────────────────────────────────
      // Levels are no longer configured by admins — they are derived from the
      // unit tree's depth structure and managed automatically on every save.
      //
      // Compute the depth of every unit in the current draft (works with temp
      // ids since depth is purely structural, not id-dependent).
      const depths  = computeDepths(draftUnits)
      const maxDepth = draftUnits.length > 0
        ? Math.max(0, ...Array.from(depths.values()))
        : -1

      // For each depth 0..maxDepth, ensure a level row exists.
      // Existing levels matched by position (= depth) are reused as-is, so
      // orgs that previously configured named/colored levels keep those
      // names and colors for the matching depth. Only depths with no
      // existing real-UUID level get a fresh auto-generated one.
      const depthToLevelId = new Map<number, string>()
      for (let d = 0; d <= maxDepth; d++) {
        const existing = ctxLevels.find(l => l.position === d && UUID_RE.test(l.id))
        if (existing) {
          depthToLevelId.set(d, existing.id)
        } else {
          const created = await createLevel({
            name: `Level ${d + 1}`,
            color: PALETTE[d % PALETTE.length],
            position: d,
            enabled: true,
          })
          depthToLevelId.set(d, created.id)
        }
      }

      // Stamp every draft unit with the level_id for its depth. This replaces
      // any manually-set or stale level_id the unit may have had.
      const unitsWithLevels: Unit[] = draftUnits.map(u => ({
        ...u,
        level_id: depthToLevelId.get(depths.get(u.id) ?? 0) ?? null,
      }))

      // ── Delete removed units ─────────────────────────────────────────────
      const removedUnitIds = ctxUnits
        .filter(u => !unitsWithLevels.find(du => du.id === u.id))
        .map(u => u.id)
      for (const id of removedUnitIds) await deleteUnit(id)

      // ── Insert new units in dependency order ─────────────────────────────
      // New units (temp ids like new_*) are inserted in topological order so
      // a child can reference its parent's real id once the parent is inserted.
      const existingUnits = unitsWithLevels.filter(u => !u.id.startsWith('new_'))
      const newUnits      = unitsWithLevels.filter(u =>  u.id.startsWith('new_'))

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
          const parentIsNull     = u.parent_id === null
          const parentIsRealUUID = u.parent_id !== null && UUID_RE.test(u.parent_id)
          const parentIsResolved = u.parent_id !== null && tempToReal.has(u.parent_id)
          if (!parentIsNull && !parentIsRealUUID && !parentIsResolved) continue

          const levelId  = UUID_RE.test(u.level_id ?? '') ? u.level_id : null
          const parentId = resolveParentId(u.parent_id ?? null)
          if (parentId !== null && !UUID_RE.test(parentId)) {
            throw new Error(`Unit "${u.name}": resolved parent_id "${parentId}" is not a valid UUID`)
          }
          const created = await createUnit({
            name: u.name, level_id: levelId, parent_id: parentId,
            position: u.position, org_id: org?.id,
          })
          tempToReal.set(u.id, created.id)
          pending.splice(i, 1)
        }
        if (pending.length === before) {
          const names = pending.map(u => `"${u.name}" (parent_id: ${u.parent_id})`).join(', ')
          throw new Error(`Could not resolve parent references for new units: ${names}`)
        }
      }

      // ── Remap existing units and save ─────────────────────────────────────
      // Remap any parent_id that points at a temp id (existing unit reparented
      // under a brand-new ancestor this session), and nullify any level_id that
      // is not a valid UUID (stale placeholder from before auto-management).
      const remappedExistingUnits = existingUnits.map(u => {
        let out = u
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

      // ── Settings ──────────────────────────────────────────────────────────
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
    JSON.stringify(draftUnits)    !== JSON.stringify(ctxUnits) ||
    JSON.stringify(draftSettings) !== JSON.stringify(ctxSettings)

  return (
    <div className="cd-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Org structure</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>Configure your org units and cascade behaviour</p>
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
        <div className="cd-org-left">
          <UnitsTree
            units={draftUnits}
            onChange={setDraftUnits}
          />
        </div>
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
