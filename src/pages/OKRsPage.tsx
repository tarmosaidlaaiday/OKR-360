import { useState, useMemo } from 'react'
import { useCycle } from '../context/CycleContext'
import { useCadenceObjectives } from '../hooks/useCadenceObjectives'
import { useOrg } from '../context/OrgContext'
import { usePageActionStore } from '../stores/pageActionStore'
import { PageHeader } from '../components/cadence/PageHeader'
import { ConfidenceTrend } from '../components/cadence/ConfidenceTrend'
import { StatusChip } from '../components/cadence/StatusChip'
import { LevelBadge } from '../components/cadence/LevelBadge'
import { AlignmentPill } from '../components/cadence/AlignmentPill'
import { Avatar } from '../components/cadence/Avatar'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Segmented } from '../components/cadence/Segmented'
import { Icon } from '../components/cadence/Icon'
import { getQuarterWeeks, getCurrentWeekIdx, fmt } from '../lib/cadenceUtils'
import type { CadenceObjective } from '../types/cadence'

type ViewMode = 'list' | 'cascade'

// ── Cascade tree builder ──────────────────────────────────────────────────

interface TreeNode {
  obj: CadenceObjective
  children: TreeNode[]
  depth: number
}

function buildTree(objectives: CadenceObjective[]): TreeNode[] {
  const roots: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  // Create all nodes
  for (const o of objectives) {
    nodeMap.set(o.id, { obj: o, children: [], depth: 0 })
  }

  // Wire parent→child
  for (const o of objectives) {
    const node = nodeMap.get(o.id)!
    if (o.parent_objective_id && nodeMap.has(o.parent_objective_id)) {
      nodeMap.get(o.parent_objective_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Set depths
  function setDepth(node: TreeNode, d: number) {
    node.depth = d
    node.children.forEach(c => setDepth(c, d + 1))
  }
  roots.forEach(r => setDepth(r, 0))

  return roots
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      result.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return result
}

// ── Shared row props ──────────────────────────────────────────────────────

interface ObjRowProps {
  obj: CadenceObjective
  weeks: number[]
  currentWeekIdx: number
  expanded: boolean
  onToggle: () => void
  isTopLevel: boolean // for "Supports" warning
  indentDepth?: number  // cascade mode indent
}

function ObjRow({ obj, weeks, currentWeekIdx, expanded, onToggle, isTopLevel, indentDepth = 0 }: ObjRowProps) {
  const indent = indentDepth * 20

  function scrollToObj(id: string) {
    document.getElementById(`obj-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div
      id={`obj-${obj.id}`}
      className="cd-okr-row cd-okr-row--obj"
      onClick={onToggle}
      style={{ '--row-indent': `${indent}px` } as React.CSSProperties}
    >
      {/* Level badge */}
      <div className="cd-okr-col-level">
        <LevelBadge level={obj.level} size="sm" />
      </div>

      {/* Title */}
      <div className="cd-okr-col-title" style={{ paddingLeft: indent }}>
        <button className="cd-okr-expand" type="button" aria-label="Toggle KRs" onClick={e => { e.stopPropagation(); onToggle() }}>
          <Icon name={expanded ? 'chevron' : 'chevronR'} size={13} />
        </button>
        <span className="cd-okr-obj-title">{obj.title}</span>
      </div>

      {/* Supports */}
      <div className="cd-okr-col-supports">
        <AlignmentPill
          parent={obj.parent_objective ?? null}
          required={!isTopLevel}
          onNavigate={scrollToObj}
        />
      </div>

      {/* Owner */}
      <div className="cd-okr-col-owner">
        <Avatar person={obj.owner ?? null} size={22} />
      </div>

      {/* Status */}
      <div className="cd-okr-col-status">
        <StatusChip status={obj.status} size="sm" />
      </div>

      {/* Progress */}
      <div className="cd-okr-col-progress">
        <ProgressBar value={obj.progress} height={5} />
        <span className="cd-okr-pct">{fmt(obj.progress * 100)}%</span>
      </div>

      {/* Confidence heatmap */}
      <div className="cd-okr-conf-row">
        <ConfidenceTrend
          values={obj.confidence}
          currentIdx={currentWeekIdx}
          weeks={weeks}
          size={20}
        />
      </div>
    </div>
  )
}

function KrRows({ obj, weeks, currentWeekIdx }: { obj: CadenceObjective; weeks: number[]; currentWeekIdx: number }) {
  return (
    <>
      {obj.key_results.map(kr => (
        <div key={kr.id} className="cd-okr-row cd-okr-row--kr">
          <div className="cd-okr-col-level" />
          <div className="cd-okr-col-title">
            <span className="cd-okr-kr-indent" />
            <span className="cd-okr-kr-title">{kr.title}</span>
          </div>
          <div className="cd-okr-col-supports" />
          <div className="cd-okr-col-owner">
            <Avatar person={kr.owner ?? null} size={18} />
          </div>
          <div className="cd-okr-col-status" />
          <div className="cd-okr-col-progress">
            {kr.target_type !== 'boolean' ? (
              <>
                <ProgressBar value={Math.min(1, kr.current_value / (kr.target_value || 1))} height={4} />
                <span className="cd-okr-pct">
                  {fmt(kr.current_value)}{kr.unit ?? ''} / {fmt(kr.target_value)}{kr.unit ?? ''}
                </span>
              </>
            ) : (
              <span className="cd-okr-pct">{kr.current_value ? 'Done' : 'Not done'}</span>
            )}
          </div>
          <div className="cd-okr-conf-row">
            <ConfidenceTrend
              values={kr.confidence}
              currentIdx={currentWeekIdx}
              weeks={weeks}
              size={18}
            />
          </div>
        </div>
      ))}
    </>
  )
}

// ── Alignment coverage stat ───────────────────────────────────────────────

function AlignmentStat({ objectives }: { objectives: CadenceObjective[] }) {
  const needParent = objectives.filter(o => {
    const d = o.level?.depth ?? 0
    return d > 0  // anything below top level should have a parent
  })
  const aligned = needParent.filter(o => o.parent_objective_id)
  const pct = needParent.length === 0 ? 100 : Math.round((aligned.length / needParent.length) * 100)
  const unlinked = needParent.length - aligned.length

  return (
    <div className="cd-align-stat">
      <div className="cd-align-stat-top">
        <span className="cd-align-stat-label">Alignment coverage</span>
        <span className="cd-align-stat-pct" style={{ color: pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)' }}>
          {pct}%
        </span>
      </div>
      <div className="cd-align-stat-detail">
        {aligned.length} / {needParent.length} objectives linked
        {unlinked > 0 && (
          <span className="cd-align-stat-warn"> · {unlinked} unlinked</span>
        )}
      </div>
      <ProgressBar
        value={pct / 100}
        height={4}
        color={pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'}
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function OKRsPage() {
  const { activeCycle } = useCycle()
  const quarter = activeCycle?.quarter ?? 1
  const year = activeCycle?.year ?? new Date().getFullYear()

  const { objectives, loading } = useCadenceObjectives(activeCycle?.id ?? null, quarter, year)
  const { levels } = useOrg()

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const { setObjectivesModalOpen } = usePageActionStore()

  const weeks = getQuarterWeeks(quarter)

  // Cycle-relative current week index: days since cycle start ÷ 7
  const currentWeekIdx = activeCycle?.start_date
    ? Math.max(0, Math.min(
        Math.floor((Date.now() - new Date(activeCycle.start_date).getTime()) / (7 * 86400000)),
        weeks.length - 1
      ))
    : getCurrentWeekIdx(quarter)

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }


  const filteredObjectives = levelFilter
    ? objectives.filter(o => o.level?.id === levelFilter || o.level_id === levelFilter)
    : objectives

  const cascadeTree = useMemo(() => buildTree(objectives), [objectives])
  const flatCascade = useMemo(() => flattenTree(cascadeTree), [cascadeTree])

  const displayRows = viewMode === 'cascade' ? flatCascade : filteredObjectives.map(o => ({ obj: o, depth: 0, children: [] }))

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading objectives…</p></div>

  return (
    <div className="cd-page">
      <PageHeader
        title="OKRs"
        sub={activeCycle?.label}
        actions={
          <Segmented<ViewMode>
            options={[
              { value: 'list', label: 'List' },
              { value: 'cascade', label: 'Cascade' },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />
        }
      />

      {/* Alignment coverage */}
      {objectives.length > 0 && levels.length > 1 && (
        <AlignmentStat objectives={objectives} />
      )}

      {/* Level filter (list mode only) */}
      {viewMode === 'list' && levels.length > 0 && (
        <div className="cd-okr-filters">
          <button
            type="button"
            className={'cd-okr-level-filter' + (!levelFilter ? ' is-on' : '')}
            onClick={() => setLevelFilter(null)}
          >
            All
          </button>
          {levels.map(l => (
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

      {/* Table */}
      <div className="cd-okr-table">
        {/* Header */}
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
          levelFilter ? (
            <p className="cd-empty-hint" style={{ padding: '2rem' }}>No objectives at this level.</p>
          ) : (
            <div className="cd-okr-empty">
              <Icon name="target" size={32} />
              <p className="cd-okr-empty-title">No objectives for {activeCycle?.label ?? 'this cycle'} yet</p>
              <p className="cd-okr-empty-sub">Create your first objective and add key results to start tracking your progress this quarter.</p>
              <button
                type="button"
                className="cd-btn cd-btn--primary"
                onClick={() => setObjectivesModalOpen(true)}
              >
                ✦ Add objective with AI →
              </button>
            </div>
          )
        )}

        {displayRows.map(({ obj, depth }) => {
          const isExpanded = expanded.has(obj.id)
          const isTopLevel = !obj.parent_objective_id

          return (
            <div key={obj.id} className="cd-okr-obj-block">
              <ObjRow
                obj={obj}
                weeks={weeks}
                currentWeekIdx={currentWeekIdx}
                expanded={isExpanded}
                onToggle={() => toggleExpand(obj.id)}
                isTopLevel={isTopLevel}
                indentDepth={viewMode === 'cascade' ? depth : 0}
              />
              {isExpanded && obj.key_results.length > 0 && (
                <KrRows obj={obj} weeks={weeks} currentWeekIdx={currentWeekIdx} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
