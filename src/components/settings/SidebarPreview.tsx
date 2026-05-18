import type { Level, Unit } from '../../types/cadence'

interface UnitTreeNode extends Unit {
  children: UnitTreeNode[]
}

function buildPreviewTree(units: Unit[]): UnitTreeNode[] {
  const byId = new Map<string, UnitTreeNode>()
  for (const u of units) byId.set(u.id, { ...u, children: [] })
  const roots: UnitTreeNode[] = []
  for (const u of units) {
    const node = byId.get(u.id)!
    if (u.parent_id && byId.has(u.parent_id)) byId.get(u.parent_id)!.children.push(node)
    else roots.push(node)
  }
  return roots
}

const NAV_ITEMS: { label: string; icon: string; section?: boolean }[] = [
  { label: 'Dashboard',   icon: '⊞' },
  { label: 'Objectives',  icon: '◎' },
  { label: 'KPIs',        icon: '↗' },
  { label: 'People',      icon: '◯' },
  { label: 'Analytics',   icon: '⊟' },
  { label: 'Organisation', icon: '', section: true },
  { label: 'Structure',   icon: '⌘' },
  { label: 'Users',       icon: '⊕' },
]

interface PreviewNodeProps {
  node: UnitTreeNode
  levelMap: Map<string, Level>
  depth: number
}

function PreviewNode({ node, levelMap, depth }: PreviewNodeProps) {
  const level = node.level_id ? levelMap.get(node.level_id) : null
  return (
    <>
      <div className="cd-prev-unit" style={{ paddingLeft: 10 + depth * 12 }}>
        <span className="cd-prev-dot" style={{ background: level?.color ?? 'var(--ink-faint)' }} />
        <span className="cd-prev-unit-name">{node.name}</span>
        {level && <span className="cd-prev-level-tag" style={{ color: level.color }}>{level.name}</span>}
      </div>
      {node.children.map(c => <PreviewNode key={c.id} node={c} levelMap={levelMap} depth={depth + 1} />)}
    </>
  )
}

interface SidebarPreviewProps {
  levels: Level[]
  units: Unit[]
}

export function SidebarPreview({ levels, units }: SidebarPreviewProps) {
  const tree = buildPreviewTree(units)
  const levelMap = new Map(levels.map(l => [l.id, l]))
  const enabledLevels = levels.filter(l => l.enabled)

  return (
    <div className="cd-prev-sidebar">
      {/* Brand */}
      <div className="cd-prev-brand">
        <span className="cd-prev-brand-icon">✦</span>
        <span className="cd-prev-brand-name">Cadence</span>
      </div>

      {/* Nav */}
      <div className="cd-prev-nav">
        {NAV_ITEMS.map((item, i) =>
          item.section ? (
            <div key={item.label} className="cd-prev-section-label" style={{ marginTop: 6 }}>{item.label}</div>
          ) : (
            <div key={item.label} className={'cd-prev-link' + (i === 0 ? ' is-active' : '')}>
              <span className="cd-prev-link-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          )
        )}
      </div>

      {/* Level legend */}
      {enabledLevels.length > 0 && (
        <div className="cd-prev-levels">
          <div className="cd-prev-section-label">Levels</div>
          {enabledLevels.map(l => (
            <div key={l.id} className="cd-prev-level-row">
              <span className="cd-prev-dot" style={{ background: l.color }} />
              <span className="cd-prev-level-name">{l.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Org tree */}
      {tree.length > 0 && (
        <div className="cd-prev-tree">
          <div className="cd-prev-section-label">Org structure</div>
          {tree.slice(0, 12).map(n => (
            <PreviewNode key={n.id} node={n} levelMap={levelMap} depth={0} />
          ))}
          {units.length > 12 && (
            <div className="cd-prev-more">+{units.length - 12} more</div>
          )}
        </div>
      )}

      {/* Footer placeholder */}
      <div className="cd-prev-footer">
        <span className="cd-prev-avatar" />
        <span className="cd-prev-user-name">You</span>
      </div>
    </div>
  )
}
