import { useEffect, useState } from 'react'
import { useOrg } from '../context/OrgContext'
import { saveLevels, deleteLevel } from '../services/levels.service'
import { saveUnits, createUnit, deleteUnit } from '../services/units.service'
import { saveOrgSettings } from '../services/orgSettings.service'
import { LevelsEditor } from '../components/settings/LevelsEditor'
import { UnitsTree } from '../components/settings/UnitsTree'
import { CascadeSettings } from '../components/settings/CascadeSettings'
import { SidebarPreview } from '../components/settings/SidebarPreview'
import { PageHeader } from '../components/cadence/PageHeader'
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
      // Levels — upsert and delete removed ones
      await saveLevels(draftLevels)
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

      if (existingUnits.length) await saveUnits(existingUnits)
      for (const u of newUnits) {
        await createUnit({ name: u.name, level_id: u.level_id, parent_id: u.parent_id, position: u.position, org_id: org?.id })
      }

      // Settings
      await saveOrgSettings(draftSettings)

      refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
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
      <PageHeader
        title="Org structure"
        sub="Configure your hierarchy, units, and cascade behaviour"
        actions={
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
        }
      />

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

        {/* Right column: Live preview + Cascade toggles */}
        <div className="cd-org-right">
          <div className="cd-set-section">
            <h3 className="cd-set-section-title">Sidebar preview</h3>
            <p className="cd-set-section-sub">Updates live as you make changes.</p>
            <SidebarPreview levels={draftLevels} units={draftUnits} />
          </div>

          <CascadeSettings
            settings={draftSettings}
            onChange={setDraftSettings}
          />
        </div>
      </div>
    </div>
  )
}
