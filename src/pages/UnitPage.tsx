import { useParams } from 'react-router-dom'
import { useUnitDetail } from '../hooks/useUnitDetail'
import { PageHeader } from '../components/cadence/PageHeader'
import { LevelBadge } from '../components/cadence/LevelBadge'
import { Avatar } from '../components/cadence/Avatar'
import { StatusChip } from '../components/cadence/StatusChip'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { fmt } from '../lib/cadenceUtils'
import { profileToPerson } from '../lib/cadenceUtils'
import type { PeopleUnit, PeopleUnitRole } from '../types/cadence'

function RoleBadge({ role }: { role: PeopleUnitRole }) {
  return (
    <span className={`cd-role-badge cd-role-badge--${role}`}>
      {role}
    </span>
  )
}

function MemberRow({ membership }: { membership: PeopleUnit }) {
  const rawPerson = (membership as any).person
  const person = rawPerson
    ? profileToPerson({
        id: rawPerson.id,
        full_name: rawPerson.full_name ?? rawPerson.name ?? '',
        avatar_url: rawPerson.avatar_url,
        role: rawPerson.role,
      })
    : null

  const joinedDate = new Date(membership.joined_at).toLocaleDateString(undefined, {
    month: 'short', year: 'numeric',
  })

  return (
    <div className="cd-member-row">
      <Avatar person={person} size={28} />
      <div className="cd-member-info">
        <div className="cd-member-name">{person?.name ?? 'Unknown'}</div>
        <div className="cd-member-since">Joined {joinedDate}</div>
      </div>
      <RoleBadge role={membership.role} />
    </div>
  )
}

export function UnitPage() {
  const { id } = useParams<{ id: string }>()
  const { unit, members, objectives, loading } = useUnitDetail(id ?? null)

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading…</p></div>
  if (!unit) return <div className="cd-page"><p className="cd-empty-hint">Unit not found.</p></div>

  return (
    <div className="cd-page">
      <PageHeader
        title={unit.name}
        sub={
          <LevelBadge level={(unit as any).level ?? null} size="sm" />
        }
      />

      <div className="cd-unit-layout">
        {/* Left: members */}
        <div>
          <div className="cd-set-section">
            <h3 className="cd-set-section-title">Members ({members.length})</h3>
            {members.length === 0 ? (
              <p className="cd-empty-hint" style={{ fontSize: 13 }}>No members yet.</p>
            ) : (
              <div className="cd-member-list">
                {members.map(m => <MemberRow key={m.id} membership={m} />)}
              </div>
            )}
          </div>
        </div>

        {/* Right: objectives */}
        <div>
          <div className="cd-set-section">
            <h3 className="cd-set-section-title">Objectives ({objectives.length})</h3>
            {objectives.length === 0 ? (
              <p className="cd-empty-hint" style={{ fontSize: 13 }}>No objectives for this unit.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {objectives.map(obj => (
                  <div
                    key={obj.id}
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius)',
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <LevelBadge level={obj.level} size="sm" />
                      <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{obj.title}</span>
                      <StatusChip status={obj.status} size="sm" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <ProgressBar value={obj.progress} height={4} />
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)', flexShrink: 0 }}>
                        {fmt(obj.progress * 100)}%
                      </span>
                      <Avatar person={obj.owner ? profileToPerson(obj.owner as any) : null} size={18} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
