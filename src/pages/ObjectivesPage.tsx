import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCycle } from '../context/CycleContext'
import { useOrg } from '../context/OrgContext'
import { useCadenceObjectives } from '../hooks/useCadenceObjectives'
import { objectivesService, getChildObjectives } from '../services/objectives.service'
import { keyResultsService } from '../services/keyResults.service'
import { getRelevantUnits } from '../services/relevance.service'
import type { RelevantUnit } from '../services/relevance.service'
import { ObjectiveForm } from '../components/objectives/ObjectiveForm'
import { usePageActionStore } from '../stores/pageActionStore'
import { MyFocusPage } from './MyFocusPage'
import { CascadePage } from './CascadePage'
import { MyContributionPage } from './MyContributionPage'
import { EmptyState } from '../components/cadence/EmptyState'
import { PageHeader } from '../components/cadence/PageHeader'
import { ConfidenceTrend } from '../components/cadence/ConfidenceTrend'
import { StatusChip } from '../components/cadence/StatusChip'
import { LevelBadge } from '../components/cadence/LevelBadge'
import { AlignmentPill } from '../components/cadence/AlignmentPill'
import { Avatar } from '../components/cadence/Avatar'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Segmented } from '../components/cadence/Segmented'
import { Icon } from '../components/cadence/Icon'
import { getQuarterWeeks, getCurrentWeekIdx, fmt, objectiveProgress } from '../lib/cadenceUtils'
import { getErrorMessage } from '../lib/errors'
import type { CreateObjectiveInput } from '../types'
import type { CadenceObjective } from '../types/cadence'
import { usePageTitle } from '../hooks/usePageTitle'

// ── All OKRs tab ──────────────────────────────────────────────────────────
// Shows every objective in the cycle (not just the current user's) with
// level-filter pills, list/cascade toggle, alignment stat, and confidence
// heatmap. Migrated from the former unreachable /okrs route (OKRsPage.tsx).

type ViewMode = 'list' | 'cascade'

interface TreeNode { obj: CadenceObjective; children: TreeNode[]; depth: number }

