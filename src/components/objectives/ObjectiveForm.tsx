import { useState, useEffect } from 'react'
import { CdModal } from '../cadence/CdModal'
import { Icon } from '../cadence/Icon'
import { TemplatePicker } from './TemplatePicker'
import { useCycle } from '../../context/CycleContext'
import { supabase } from '../../lib/supabase'
import { keyResultsService } from '../../services/keyResults.service'
import { suggestKRs, type KRSuggestion } from '../../services/aiSuggestions.service'
import type { OKRTemplate } from '../../data/okrTemplates'
import type { Objective, CreateObjectiveInput, ObjectiveStatus } from '../../types'

const STATUS_OPTIONS: { value: ObjectiveStatus; label: string }[] = [
  { value: 'on_track',  label: 'On Track'  },
  { value: 'at_risk',   label: 'At Risk'   },
  { value: 'behind',    label: 'Behind'    },
  { value: 'completed', label: 'Completed' },
]

interface ObjOption { id: string; title: string }
interface UnitOption { id: string; name: string }

interface ObjectiveFormProps {
  open: boolean
  onClose: () => void
  /** Return the new objective's id (string) for new objectives so AI KRs can be created. */
  onSubmit: (data: CreateObjectiveInput) => Promise<string | void>
  objective?: Objective | null
}

export function ObjectiveForm({ open, onClose, onSubmit, objective }: ObjectiveFormProps) {
  const { activeCycle } = useCycle()
  const isEdit = !!objective

  const [title, setTitle]               = useState(objective?.title ?? '')
  const [description, setDescription]   = useState(objective?.description ?? '')
  const [unitId, setUnitId]             = useState<string>(objective?.unit_id ?? '')
  const [parentId, setParentId]         = useState<string>((objective as any)?.parent_objective_id ?? '')
  const [status, setStatus]             = useState<ObjectiveStatus>(objective?.status ?? 'on_track')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  const [units, setUnits]               = useState<UnitOption[]>([])
  const [parentOpts, setParentOpts]     = useState<ObjOption[]>([])

  // KR suggestions (AI or template)
  const [suggestions, setSuggestions]   = useState<KRSuggestion[]>([])
  const [accepted, setAccepted]         = useState<Set<number>>(new Set())
  const [aiLoading, setAiLoading]       = useState(false)
  const [aiError, setAiError]           = useState('')
  const [tplOpen, setTplOpen]           = useState(false)

  useEffect(() => {
    if (!open) return
    supabase.from('units').select('id, name').order('name').then(({ data }) => {
      setUnits((data ?? []) as UnitOption[])
    })
    if (activeCycle?.id) {
      supabase
        .from('objectives')
        .select('id, title')
        .eq('cycle_id', activeCycle.id)
        .order('title')
        .then(({ data }) => {
          const opts = ((data ?? []) as ObjOption[]).filter(o => o.id !== objective?.id)
          setParentOpts(opts)
        })
    }
  }, [open, activeCycle?.id, objective?.id])

  useEffect(() => {
    setTitle(objective?.title ?? '')
    setDescription(objective?.description ?? '')
    setUnitId(objective?.unit_id ?? '')
    setParentId((objective as any)?.parent_objective_id ?? '')
    setStatus(objective?.status ?? 'on_track')
    setError('')
    setSuggestions([])
    setAccepted(new Set())
    setAiError('')
  }, [objective])

  async function handleSuggest() {
    if (title.trim().length < 4) return
    setAiLoading(true)
    setAiError('')
    setSuggestions([])
    try {
      const results = await suggestKRs(title.trim())
      setSuggestions(results)
      setAccepted(new Set()) // unchecked by default — user opts in
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Couldn't generate suggestions — add key results manually")
    } finally {
      setAiLoading(false)
    }
  }

  function handleTemplateSelect(tpl: OKRTemplate) {
    setTitle(tpl.title)
    setSuggestions(tpl.krs)
    setAccepted(new Set(tpl.krs.map((_, i) => i)))
    setAiError('')
  }

  function toggleAccepted(i: number) {
    setAccepted(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!activeCycle) { setError('No active cycle selected'); return }
    setLoading(true)
    setError('')
    try {
      const objectiveId = await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        unit_id: unitId || null,
        parent_objective_id: parentId || null,
        cycle_id: activeCycle.id,
        status,
      })

      // Create accepted AI suggestions as KRs if we got back the objective ID
      if (typeof objectiveId === 'string' && accepted.size > 0) {
        const toCreate = suggestions.filter((_, i) => accepted.has(i))
        await Promise.all(
          toCreate.map(s =>
            keyResultsService.create({
              objective_id: objectiveId,
              title: s.title,
              target_type: s.target_type,
              target_value: s.target_value,
              unit: s.unit,
            })
          )
        )
      }

      onClose()
      if (!isEdit) {
        setTitle(''); setDescription(''); setUnitId(''); setParentId(''); setStatus('on_track')
        setSuggestions([]); setAccepted(new Set()); setAiError('')
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const canSuggest = !isEdit && title.trim().length >= 4

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
                ✦ {aiLoading ? 'Thinking…' : suggestions.length > 0 ? 'Regenerate with AI' : 'Suggest key results with AI'}
              </button>
            )}
          </div>
        )}
        {aiError && (
          <p style={{ fontSize: 12, color: 'var(--bad)', margin: '-8px 0 0' }}>{aiError}</p>
        )}

        {/* KR suggestions panel (from AI or template) */}
        {suggestions.length > 0 && (
          <div className="cd-ai-suggestions">
            <div className="cd-ai-suggestions-header">
              <span>✦</span>
              <span>Select the key results you want to keep, then customise them</span>
            </div>
            <div className="cd-ai-suggestions-list">
              {suggestions.map((s, i) => (
                <label key={i} className={'cd-ai-suggestion-row' + (accepted.has(i) ? ' is-checked' : '')}>
                  <input
                    type="checkbox"
                    checked={accepted.has(i)}
                    onChange={() => toggleAccepted(i)}
                    className="cd-ai-suggestion-chk"
                  />
                  <div className="cd-ai-suggestion-body">
                    <span className="cd-ai-suggestion-title">{s.title}</span>
                    <span className="cd-ai-suggestion-meta">
                      {s.target_type === 'boolean'
                        ? 'Done / not done'
                        : s.target_type === 'percentage'
                        ? `${s.target_value}%`
                        : `${s.target_value.toLocaleString()}${s.unit ? ' ' + s.unit : ''}`}
                    </span>
                  </div>
                </label>
              ))}
            </div>
            {accepted.size === 0 && (
              <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '6px 0 0' }}>
                No key results selected — objective will be created without KRs.
              </p>
            )}
          </div>
        )}

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

        {/* Cycle hint */}
        {activeCycle && (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }}>
            Cycle: <strong style={{ color: 'var(--ink-mid)' }}>{activeCycle.label}</strong>
          </p>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="cd-btn cd-btn-primary" disabled={loading}>
            {loading
              ? 'Saving…'
              : isEdit
              ? 'Save changes'
              : accepted.size > 0
              ? `Create with ${accepted.size} KR${accepted.size !== 1 ? 's' : ''}`
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
