import { useState, useEffect } from 'react'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import { useMyFocusObjectives } from '../hooks/useMyFocusObjectives'
import { useCascadeChain } from '../hooks/useCascadeChain'
import { getChildObjectives } from '../services/objectives.service'
import { PageHeader } from '../components/cadence/PageHeader'
import { LevelBadge } from '../components/cadence/LevelBadge'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Avatar } from '../components/cadence/Avatar'
import { Icon } from '../components/cadence/Icon'
import { fmt } from '../lib/cadenceUtils'
import type { CadenceObjective } from '../types/cadence'

// ── Single objective's contribution chain ────────────────────────────────

function ChainView({ obj }: { obj: CadenceObjective }) {
  const { chain, loading } = useCascadeChain(obj.id)
  const [children, setChildren] = useState<CadenceObjective[]>([])
  const [childrenLoading, setChildrenLoading] = useState(true)

  useEffect(() => {
    setChildrenLoading(true)
    getChildObjectives(obj.id)
      .then(setChildren)
      .catch(console.error)
      .finally(() => setChildrenLoading(false))
  }, [obj.id])

  if (loading) {
    return (
      <div className="cd-cascade-chain-wrap">
        <div className="cd-cascade-chain-label">{obj.title}</div>
        <div style={{ padding: '12px 0', color: 'var(--ink-faint)', fontSize: 13 }}>Loading chain…</div>
      </div>
    )
  }

  if (!obj.parent_objective_id && chain.length <= 1) {
    return (
      <div className="cd-cascade-chain-wrap">
        <div className="cd-cascade-chain-label">{obj.title}</div>
        <div className="cd-cascade-unlinked" style={{ margin: '12px 0' }}>
          <Icon name="info" size={14} />
          Not linked to a higher-level objective
        </div>
        {!childrenLoading && children.length > 0 && (
          <ChildList children={children} />
        )}
      </div>
    )
  }

  return (
    <div className="cd-cascade-chain-wrap">
      <div className="cd-cascade-chain-label">{obj.title}</div>
      <div className="cd-cascade-chain">
        {chain.map((node, i) => (
          <>
            <div
              key={node.id}
              className={`cd-cascade-node${node.id === obj.id ? ' cd-cascade-node--focal' : ''}`}
            >
              <LevelBadge level={node.level} size="sm" />
              <div className="cd-cascade-node-title">{node.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Avatar person={node.owner ?? null} size={16} />
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {(node.owner as any)?.name ?? (node.owner as any)?.full_name ?? ''}
                </span>
              </div>
            </div>
            {i < chain.length - 1 && (
              <div key={`arrow-${node.id}`} className="cd-cascade-arrow">
                <Icon name="chevronR" size={14} />
              </div>
            )}
          </>
        ))}
      </div>
      {!childrenLoading && children.length > 0 && (
        <ChildList children={children} />
      )}
    </div>
  )
}

// ── Downward contributors list ────────────────────────────────────────────

function ChildList({ children }: { children: CadenceObjective[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 500, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Objectives supporting this one:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children.map(child => (
          <div
            key={child.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px',
              background: 'var(--surface-raised, var(--bg-2))',
              borderRadius: 8,
              border: '1px solid var(--line)',
            }}
          >
            <LevelBadge level={child.level} size="sm" />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {child.title}
            </span>
            <div style={{ width: 64, flexShrink: 0 }}>
              <ProgressBar value={child.progress} height={4} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {fmt(child.progress * 100)}%
            </span>
            <Avatar person={child.owner ?? null} size={16} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export function MyContributionPage() {
  const { activeCycle } = useCycle()
  const { profile } = useAuth()

  const quarter = activeCycle ? parseInt(activeCycle.label.replace(/[^1-4]/g, '')) || 1 : 1
  const year = activeCycle
    ? parseInt(activeCycle.label.replace(/\D+(\d{4}).*/, '$1')) || new Date().getFullYear()
    : new Date().getFullYear()

  const userId = profile?.id ?? null
  const { objectives, loading } = useMyFocusObjectives(activeCycle?.id ?? null, userId, quarter, year)

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading…</p></div>

  return (
    <div className="cd-page">
      <PageHeader
        title="My Contribution"
        sub="How your objectives connect to higher-level goals"
      />

      {objectives.length === 0 ? (
        <p className="cd-empty-hint">No objectives assigned to you for this cycle.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {objectives.map(obj => (
            <ChainView key={obj.id} obj={obj} />
          ))}
        </div>
      )}
    </div>
  )
}