function buildTree(objectives: CadenceObjective[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const o of objectives) map.set(o.id, { obj: o, children: [], depth: 0 })
  const roots: TreeNode[] = []
  for (const o of objectives) {
    const node = map.get(o.id)!
    if (o.parent_objective_id && map.has(o.parent_objective_id)) {
      map.get(o.parent_objective_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  function setDepth(n: TreeNode, d: number) { n.depth = d; n.children.forEach(c => setDepth(c, d + 1)) }
  roots.forEach(r => setDepth(r, 0))
  return roots
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(ns: TreeNode[]) { for (const n of ns) { result.push(n); walk(n.children) } }
  walk(nodes)
  return result
}

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <span className="cd-delete-confirm" onClick={e => e.stopPropagation()}>
      Delete?
      <button type="button" className="cd-delete-confirm-yes" onClick={onConfirm} title="Confirm delete">✓</button>
      <button type="button" className="cd-delete-confirm-no"  onClick={onCancel}  title="Cancel">✕</button>
    </span>
  )
}

function ObjRow({ obj, weeks, currentWeekIdx, expanded, onToggle, isTopLevel, indentDepth = 0, onDelete }: {
  obj: CadenceObjective; weeks: number[]; currentWeekIdx: number
  expanded: boolean; onToggle: () => void; isTopLevel: boolean
  indentDepth?: number; onDelete?: (id: string) => void
}) {
  const indent = indentDepth * 20
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div id={`obj-${obj.id}`} className="cd-okr-row cd-okr-row--obj cd-row-deletable"
      onClick={onToggle} style={{ '--row-indent': `${indent}px` } as React.CSSProperties}>
      <div className="cd-okr-col-level"><LevelBadge level={obj.level} size="sm" /></div>
      <div className="cd-okr-col-title" style={{ paddingLeft: indent }}>
        <button className="cd-okr-expand" type="button" aria-label="Toggle KRs"
          onClick={e => { e.stopPropagation(); onToggle() }}>
          <Icon name={expanded ? 'chevron' : 'chevronR'} size={13} />
        </button>
        <span className="cd-okr-obj-title">{obj.title}</span>
        {onDelete && (confirmDelete
          ? <DeleteConfirm onConfirm={() => onDelete(obj.id)} onCancel={() => setConfirmDelete(false)} />
          : <button type="button" className="cd-row-delete-btn" title="Delete objective"
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}>
              <Icon name="trash" size={13} />
            </button>
        )}
      </div>
      <div className="cd-okr-col-supports">
        <AlignmentPill parent={obj.parent_objective ?? null} required={!isTopLevel}
          onNavigate={id => document.getElementById(`obj-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
      </div>
      <div className="cd-okr-col-owner"><Avatar person={obj.owner ?? null} size={22} /></div>
      <div className="cd-okr-col-status"><StatusChip status={obj.status} size="sm" /></div>
      <div className="cd-okr-col-progress">
        <ProgressBar value={obj.progress} height={5} />
        <span className="cd-okr-pct">{fmt(obj.progress * 100)}%</span>
      </div>
      <div className="cd-okr-conf-row">
        <ConfidenceTrend values={obj.confidence} currentIdx={currentWeekIdx} weeks={weeks} size={20} />
      </div>
    </div>
  )
}

function KrRow({ kr, weeks, currentWeekIdx, onDelete }: {
  kr: CadenceObjective['key_results'][0]; weeks: number[]
  currentWeekIdx: number; onDelete?: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className="cd-okr-row cd-okr-row--kr cd-row-deletable">
      <div className="cd-okr-col-level" />
      <div className="cd-okr-col-title">
        <span className="cd-okr-kr-indent" />
        <span className="cd-okr-kr-title">{kr.title}</span>
        {onDelete && (confirmDelete
          ? <DeleteConfirm onConfirm={() => onDelete(kr.id)} onCancel={() => setConfirmDelete(false)} />
          : <button type="button" className="cd-row-delete-btn" title="Delete key result"
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}>
              <Icon name="trash" size={12} />
            </button>
        )}
      </div>
      <div className="cd-okr-col-supports" />
      <div className="cd-okr-col-owner"><Avatar person={kr.owner ?? null} size={18} /></div>
      <div className="cd-okr-col-status" />
      <div className="cd-okr-col-progress">
        {kr.target_type !== 'boolean' ? (
          <>
            <ProgressBar value={Math.min(1, kr.current_value / (kr.target_value || 1))} height={4} />
            <span className="cd-okr-pct">{fmt(kr.current_value)}{kr.unit ?? ''} / {fmt(kr.target_value)}{kr.unit ?? ''}</span>
          </>
        ) : <span className="cd-okr-pct">{kr.current_value ? 'Done' : 'Not done'}</span>}
      </div>
      <div className="cd-okr-conf-row">
        <ConfidenceTrend values={kr.confidence} currentIdx={currentWeekIdx} weeks={weeks} size={18} />
      </div>
    </div>
  )
}

function AlignmentStat({ objectives }: { objectives: CadenceObjective[] }) {
  const needParent = objectives.filter(o => (o.level?.depth ?? 0) > 0)
  const aligned = needParent.filter(o => o.parent_objective_id)
  const pct = needParent.length === 0 ? 100 : Math.round((aligned.length / needParent.length) * 100)
  const unlinked = needParent.length - aligned.length
  return (
    <div className="cd-align-stat">
      <div className="cd-align-stat-top">
        <span className="cd-align-stat-label">Alignment coverage</span>
        <span className="cd-align-stat-pct" style={{ color: pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)' }}>{pct}%</span>
      </div>
      <div className="cd-align-stat-detail">
        {aligned.length} / {needParent.length} objectives linked
        {unlinked > 0 && <span className="cd-align-stat-warn"> · {unlinked} unlinked</span>}
      </div>
      <ProgressBar value={pct / 100} height={4}
        color={pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'} />
    </div>
  )
}

function AllOKRsTab() {
  const { activeCycle } = useCycle()
  const { levels } = useOrg()
  const { setObjectivesModalOpen } = usePageActionStore()
  const quarter = activeCycle?.quarter ?? 1
  const year = activeCycle?.year ?? new Date().getFullYear()

  const { objectives, loading, error, setObjectives } = useCadenceObjectives(activeCycle?.id ?? null, quarter, year)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [levelFilter, setLevelFilter] = useState<string | null>(null)

  async function handleDeleteObj(id: string) {
    await objectivesService.delete(id)
    setObjectives(prev => prev.filter(o => o.id !== id))
  }

  async function handleDeleteKr(objId: string, krId: string) {
    await keyResultsService.delete(krId)
    setObjectives(prev => prev.map(o =>
      o.id === objId ? { ...o, key_results: o.key_results.filter(k => k.id !== krId) } : o
    ))
  }

  const weeks = getQuarterWeeks(quarter)
  const currentWeekIdx = activeCycle?.start_date
    ? Math.max(0, Math.min(Math.floor((Date.now() - new Date(activeCycle.start_date).getTime()) / (7 * 86400000)), weeks.length - 1))
    : getCurrentWeekIdx(quarter)

  function toggleExpand(id: string) {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const filteredObjectives = levelFilter
    ? objectives.filter(o => o.level?.id === levelFilter || o.level_id === levelFilter)
    : objectives

  const cascadeTree = useMemo(() => buildTree(objectives), [objectives])
  const flatCascade = useMemo(() => flattenTree(cascadeTree), [cascadeTree])
  const displayRows = viewMode === 'cascade' ? flatCascade : filteredObjectives.map(o => ({ obj: o, depth: 0, children: [] }))

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading objectives…</p></div>
  if (error) return <div className="cd-page"><p style={{ color: 'var(--bad)', padding: '16px 0' }}>{error}</p></div>

  return (
    <div className="cd-page">
      <PageHeader title="All OKRs" sub={activeCycle?.label}
        actions={
          <Segmented<ViewMode>
            options={[{ value: 'list', label: 'List' }, { value: 'cascade', label: 'Cascade' }]}
            value={viewMode} onChange={setViewMode}
          />
        }
      />

      {objectives.length > 0 && levels.length > 1 && <AlignmentStat objectives={objectives} />}

      {viewMode === 'list' && levels.length > 0 && (
        <div className="cd-okr-filters">
          <button type="button" className={'cd-okr-level-filter' + (!levelFilter ? ' is-on' : '')}
            onClick={() => setLevelFilter(null)}>All</button>
          {levels.map(l => (
            <button key={l.id} type="button"
              className={'cd-okr-level-filter' + (levelFilter === l.id ? ' is-on' : '')}
              style={{ '--lf-color': l.color } as React.CSSProperties}
              onClick={() => setLevelFilter(levelFilter === l.id ? null : l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      <div className="cd-okr-table">
        <div className="cd-okr-header">
          <span className="cd-okr-col-level">Level</span>
          <span className="cd-okr-col-title">Objective / Key Result</span>
          <span className="cd-okr-col-supports">Supports</span>
          <span className="cd-okr-col-owner">Owner</span>
          <span className="cd-okr-col-status">Status</span>
          <span className="cd-okr-col-progress">Progress</span>
          <div className="cd-okr-conf-header">
            {weeks.map((w, i) => (
              <span key={w} className={'cd-okr-week' + (i === currentWeekIdx ? ' is-current' : '')}>W{i + 1}</span>
            ))}
          </div>
        </div>

        {displayRows.length === 0 && (
          levelFilter
            ? <EmptyState icon="filter" title="No objectives at this level" />
            : <EmptyState icon="target"
                title={`No objectives for ${activeCycle?.label ?? 'this cycle'} yet`}
                description="Create your first objective and add key results to start tracking."
                action={{ label: 'Add objective', onClick: () => setObjectivesModalOpen(true) }}
              />
        )}

        {displayRows.map(({ obj, depth }) => {
          const isExpanded = expanded.has(obj.id)
          return (
            <div key={obj.id} className="cd-okr-obj-block">
              <ObjRow obj={obj} weeks={weeks} currentWeekIdx={currentWeekIdx}
                expanded={isExpanded} onToggle={() => toggleExpand(obj.id)}
                isTopLevel={!obj.parent_objective_id}
                indentDepth={viewMode === 'cascade' ? depth : 0}
                onDelete={handleDeleteObj}
              />
              {isExpanded && obj.key_results.length > 0 && obj.key_results.map(kr => (
                <KrRow key={kr.id} kr={kr} weeks={weeks} currentWeekIdx={currentWeekIdx}
                  onDelete={(krId) => handleDeleteKr(obj.id, krId)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Waterfall tab ─────────────────────────────────────────────────────────
// Shows a selected objective at the root, then for every unit tagged as
// relevant (via objective_relevant_units) shows either the child objective
// that unit has aligned to this one, or a "Not yet aligned" gap indicator.
// Recurses up to MAX_WATERFALL_DEPTH levels deep (matching useCascadeChain).

const MAX_WATERFALL_DEPTH = 6

interface WaterfallSectionProps {
  objectiveId: string
  depth: number
}

function WaterfallSection({ objectiveId, depth }: WaterfallSectionProps) {
  const [loading, setLoading] = useState(true)
  const [relevantUnits, setRelevantUnits] = useState<RelevantUnit[]>([])
  const [children, setChildren] = useState<CadenceObjective[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getRelevantUnits(objectiveId),
      getChildObjectives(objectiveId),
    ])
      .then(([units, childObjs]) => {
        setRelevantUnits(units)
        setChildren(childObjs as CadenceObjective[])
      })
      .catch(err => setError(getErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [objectiveId])

  if (loading) {
    return <div className="cd-wf-loading">Loading…</div>
  }
  if (error) {
    return <div className="cd-wf-error">{error}</div>
  }
  if (relevantUnits.length === 0) {
    if (depth === 0) {
      return (
        <div className="cd-wf-no-units">
          <Icon name="sitemap" size={20} />
          <p>No units marked as relevant to this objective.</p>
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
            Edit the objective and use "Relevant to" to tag which units are expected to align.
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="cd-wf-section">
      {relevantUnits.map(ru => {
        const aligned = children.find(c => c.unit_id === ru.unit_id) ?? null
        const progress = aligned ? objectiveProgress(aligned.key_results ?? []) : 0

        return (
          <div key={ru.id} className="cd-wf-unit-block">
            <div className="cd-wf-unit-label">
              <span className="cd-wf-unit-dot" />
              <span className="cd-wf-unit-name">{ru.unit.name}</span>
            </div>

            {aligned ? (
              <div className="cd-wf-aligned">
                <div className="cd-wf-obj-header">
                  <StatusChip status={aligned.status as any} size="sm" />
                  <span className="cd-wf-obj-title">{aligned.title}</span>
                </div>
                <div className="cd-wf-progress-row">
                  <ProgressBar value={progress} height={4} />
                  <span className="cd-wf-pct">{Math.round(progress * 100)}%</span>
                </div>
                {depth < MAX_WATERFALL_DEPTH - 1 && (
                  <WaterfallSection objectiveId={aligned.id} depth={depth + 1} />
                )}
              </div>
            ) : (
              <div className="cd-wf-gap">
                <span className="cd-wf-gap-badge">
                  <Icon name="alertTriangle" size={11} />
                  Not yet aligned
                </span>
                <span className="cd-wf-gap-hint">
                  No objective from {ru.unit.name} is aligned to this one yet
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WaterfallTab() {
  const { activeCycle } = useCycle()
  const quarter = activeCycle?.quarter ?? 1
  const year = activeCycle?.year ?? new Date().getFullYear()
  const { objectives, loading } = useCadenceObjectives(activeCycle?.id ?? null, quarter, year)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const topLevel = objectives.filter(o => !o.parent_objective_id)
  const other    = objectives.filter(o => !!o.parent_objective_id)

  // Default to first top-level objective once loaded
  useEffect(() => {
    if (!selectedId && topLevel.length > 0) {
      setSelectedId(topLevel[0].id)
    }
  }, [topLevel.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedObj = objectives.find(o => o.id === selectedId) ?? null

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading objectives…</p></div>

  return (
    <div className="cd-page">
      <PageHeader
        title="Waterfall"
        sub={activeCycle?.label}
      />

      {objectives.length === 0 ? (
        <EmptyState icon="target"
          title={`No objectives for ${activeCycle?.label ?? 'this cycle'} yet`}
          description="Create objectives first, then mark which units are relevant to see the waterfall."
        />
      ) : (
        <>
          {/* Objective picker */}
          <div className="cd-wf-picker">
            <label className="cd-wf-picker-label">Waterfall from</label>
            <select
              className="cd-um-select"
              style={{ maxWidth: 420 }}
              value={selectedId ?? ''}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">Choose an objective…</option>
              {topLevel.length > 0 && (
                <optgroup label="Top-level objectives">
                  {topLevel.map(o => (
                    <option key={o.id} value={o.id}>{o.title}</option>
                  ))}
                </optgroup>
              )}
              {other.length > 0 && (
                <optgroup label="Child objectives">
                  {other.map(o => (
                    <option key={o.id} value={o.id}>{o.title}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {selectedObj && (
            <div className="cd-wf-root">
              {/* Root objective */}
              <div className="cd-wf-root-card">
                <div className="cd-wf-root-eyebrow">
                  {selectedObj.level?.name ?? 'Objective'}
                </div>
                <div className="cd-wf-root-title">{selectedObj.title}</div>
                <div className="cd-wf-root-meta">
                  <Avatar person={selectedObj.owner ?? null} size={18} />
                  <span>{selectedObj.owner?.name ?? '—'}</span>
                  <StatusChip status={selectedObj.status as any} size="sm" />
                </div>
              </div>

              {/* Recursive waterfall */}
              <WaterfallSection objectiveId={selectedObj.id} depth={0} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'my-okrs',   label: 'My OKRs'   },
  { id: 'all-okrs',  label: 'All OKRs'  },
  { id: 'cascade',   label: 'Cascade'   },
  { id: 'alignment', label: 'Alignment' },
  { id: 'waterfall', label: 'Waterfall' },
]

export function ObjectivesPage() {
  usePageTitle('Objectives')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'my-okrs'
  const { user } = useAuth()
  const { objectivesModalOpen, setObjectivesModalOpen } = usePageActionStore()
  const [refreshKey, setRefreshKey] = useState(0)

  function setTab(id: string) {
    setParams({ tab: id }, { replace: true })
  }

  async function handleCreate(data: CreateObjectiveInput) {
    if (!user) return
    const obj = await objectivesService.create({ ...data, owner_id: user.id })
    setRefreshKey(k => k + 1)
    return obj.id
  }

  return (
    <>
      <div className="cd-tabs">
        {TABS.map(t => (
          <button key={t.id} type="button"
            className={'cd-tab-btn' + (tab === t.id ? ' is-on' : '')}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="cd-tab-content">
        {tab === 'my-okrs'   && <MyFocusPage key={refreshKey} />}
        {tab === 'all-okrs'  && <AllOKRsTab key={refreshKey} />}
        {tab === 'cascade'   && <CascadePage />}
        {tab === 'alignment' && <MyContributionPage />}
        {tab === 'waterfall' && <WaterfallTab />}
      </div>

      <ObjectiveForm
        open={objectivesModalOpen}
        onClose={() => setObjectivesModalOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  )
}
