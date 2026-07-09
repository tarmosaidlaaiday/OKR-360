import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWeeklyCheckin } from '../hooks/useWeeklyCheckin'
import { PageHeader } from '../components/cadence/PageHeader'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Icon } from '../components/cadence/Icon'
import { ConfidencePicker } from '../components/checkins/ConfidencePicker'
import { WillScorePicker } from '../components/checkins/WillScorePicker'
import { StreakBadge } from '../components/checkins/StreakBadge'
import { fmt } from '../lib/cadenceUtils'
import type { CheckinKR, CheckinDraft } from '../types/cadence'

// ── Progress dots ─────────────────────────────────────────────────────────

function ProgressDots({ total, current, doneSet }: { total: number; current: number; doneSet: Set<number> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div className="cd-checkin-dots">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={
              `cd-checkin-dot` +
              (doneSet.has(i) ? ' cd-checkin-dot--done' : '') +
              (i === current && !doneSet.has(i) ? ' cd-checkin-dot--cur' : '')
            }
          />
        ))}
      </div>
      <span className="cd-checkin-dot-label">{Math.min(current + 1, total)} of {total}</span>
    </div>
  )
}

// ── Single KR card ────────────────────────────────────────────────────────

function KrCard({ kr, draft, onChange }: {
  kr: CheckinKR
  draft: CheckinDraft
  onChange: (d: Partial<CheckinDraft>) => void
}) {
  const lastValue = kr.last_week_checkin?.new_value ?? null
  const delta = lastValue != null ? draft.new_value - lastValue : null
  const progress = kr.target_value > 0 ? Math.min(1, draft.new_value / kr.target_value) : 0
  const isBoolean = kr.target_type === 'boolean'

  return (
    <div className="cd-checkin-card">
      {/* Objective label */}
      <div className="cd-checkin-obj-label">{kr.objective_title}</div>

      {/* KR title */}
      <div className="cd-checkin-kr-title">{kr.title}</div>

      {/* Progress */}
      <div>
        <ProgressBar value={progress} height={6} />
        <div className="cd-checkin-progress-labels">
          <span>{fmt(draft.new_value)}{kr.unit ?? ''}</span>
          <span>target: {fmt(kr.target_value)}{kr.unit ?? ''}</span>
        </div>
        {delta != null && (
          <div style={{ marginTop: 4, fontSize: 12, color: delta >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
            {delta >= 0 ? '↑' : '↓'} {fmt(Math.abs(delta))}{kr.unit ?? ''} since last week
          </div>
        )}
      </div>

      {/* New value */}
      <div className="cd-checkin-field">
        <label className="cd-checkin-field-lbl">
          {isBoolean ? 'Status' : 'New value'}
        </label>
        {isBoolean ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`cd-btn${draft.new_value ? ' cd-btn-primary' : ''}`}
              onClick={() => onChange({ new_value: 1 })}
            >
              Done
            </button>
            <button
              type="button"
              className={`cd-btn${!draft.new_value ? ' cd-btn-primary' : ''}`}
              onClick={() => onChange({ new_value: 0 })}
            >
              Not done
            </button>
          </div>
        ) : (
          <div className="cd-checkin-value-wrap">
            <input
              type="number"
              className="cd-checkin-value-input"
              value={draft.new_value}
              onChange={e => onChange({ new_value: parseFloat(e.target.value) || 0 })}
              onFocus={e => e.target.select()}
              step="any"
            />
            {kr.unit && <span className="cd-checkin-unit">{kr.unit}</span>}
          </div>
        )}
      </div>

      {/* Confidence */}
      <div className="cd-checkin-field">
        <label className="cd-checkin-field-lbl">Confidence (1 = worried, 10 = very confident)</label>
        <ConfidencePicker
          value={draft.confidence}
          onChange={v => onChange({ confidence: v })}
        />
      </div>

      {/* Will score */}
      <div className="cd-checkin-field">
        <label className="cd-checkin-field-lbl">Determination (1 = low effort, 10 = full drive)</label>
        <WillScorePicker
          value={draft.will_score}
          onChange={v => onChange({ will_score: v })}
        />
        {draft.will_score > 0 && (
          <input
            type="text"
            className="cd-checkin-value-input"
            style={{ marginTop: 8, width: '100%' }}
            placeholder="What will you do to move this forward? (optional)"
            value={draft.will_action}
            onChange={e => onChange({ will_action: e.target.value })}
          />
        )}
      </div>

      {/* Blocker toggle */}
      <div className="cd-checkin-field">
        <label className="cd-checkin-blocker-toggle">
          <div
            className={`cd-toggle${draft.has_blocker ? ' is-on' : ''}`}
            onClick={() => onChange({ has_blocker: !draft.has_blocker })}
            role="switch"
            aria-checked={draft.has_blocker}
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onChange({ has_blocker: !draft.has_blocker })}
          />
          <span style={{ color: draft.has_blocker ? 'var(--bad)' : undefined }}>
            <Icon name="alertTriangle" size={14} />
            {' '}Blocker
          </span>
        </label>
        {draft.has_blocker && (
          <textarea
            className="cd-checkin-blocker-text"
            placeholder="Describe the blocker so your team lead can help…"
            value={draft.blocker_text}
            onChange={e => onChange({ blocker_text: e.target.value })}
          />
        )}
      </div>

      {/* Note */}
      <div className="cd-checkin-field">
        <label className="cd-checkin-field-lbl">Note (optional)</label>
        <textarea
          className="cd-checkin-note"
          placeholder="Any context for the team?"
          value={draft.note}
          onChange={e => onChange({ note: e.target.value })}
        />
      </div>
    </div>
  )
}

