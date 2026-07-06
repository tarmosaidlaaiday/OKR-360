import { useState, useEffect, useRef } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { CdModal } from '../cadence/CdModal'
import { Icon } from '../cadence/Icon'
import { TemplatePicker } from './TemplatePicker'
import { useCycle } from '../../context/CycleContext'
import { supabase } from '../../lib/supabase'
import { keyResultsService } from '../../services/keyResults.service'
import { suggestKRs } from '../../services/aiSuggestions.service'
import type { OKRTemplate } from '../../data/okrTemplates'
import type { Objective, CreateObjectiveInput, ObjectiveStatus } from '../../types'
import type { KrTargetType } from '../../types'

const STATUS_OPTIONS: { value: ObjectiveStatus; label: string }[] = [
  { value: 'on_track',  label: 'On Track'  },
  { value: 'at_risk',   label: 'At Risk'   },
  { value: 'behind',    label: 'Behind'    },
  { value: 'completed', label: 'Completed' },
]

// ── KR draft state ────────────────────────────────────────────────────────

interface KRDraft {
  id: string
  title: string
  targetValue: number
  unit: string
  targetType: KrTargetType
  checked: boolean
  isCustom: boolean
}

function makeId() {
  return Math.random().toString(36).slice(2)
}

function blankDraft(): KRDraft {
  return { id: makeId(), title: '', targetValue: 0, unit: '', targetType: 'numeric', checked: true, isCustom: true }
}

// ── KR card ───────────────────────────────────────────────────────────────

