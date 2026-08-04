import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePeopleUnits } from '../hooks/usePeopleUnits'
import { getTeamCheckinStatus, currentWeekYear, type TeamMemberStatus } from '../services/weeklyCheckins.service'
import { sendNudge } from '../services/notifications.service'
import { PageHeader } from '../components/cadence/PageHeader'
import { Avatar } from '../components/cadence/Avatar'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Icon } from '../components/cadence/Icon'
import { profileToPerson } from '../lib/cadenceUtils'

export function TeamCheckinPage() {
  const { user } = useAuth()
  const { memberships } = usePeopleUnits(user?.id ?? null)
  const { week } = currentWeekYear()

  const [members, setMembers] = useState<TeamMemberStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [nudging, setNudging] = useState<Set<string>>(new Set())

  // Use the first lead-role unit as the team to show
  const leadMembership = memberships.find(m => m.role === 'lead')
  const unitId = leadMembership?.unit_id ?? null

  useEffect(() => {
    if (!unitId) return
    setLoading(true)
    getTeamCheckinStatus(unitId)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [unitId])

  async function handleNudge(personId: string) {
    if (!user?.id) return
    setNudging(prev => new Set(prev).add(personId))
    try {
      await sendNudge(user.id, personId)
    } finally {
      setNudging(prev => { const s = new Set(prev); s.delete(personId); return s })
    }
  }

  const submitted = members.filter(m => m.has_submitted)
  const blockers = members.flatMap(m =>
    m.blockers.map(b => ({ ...b, person: m.person })),
  )

  if (!leadMembership) {
    return (
      <div className="cd-page">
        <PageHeader title="Team check-in" sub={`Week ${week}`} />
        <p className="cd-empty-hint">You need to be a unit lead to view team check-in status.</p>
      </div>
    )
  }

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading team status…</p></div>

  return (
    <div className="cd-page">
      <PageHeader title="Team check-in" sub={`Week ${week}`} />

      {/* Completion rate */}
      <div className="cd-team-ci-completion" style={{ marginBottom: 20 }}>
        <div className="cd-team-ci-completion-hd">
          <span className="cd-team-ci-fraction">
            {submitted.length}<span style={{ fontSize: 14, color: 'var(--ink-soft)' }}>/{members.length}</span>
          </span>
          <span className="cd-team-ci-fraction-lbl">checked in this week</span>
        </div>
        <ProgressBar
          value={members.length ? submitted.length / members.length : 0}
          height={5}
          color={submitted.length === members.length ? 'var(--ok)' : 'var(--accent)'}
        />
      </div>

      {/* Member list */}
      <div className="cd-set-section" style={{ marginBottom: 20 }}>
        <h3 className="cd-set-section-title">Team members</h3>
        <div className="cd-team-ci-list">
          {members.map(m => {
            const person = m.person
              ? profileToPerson({ id: m.person_id, full_name: m.person.full_name, avatar_url: m.person.avatar_url, role: null })
              : null
            const isPending = !m.has_submitted

            return (
              <div key={m.person_id} className="cd-team-ci-row">
                <Avatar person={person} size={28} />
                <div className="cd-team-ci-info">
                  <div className="cd-team-ci-name">{m.person?.full_name ?? 'Unknown'}</div>
                  <div className="cd-team-ci-status">
                    {m.has_submitted ? 'Checked in' : 'Pending'}
                  </div>
                </div>
                {m.confidence != null && (
                  <ConfidenceCell value={m.confidence} size={22} />
                )}
                {m.blockers.length > 0 && (
                  <span title={`${m.blockers.length} blocker`} style={{ color: 'var(--bad)' }}>
                    <Icon name="alertTriangle" size={14} />
                  </span>
                )}
                {isPending && (
                  <button
                    type="button"
                    className="cd-btn"
                    style={{ fontSize: 12, padding: '3px 10px', marginLeft: 4 }}
                    onClick={() => handleNudge(m.person_id)}
                    disabled={nudging.has(m.person_id)}
                  >
                    {nudging.has(m.person_id) ? 'Sent' : 'Nudge'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Blockers */}
      {blockers.length > 0 && (
        <div className="cd-team-ci-blockers">
          <div className="cd-team-ci-blocker-hd">
            ⚠ Blockers this week ({blockers.length})
          </div>
          {blockers.map((b, i) => (
            <div key={i} className="cd-team-ci-blocker-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <Avatar
                  person={b.person ? profileToPerson({ id: b.person.id, full_name: b.person.full_name, avatar_url: b.person.avatar_url, role: null }) : null}
                  size={18}
                />
                <span className="cd-team-ci-blocker-kr">{b.kr_title}</span>
              </div>
              {b.blocker_text && (
                <div className="cd-team-ci-blocker-txt">{b.blocker_text}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