// ── Success screen ────────────────────────────────────────────────────────

function SuccessScreen({ krs, drafts, streak }: {
  krs: CheckinKR[]
  drafts: Map<string, CheckinDraft>
  streak: import('../types/cadence').CheckinStreak | null
}) {
  const navigate = useNavigate()
  const avgConf = krs.length
    ? Math.round(
        krs.reduce((s, kr) => s + (drafts.get(kr.id)?.confidence ?? 5), 0) / krs.length,
      )
    : 0
  const blockersCount = krs.filter(kr => drafts.get(kr.id)?.has_blocker).length

  return (
    <div className="cd-checkin-success">
      <div className="cd-checkin-success-icon">
        <Icon name="check" size={32} />
      </div>
      <div className="cd-checkin-success-title">Check-in complete!</div>
      <div className="cd-checkin-success-sub">
        {krs.length} KR{krs.length !== 1 ? 's' : ''} updated for this week.
        {streak && streak.current_streak > 1 && ` 🔥 ${streak.current_streak}-week streak!`}
      </div>

      <div className="cd-checkin-summary">
        <div className="cd-checkin-summary-stat">
          <span className="cd-checkin-summary-val">{krs.length}</span>
          <span className="cd-checkin-summary-lbl">KRs updated</span>
        </div>
        <div className="cd-checkin-summary-stat">
          <span className="cd-checkin-summary-val">{avgConf}/10</span>
          <span className="cd-checkin-summary-lbl">Avg confidence</span>
        </div>
        {blockersCount > 0 && (
          <div className="cd-checkin-summary-stat">
            <span className="cd-checkin-summary-val" style={{ color: 'var(--bad)' }}>{blockersCount}</span>
            <span className="cd-checkin-summary-lbl">Blockers</span>
          </div>
        )}
        {streak && (
          <div className="cd-checkin-summary-stat">
            <span className="cd-checkin-summary-val">🔥{streak.current_streak}</span>
            <span className="cd-checkin-summary-lbl">Week streak</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="cd-btn" onClick={() => navigate('/okrs')}>
          View OKRs
        </button>
        <button type="button" className="cd-btn cd-btn-primary" onClick={() => navigate('/check-in/team')}>
          Team status
        </button>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export function CheckInPage() {
  const { krs, loading, drafts, setDraft, submitAll, isSubmitting, isDone, streak, error, week } = useWeeklyCheckin()
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set())

  const currentKr = krs[step]
  const currentDraft = currentKr ? drafts.get(currentKr.id) : undefined

  async function handleSubmit() {
    await submitAll()
    setSubmitted(true)
  }

  function handleNext() {
    if (step < krs.length - 1) {
      setDoneSteps(prev => new Set(prev).add(step))
      setStep(s => s + 1)
    }
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1)
  }

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading your KRs…</p></div>

  if (krs.length === 0) {
    return (
      <div className="cd-page">
        <PageHeader title="Check in" sub={`Week ${week}`} />
        <p className="cd-empty-hint">No key results assigned to you for this cycle.</p>
      </div>
    )
  }

  if (isDone && !submitted) {
    return (
      <div className="cd-page">
        <div className="cd-checkin-shell">
          <PageHeader title="Check in" sub={`Week ${week} — already submitted`} />
          <div className="cd-checkin-success">
            <div className="cd-checkin-success-icon"><Icon name="check" size={32} /></div>
            <div className="cd-checkin-success-title">All done for week {week}</div>
            <div className="cd-checkin-success-sub">You've already checked in all your KRs this week.</div>
            <StreakBadge streak={streak} />
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="cd-page">
        <div className="cd-checkin-shell">
          <SuccessScreen krs={krs} drafts={drafts} streak={streak} />
        </div>
      </div>
    )
  }

  const isLast = step === krs.length - 1

  return (
    <div className="cd-page">
      <div className="cd-checkin-shell">
        <div className="cd-checkin-header">
          <PageHeader title="Check in" sub={`Week ${week}`} />
          <StreakBadge streak={streak} />
        </div>

        <ProgressDots
          total={krs.length}
          current={step}
          doneSet={doneSteps}
        />

        {currentKr && currentDraft && (
          <KrCard
            kr={currentKr}
            draft={currentDraft}
            onChange={d => setDraft(currentKr.id, d)}
          />
        )}

        {error && (
          <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        )}

        <div className="cd-checkin-nav">
          <button type="button" className="cd-btn" onClick={handleBack} disabled={step === 0}>
            ← Back
          </button>
          <div className="cd-checkin-nav-r">
            {isLast ? (
              <button
                type="button"
                className="cd-btn cd-btn-primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting…' : 'Submit all'}
              </button>
            ) : (
              <button type="button" className="cd-btn cd-btn-primary" onClick={handleNext}>
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