function KrDraftCard({
  draft,
  onChange,
  onToggle,
}: {
  draft: KRDraft
  onChange: (patch: Partial<KRDraft>) => void
  onToggle: () => void
}) {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draft.checked) titleRef.current?.focus()
  }, [draft.checked])

  const targetDisplay = draft.targetType === 'boolean'
    ? 'Done / not done'
    : draft.targetType === 'percentage'
    ? `${draft.targetValue}%`
    : `${draft.targetValue.toLocaleString()}${draft.unit ? ' ' + draft.unit : ''}`

  return (
    <div
      className={'cd-ai-suggestion-row' + (draft.checked ? ' is-checked' : '')}
      onClick={!draft.checked ? onToggle : undefined}
      style={{ cursor: draft.checked ? 'default' : 'pointer' }}
    >
      <input
        type="checkbox"
        checked={draft.checked}
        onChange={onToggle}
        onClick={e => e.stopPropagation()}
        className="cd-ai-suggestion-chk"
      />

      <div className="cd-ai-suggestion-body" style={{ flex: 1, minWidth: 0 }}>
        {draft.checked ? (
          <div className="cd-kr-edit">
            <input
              ref={titleRef}
              type="text"
              className="cd-kr-edit-title"
              value={draft.title}
              onChange={e => onChange({ title: e.target.value })}
              placeholder="Key result title…"
              onClick={e => e.stopPropagation()}
            />
            <div className="cd-kr-edit-meta">
              <select
                className="cd-kr-edit-type"
                value={draft.targetType}
                onChange={e => onChange({ targetType: e.target.value as KrTargetType })}
                onClick={e => e.stopPropagation()}
              >
                <option value="numeric">Numeric</option>
                <option value="percentage">%</option>
                <option value="boolean">Done/not done</option>
              </select>
              {draft.targetType !== 'boolean' && (
                <>
                  <input
                    type="number"
                    className="cd-kr-edit-target"
                    value={draft.targetValue}
                    onChange={e => onChange({ targetValue: parseFloat(e.target.value) || 0 })}
                    onClick={e => e.stopPropagation()}
                    step="any"
                  />
                  {draft.targetType === 'numeric' && (
                    <input
                      type="text"
                      className="cd-kr-edit-unit"
                      value={draft.unit}
                      onChange={e => onChange({ unit: e.target.value })}
                      onClick={e => e.stopPropagation()}
                      placeholder="unit"
                    />
                  )}
                  {draft.targetType === 'percentage' && (
                    <span className="cd-kr-edit-unit-fixed">%</span>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="cd-ai-suggestion-body">
            <span className="cd-ai-suggestion-title">{draft.title || <em>Untitled</em>}</span>
            <span className="cd-ai-suggestion-meta">{targetDisplay}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form ──────────────────────────────────────────────────────────────────

interface ObjOption { id: string; title: string }
interface UnitOption { id: string; name: string }

interface ObjectiveFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: CreateObjectiveInput) => Promise<string | void>
  objective?: Objective | null
}

export function ObjectiveForm({ open, onClose, onSubmit, objective }: ObjectiveFormProps) {
  const { activeCycle, cycles, refresh } = useCycle()
  const isEdit = !!objective

  const [title, setTitle]               = useState(objective?.title ?? '')
  const [description, setDescription]   = useState(objective?.description ?? '')
  const [cycleId, setCycleId]           = useState<string>(objective?.cycle_id ?? '')
  const [unitId, setUnitId]             = useState<string>(objective?.unit_id ?? '')
  const [parentId, setParentId]         = useState<string>((objective as any)?.parent_objective_id ?? '')
  const [status, setStatus]             = useState<ObjectiveStatus>(objective?.status ?? 'on_track')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  const [units, setUnits]               = useState<UnitOption[]>([])
  const [parentOpts, setParentOpts]     = useState<ObjOption[]>([])

  const [krs, setKrs]                   = useState<KRDraft[]>([])
  const [aiLoading, setAiLoading]       = useState(false)
  const [aiError, setAiError]           = useState('')
  const [tplOpen, setTplOpen]           = useState(false)

  // Default cycleId once cycles are available (only when not already set)
  useEffect(() => {
    if (cycleId || isEdit) return
    const fallback = activeCycle?.id ?? cycles[cycles.length - 1]?.id ?? ''
    if (fallback) setCycleId(fallback)
  }, [cycles, activeCycle, cycleId, isEdit])

  // Load units + parent objectives when the modal opens; also refresh cycles
  // so a cycle just created in Settings appears without a full page reload.
  useEffect(() => {
    if (!open) return
    refresh()
    supabase.from('units').select('id, name').order('name').then(({ data }) => {
      setUnits((data ?? []) as UnitOption[])
    })
  }, [open, refresh])

  // Re-fetch parent objectives whenever the selected cycle changes
  useEffect(() => {
    if (!cycleId) { setParentOpts([]); return }
    supabase
      .from('objectives')
      .select('id, title')
      .eq('cycle_id', cycleId)
      .order('title')
      .then(({ data }) => {
        const opts = ((data ?? []) as ObjOption[]).filter(o => o.id !== objective?.id)
        setParentOpts(opts)
      })
  }, [cycleId, objective?.id])

  useEffect(() => {
    setTitle(objective?.title ?? '')
    setDescription(objective?.description ?? '')
    setCycleId(objective?.cycle_id ?? '')
    setUnitId(objective?.unit_id ?? '')
    setParentId((objective as any)?.parent_objective_id ?? '')
    setStatus(objective?.status ?? 'on_track')
    setError('')
    setKrs([])
    setAiError('')
  }, [objective])

  function fromSuggestions(raw: { title: string; target_type: KrTargetType; target_value: number; unit: string | null }[]): KRDraft[] {
    return raw.map(s => ({
      id: makeId(),
      title: s.title,
      targetValue: s.target_value,
      unit: s.unit ?? '',
      targetType: s.target_type,
      checked: true,
      isCustom: false,
    }))
  }

  async function handleSuggest() {
    if (title.trim().length < 4) return
    setAiLoading(true)
    setAiError('')
    setKrs([])
    try {
      const results = await suggestKRs(title.trim())
      setKrs(fromSuggestions(results))
    } catch (e) {
      setAiError(getErrorMessage(e))
    } finally {
      setAiLoading(false)
    }
  }

  function handleTemplateSelect(tpl: OKRTemplate) {
    setTitle(tpl.title)
    setKrs(fromSuggestions(tpl.krs))
    setAiError('')
  }

  function updateKr(id: string, patch: Partial<KRDraft>) {
    setKrs(prev => prev.map(k => k.id === id ? { ...k, ...patch } : k))
  }

  function toggleKr(id: string) {
    setKrs(prev => prev.map(k => k.id === id ? { ...k, checked: !k.checked } : k))
  }

  function addBlankKr() {
    setKrs(prev => [...prev, blankDraft()])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!cycleId) { setError('Please select a cycle'); return }
    setLoading(true)
    setError('')
    try {
      const objectiveId = await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        unit_id: unitId || null,
        parent_objective_id: parentId || null,
        cycle_id: cycleId,
        status,
      })

      const toCreate = krs.filter(k => k.checked && k.title.trim())
      if (typeof objectiveId === 'string' && toCreate.length > 0) {
        await Promise.all(
          toCreate.map(k =>
            keyResultsService.create({
              objective_id: objectiveId,
              title: k.title.trim(),
              target_type: k.targetType,
              target_value: k.targetValue,
              unit: k.unit.trim() || null,
            })
          )
        )
      }

      onClose()
      if (!isEdit) {
        setTitle(''); setDescription('')
        setCycleId(activeCycle?.id ?? '')
        setUnitId(''); setParentId(''); setStatus('on_track')
        setKrs([]); setAiError('')
      }
    } catch (ex) {
      setError(getErrorMessage(ex))
    } finally {
      setLoading(false)
    }
  }

  const checkedCount = krs.filter(k => k.checked && k.title.trim()).length
  const canSuggest   = !isEdit && title.trim().length >= 4
  const noCycles     = cycles.length === 0

  return (
    <CdModal open={open} onClose={onClose} title={isEdit ? 'Edit Objective' : 'New Objective'} width={540}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Title */}
        <label className="cd-field">
          <span className="cd-field-lbl">Title <span style={{ color: 'var(--bad)' }}>*</span></span>
          <input
            className="cd-um-input"
            placeholder="What do you want to achieve this quarter?"
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoFocus
            required
          />
        </label>

        {/* Description */}
        <label className="cd-field">
          <span className="cd-field-lbl">Description <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(optional)</span></span>
          <textarea
            className="cd-um-input"
            placeholder="What does success look like?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', minHeight: 64 }}
          />
        </label>

        {/* Quick-start row: template + AI */}
        {!isEdit && (
          <div className="cd-obj-quickstart">
            <button
              type="button"
              className="cd-btn cd-btn--ghost cd-btn--sm cd-tpl-btn"
              onClick={() => setTplOpen(true)}
            >
              <Icon name="grid" size={13} />
              Use a template
            </button>
            {canSuggest && (
              <button
                type="button"
                className="cd-ai-suggest-btn"
                onClick={handleSuggest}
                disabled={aiLoading}
              >
                ✦ {aiLoading ? 'Thinking…' : krs.length > 0 ? 'Regenerate with AI' : 'Suggest key results with AI'}
              </button>
            )}
          </div>
        )}
        {aiError && (
          <p style={{ fontSize: 12, color: 'var(--bad)', margin: '-8px 0 0' }}>{aiError}</p>
        )}

        {/* KR draft list */}
        {(krs.length > 0 || !isEdit) && (
          <div className="cd-ai-suggestions">
            {krs.length > 0 && (
              <>
                <div className="cd-ai-suggestions-header">
                  <span>✦</span>
                  <span>Customise key results — edit titles, targets, and units before saving</span>
                </div>
                <div className="cd-ai-suggestions-list">
                  {krs.map(draft => (
                    <KrDraftCard
                      key={draft.id}
                      draft={draft}
                      onChange={patch => updateKr(draft.id, patch)}
                      onToggle={() => toggleKr(draft.id)}
                    />
                  ))}
                </div>
              </>
            )}
            {!isEdit && (
              <button
                type="button"
                className="cd-kr-add-btn"
                onClick={addBlankKr}
              >
                <Icon name="plus" size={13} />
                Add key result
              </button>
            )}
            {krs.length > 0 && checkedCount === 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '4px 0 0' }}>
                No key results selected — objective will be created without KRs.
              </p>
            )}
          </div>
        )}

        {/* Cycle */}
        <label className="cd-field">
          <span className="cd-field-lbl">
            Cycle <span style={{ color: 'var(--bad)' }}>*</span>
          </span>
          {noCycles ? (
            <p className="cd-empty-hint" style={{ margin: 0, fontSize: 13 }}>
              No cycles yet — create one in Settings → Cycles first.
            </p>
          ) : (
            <select
              className="cd-um-select"
              value={cycleId}
              onChange={e => setCycleId(e.target.value)}
              disabled={isEdit}
            >
              <option value="">Select a cycle…</option>
              {cycles.map(c => {
                const pt = c.period_type ?? 'quarter'
                const pn = c.period_number ?? c.quarter
                const tag = pt === 'year' ? 'Year' : pt === 'half' ? `H${pn}` : `Q${pn}`
                return (
                  <option key={c.id} value={c.id}>[{tag}] {c.label}</option>
                )
              })}
            </select>
          )}
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Unit */}
          <label className="cd-field">
            <span className="cd-field-lbl">Team / Unit</span>
            <select
              className="cd-um-select"
              value={unitId}
              onChange={e => setUnitId(e.target.value)}
            >
              <option value="">No unit</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>

          {/* Status */}
          <label className="cd-field">
            <span className="cd-field-lbl">Status</span>
            <select
              className="cd-um-select"
              value={status}
              onChange={e => setStatus(e.target.value as ObjectiveStatus)}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Parent objective */}
        {parentOpts.length > 0 && (
          <label className="cd-field">
            <span className="cd-field-lbl">Align to parent objective <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(optional)</span></span>
            <select
              className="cd-um-select"
              value={parentId}
              onChange={e => setParentId(e.target.value)}
            >
              <option value="">No parent (top-level)</option>
              {parentOpts.map(o => (
                <option key={o.id} value={o.id}>{o.title}</option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cd-btn cd-btn-primary" disabled={loading || noCycles}>
            {loading
              ? 'Saving…'
              : isEdit
              ? 'Save changes'
              : checkedCount > 0
              ? `Create with ${checkedCount} KR${checkedCount !== 1 ? 's' : ''}`
              : 'Create objective'}
          </button>
        </div>
      </form>

      <TemplatePicker
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        onSelect={handleTemplateSelect}
      />
    </CdModal>
  )
}
