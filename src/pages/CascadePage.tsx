import { useState, useMemo, useRef, useEffect } from 'react'
import { useCadenceObjectives } from '../hooks/useCadenceObjectives'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import { Avatar } from '../components/cadence/Avatar'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Sparkline } from '../components/cadence/Sparkline'
import { Icon } from '../components/cadence/Icon'
import { profileToPerson } from '../lib/cadenceUtils'
import { getRelevantUnitsForObjectives } from '../services/relevance.service'
import type { RelevantUnit } from '../services/relevance.service'
import type { CadenceObjective } from '../types/cadence'

// ── Constants ─────────────────────────────────────────────────────────────

const NODE_W = 172
const NODE_H = 92
const H_GAP  = 24
const V_GAP  = 108
const PAD    = 48

// ── Tree building ─────────────────────────────────────────────────────────

interface TreeNode {
  obj: CadenceObjective
  children: TreeNode[]
}

function buildTree(objectives: CadenceObjective[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const obj of objectives) byId.set(obj.id, { obj, children: [] })

  const roots: TreeNode[] = []
  for (const obj of objectives) {
    const node = byId.get(obj.id)!
    if (obj.parent_objective_id && byId.has(obj.parent_objective_id)) {
      byId.get(obj.parent_objective_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ── Leaf-first layout ─────────────────────────────────────────────────────

interface NodePos { x: number; y: number; depth: number }

function computeLayout(roots: TreeNode[]): Map<string, NodePos> {
  let leafIdx = 0
  const prelim = new Map<string, number>()
  const depthMap = new Map<string, number>()

  function assignX(node: TreeNode, depth: number): void {
    depthMap.set(node.obj.id, depth)
    if (node.children.length === 0) {
      prelim.set(node.obj.id, leafIdx++)
    } else {
      node.children.forEach(c => assignX(c, depth + 1))
      const xs = node.children.map(c => prelim.get(c.obj.id)!)
      prelim.set(node.obj.id, (Math.min(...xs) + Math.max(...xs)) / 2)
    }
  }
  roots.forEach(r => assignX(r, 0))

  const positions = new Map<string, NodePos>()
  prelim.forEach((px, id) => {
    const depth = depthMap.get(id) ?? 0
    positions.set(id, {
      x: PAD + px * (NODE_W + H_GAP),
      y: PAD + depth * (NODE_H + V_GAP),
      depth,
    })
  })
  return positions
}

// ── Ancestor / descendant sets ────────────────────────────────────────────

function getAncestors(id: string, byId: Map<string, CadenceObjective>): Set<string> {
  const result = new Set<string>()
  let cur = byId.get(id)
  while (cur?.parent_objective_id) {
    result.add(cur.parent_objective_id)
    cur = byId.get(cur.parent_objective_id)
  }
  return result
}

function getDescendants(id: string, childrenMap: Map<string, string[]>): Set<string> {
  const result = new Set<string>()
  const queue = childrenMap.get(id) ?? []
  while (queue.length) {
    const next = queue.shift()!
    result.add(next)
    ;(childrenMap.get(next) ?? []).forEach(c => queue.push(c))
  }
  return result
}

// ── Node card ─────────────────────────────────────────────────────────────

function CascadeNodeCard({
  obj,
  isSelected,
  isHighlighted,
  isDimmed,
  isGap,
  relevanceGapCount,
  onClick,
}: {
  obj: CadenceObjective
  isSelected: boolean
  isHighlighted: boolean
  isDimmed: boolean
  isGap: boolean
  relevanceGapCount: number
  onClick: () => void
}) {
  const lastConf = [...obj.confidence].reverse().find(v => v != null) ?? null
  const owner = obj.owner
    ? profileToPerson(obj.owner as any)
    : null

  return (
    <div
      className={
        'cd-csc-node' +
        (isSelected ? ' is-selected' : '') +
        (isHighlighted ? ' is-hl' : '') +
        (isDimmed ? ' is-dimmed' : '') +
        (isGap ? ' is-gap' : '')
      }
      style={{
        width: NODE_W,
        height: NODE_H,
        position: 'absolute',
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* Level accent bar */}
      {obj.level && (
        <div
          className="cd-csc-accent"
          style={{ background: obj.level.color }}
        />
      )}

      <div className="cd-csc-node-body">
        {obj.level && (
          <div className="cd-csc-level-badge" style={{ color: obj.level.color }}>
            {obj.level.name}
          </div>
        )}
        <div className="cd-csc-title" title={obj.title}>{obj.title}</div>
        <div className="cd-csc-footer">
          <ProgressBar value={obj.progress} height={3} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <Avatar person={owner} size={16} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {lastConf != null && <ConfidenceCell value={lastConf} size={18} />}
              {relevanceGapCount > 0 && (
                <span
                  title={`${relevanceGapCount} unit${relevanceGapCount !== 1 ? 's' : ''} not yet aligned — click for details`}
                  style={{ color: 'var(--warn)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}
                >
                  <Icon name="alertTriangle" size={10} />
                  {relevanceGapCount}
                </span>
              )}
              {isGap && (
                <span title="No parent link" style={{ color: 'var(--bad)', fontSize: 10 }}>
                  <Icon name="alertTriangle" size={11} />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SVG lines ─────────────────────────────────────────────────────────────

function SvgLines({
  objectives,
  positions,
  highlightSet,
  selected,
  canvasW,
  canvasH,
}: {
  objectives: CadenceObjective[]
  positions: Map<string, NodePos>
  highlightSet: Set<string> | null
  selected: string | null
  canvasW: number
  canvasH: number
}) {
  const lines: { parentId: string; childId: string }[] = objectives
    .filter(o => o.parent_objective_id && positions.has(o.parent_objective_id))
    .map(o => ({ parentId: o.parent_objective_id!, childId: o.id }))

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      width={canvasW}
      height={canvasH}
    >
      {lines.map(({ parentId, childId }) => {
        const p = positions.get(parentId)
        const c = positions.get(childId)
        if (!p || !c) return null

        const px = p.x + NODE_W / 2
        const py = p.y + NODE_H
        const cx = c.x + NODE_W / 2
        const cy = c.y
        const my = (py + cy) / 2

        const onPath = !selected || !highlightSet
          ? true
          : (highlightSet.has(parentId) || parentId === selected) &&
            (highlightSet.has(childId)  || childId  === selected)

        return (
          <path
            key={`${parentId}-${childId}`}
            d={`M ${px} ${py} C ${px} ${my} ${cx} ${my} ${cx} ${cy}`}
            fill="none"
            stroke={onPath ? 'var(--accent)' : 'var(--border)'}
            strokeWidth={onPath ? 1.5 : 1}
            opacity={onPath ? 0.8 : 0.3}
          />
        )
      })}
    </svg>
  )
}

// ── List row ──────────────────────────────────────────────────────────────

function ListRow({
  obj,
  isSelected,
  onClick,
}: {
  obj: CadenceObjective
  isSelected: boolean
  onClick: () => void
}) {
  const lastConf = [...obj.confidence].reverse().find(v => v != null) ?? null
  const owner = obj.owner ? profileToPerson(obj.owner as any) : null

  return (
    <div
      className={'cd-csc-list-row' + (isSelected ? ' is-selected' : '')}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {obj.level && (
        <span className="cd-csc-list-level" style={{ background: obj.level.color }} />
      )}
      <div className="cd-csc-list-info">
        <div className="cd-csc-list-title">{obj.title}</div>
        {obj.parent_objective && (
          <div className="cd-csc-list-parent">{obj.parent_objective.title}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <ProgressBar value={obj.progress} height={4} />
        {lastConf != null && <ConfidenceCell value={lastConf} size={20} />}
        <Avatar person={owner} size={20} />
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────

function DetailPanel({
  obj,
  byId,
  childrenMap,
  relevantUnits,
  onClose,
}: {
  obj: CadenceObjective
  byId: Map<string, CadenceObjective>
  childrenMap: Map<string, string[]>
  relevantUnits: RelevantUnit[]
  onClose: () => void
}) {
  // Build breadcrumb chain
  const chain: CadenceObjective[] = []
  let cur: CadenceObjective | undefined = obj
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent_objective_id ? byId.get(cur.parent_objective_id) : undefined
  }

  const confValues = obj.confidence.filter((v): v is number => v != null)
  const lastConf = confValues.at(-1) ?? null
  const owner = obj.owner ? profileToPerson(obj.owner as any) : null

  // Gap detection: which relevant units have no aligned child?
  const childIds = childrenMap.get(obj.id) ?? []
  const childObjs = childIds.map(id => byId.get(id)).filter((c): c is CadenceObjective => !!c)

  return (
    <div className="cd-csc-panel">
      <div className="cd-csc-panel-hd">
        <button type="button" className="cd-btn-icon" onClick={onClose} title="Close">
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Breadcrumb chain */}
      <div className="cd-csc-panel-bc">
        {chain.map((o, i) => (
          <span key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: 'var(--ink-soft)' }}>›</span>}
            <span
              className={o.id === obj.id ? 'cd-csc-bc-cur' : 'cd-csc-bc-anc'}
              style={o.level ? { color: o.level.color } : undefined}
            >
              {o.title}
            </span>
          </span>
        ))}
      </div>

      <div className="cd-csc-panel-body">
        {obj.level && (
          <div className="cd-csc-panel-level" style={{ background: obj.level.color }}>
            {obj.level.name}
          </div>
        )}

        <h3 className="cd-csc-panel-title">{obj.title}</h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Avatar person={owner} size={22} />
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {owner?.name ?? 'Unassigned'}
          </span>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--ink-soft)' }}>Progress</span>
            <span>{Math.round(obj.progress * 100)}%</span>
          </div>
          <ProgressBar value={obj.progress} height={6} />
        </div>

        {/* Confidence */}
        {lastConf != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Confidence</span>
            <ConfidenceCell value={lastConf} size={22} />
          </div>
        )}

        {/* Sparkline */}
        {confValues.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Confidence trend</div>
            <Sparkline values={confValues} width={220} height={36} stroke="var(--accent)" />
          </div>
        )}

        {/* KRs */}
        {obj.key_results.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6 }}>Key results</div>
            {obj.key_results.map(kr => (
              <div key={kr.id} className="cd-csc-panel-kr">
                <div className="cd-csc-panel-kr-title">{kr.title}</div>
                <ProgressBar
                  value={kr.target_value > 0 ? Math.min(1, kr.current_value / kr.target_value) : 0}
                  height={3}
                />
              </div>
            ))}
          </div>
        )}

        {/* Relevant units / alignment gaps */}
        {relevantUnits.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6 }}>
              Relevant units
            </div>
            <div className="cd-wf-section" style={{ gap: 8 }}>
              {relevantUnits.map(ru => {
                const aligned = childObjs.find(c => c.unit_id === ru.unit_id) ?? null
                return (
                  <div key={ru.id} className="cd-wf-unit-block" style={{ padding: '6px 0' }}>
                    <div className="cd-wf-unit-label">
                      <span className="cd-wf-unit-dot" />
                      <span className="cd-wf-unit-name">{ru.unit.name}</span>
                    </div>
                    {aligned ? (
                      <div className="cd-wf-aligned" style={{ marginTop: 4 }}>
                        <div className="cd-wf-obj-header">
                          <span className="cd-wf-obj-title">{aligned.title}</span>
                        </div>
                        <div className="cd-wf-progress-row">
                          <ProgressBar value={aligned.progress} height={3} />
                          <span className="cd-wf-pct">{Math.round(aligned.progress * 100)}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="cd-wf-gap" style={{ marginTop: 4 }}>
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
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'mypath' | 'gaps'
type ViewMode = 'tree' | 'list'

export function CascadePage() {
  const { activeCycle, cycles, setActiveCycle } = useCycle()
  const { user } = useAuth()
  const quarter = activeCycle?.quarter ?? 1
  const year = activeCycle?.year ?? new Date().getFullYear()

  const { objectives, loading } = useCadenceObjectives(activeCycle?.id ?? null, quarter, year)

  const [filter, setFilter] = useState<FilterMode>('all')
  const [view, setView] = useState<ViewMode>('tree')
  const [selected, setSelected] = useState<string | null>(null)
  const [relevantUnitsMap, setRelevantUnitsMap] = useState<Map<string, RelevantUnit[]>>(new Map())

  const canvasRef = useRef<HTMLDivElement>(null)

  // Index by id
  const byId = useMemo(() => {
    const m = new Map<string, CadenceObjective>()
    objectives.forEach(o => m.set(o.id, o))
    return m
  }, [objectives])

  // Children map
  const childrenMap = useMemo(() => {
    const m = new Map<string, string[]>()
    objectives.forEach(o => {
      if (o.parent_objective_id) {
        const arr = m.get(o.parent_objective_id) ?? []
        arr.push(o.id)
        m.set(o.parent_objective_id, arr)
      }
    })
    return m
  }, [objectives])

  // Filtered set of objectives to render
  const filtered = useMemo(() => {
    if (filter === 'all') return objectives

    if (filter === 'mypath') {
      if (!user?.id) return objectives
      const myOwned = new Set(objectives.filter(o => o.owner_id === user.id).map(o => o.id))
      const inPath = new Set<string>()
      myOwned.forEach(id => {
        inPath.add(id)
        getAncestors(id, byId).forEach(a => inPath.add(a))
        getDescendants(id, childrenMap).forEach(d => inPath.add(d))
      })
      return objectives.filter(o => inPath.has(o.id))
    }

    if (filter === 'gaps') {
      // Gaps: objectives that have a level.depth > 0 but no parent link
      const minDepth = Math.min(...objectives.map(o => o.level?.depth ?? 0))
      return objectives.filter(o => {
        const depth = o.level?.depth ?? 0
        return depth > minDepth && !o.parent_objective_id
      })
    }

    return objectives
  }, [objectives, filter, user?.id, byId, childrenMap])

  // Build tree and layout for filtered objectives
  const { positions, canvasW, canvasH } = useMemo(() => {
    const roots = buildTree(filtered)
    const positions = computeLayout(roots)

    let maxX = 0, maxY = 0
    positions.forEach(pos => {
      maxX = Math.max(maxX, pos.x + NODE_W)
      maxY = Math.max(maxY, pos.y + NODE_H)
    })

    return {
      roots,
      positions,
      canvasW: maxX + PAD,
      canvasH: maxY + PAD,
    }
  }, [filtered])

  // Highlight set for selected node
  const highlightSet = useMemo(() => {
    if (!selected) return null
    const ancestors = getAncestors(selected, byId)
    const descendants = getDescendants(selected, childrenMap)
    return new Set([selected, ...ancestors, ...descendants])
  }, [selected, byId, childrenMap])

  // Gap detection: depth > min and no parent link in this dataset
  const minDepth = useMemo(() =>
    objectives.length ? Math.min(...objectives.map(o => o.level?.depth ?? 0)) : 0,
    [objectives])

  const isGapFn = (obj: CadenceObjective) => {
    const depth = obj.level?.depth ?? 0
    return depth > minDepth && !obj.parent_objective_id
  }

  // Stats
  const totalObjs = objectives.length
  const gapCount = objectives.filter(isGapFn).length
  const avgProgress = objectives.length
    ? Math.round(objectives.reduce((s, o) => s + o.progress, 0) / objectives.length * 100)
    : 0

  function handleSelect(id: string) {
    setSelected(prev => prev === id ? null : id)
  }

  // Batch-load relevant units for all objectives once they are available
  useEffect(() => {
    if (objectives.length === 0) { setRelevantUnitsMap(new Map()); return }
    getRelevantUnitsForObjectives(objectives.map(o => o.id))
      .then(setRelevantUnitsMap)
      .catch(() => { /* best-effort — gaps simply won't show if this fails */ })
  }, [objectives])

  // Click outside canvas to deselect
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="cd-page" style={{ gap: 0, overflow: 'hidden', height: '100%' }}>
      {/* Toolbar */}
      <div className="cd-csc-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Cascade</h2>

          {/* Cycle selector */}
          <select
            className="cd-csc-cycle-select"
            value={activeCycle?.id ?? ''}
            onChange={e => {
              const c = cycles.find(x => x.id === e.target.value)
              if (c) setActiveCycle(c)
            }}
          >
            {cycles.map(c => (
              <option key={c.id} value={c.id}>Q{c.quarter} {c.year}</option>
            ))}
          </select>
        </div>

        {/* Stats */}
        <div className="cd-csc-stats">
          <span>{totalObjs} objectives</span>
          <span>·</span>
          <span>{avgProgress}% avg progress</span>
          {gapCount > 0 && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--bad)' }}>{gapCount} gap{gapCount !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'mypath', 'gaps'] as FilterMode[]).map(f => (
              <button
                key={f}
                type="button"
                className={'cd-csc-filter-btn' + (filter === f ? ' is-on' : '')}
                onClick={() => { setFilter(f); setSelected(null) }}
              >
                {f === 'all' ? 'All' : f === 'mypath' ? 'My path' : 'Gaps'}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              type="button"
              className={'cd-csc-filter-btn' + (view === 'tree' ? ' is-on' : '')}
              onClick={() => setView('tree')}
              title="Tree view"
            >
              <Icon name="grid" size={13} />
            </button>
            <button
              type="button"
              className={'cd-csc-filter-btn' + (view === 'list' ? ' is-on' : '')}
              onClick={() => setView('list')}
              title="List view"
            >
              <Icon name="flag" size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading ? (
          <div style={{ padding: 40, color: 'var(--ink-soft)' }}>Loading cascade…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, color: 'var(--ink-soft)' }}>
            {filter === 'gaps' ? 'No alignment gaps found.' :
             filter === 'mypath' ? 'No objectives in your path.' :
             'No objectives for this cycle.'}
          </div>
        ) : view === 'list' ? (
          // List view
          <div className="cd-csc-list">
            {filtered.map(obj => (
              <ListRow
                key={obj.id}
                obj={obj}
                isSelected={selected === obj.id}
                onClick={() => handleSelect(obj.id)}
              />
            ))}
          </div>
        ) : (
          // Tree view
          <div className="cd-csc-canvas-wrap" ref={canvasRef}>
            <div
              className="cd-csc-canvas"
              style={{ width: canvasW, height: canvasH, position: 'relative' }}
            >
              <SvgLines
                objectives={filtered}
                positions={positions}
                highlightSet={highlightSet}
                selected={selected}
                canvasW={canvasW}
                canvasH={canvasH}
              />
              {filtered.map(obj => {
                const pos = positions.get(obj.id)
                if (!pos) return null
                const isSelected = selected === obj.id
                const isHighlighted = !selected || !!(highlightSet?.has(obj.id))
                const isDimmed = !!selected && !isHighlighted
                const ruList = relevantUnitsMap.get(obj.id) ?? []
                const childIds = childrenMap.get(obj.id) ?? []
                const childObjs = childIds.map(id => byId.get(id)).filter((c): c is CadenceObjective => !!c)
                const relevanceGapCount = ruList.filter(ru => !childObjs.some(c => c.unit_id === ru.unit_id)).length
                return (
                  <div
                    key={obj.id}
                    style={{ position: 'absolute', left: pos.x, top: pos.y }}
                  >
                    <CascadeNodeCard
                      obj={obj}
                      isSelected={isSelected}
                      isHighlighted={isHighlighted}
                      isDimmed={isDimmed}
                      isGap={isGapFn(obj)}
                      relevanceGapCount={relevanceGapCount}
                      onClick={() => handleSelect(obj.id)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Detail panel */}
        {selected && byId.has(selected) && (
          <DetailPanel
            obj={byId.get(selected)!}
            byId={byId}
            childrenMap={childrenMap}
            relevantUnits={relevantUnitsMap.get(selected) ?? []}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}
