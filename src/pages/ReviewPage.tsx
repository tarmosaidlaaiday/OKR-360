import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReviewCycle } from '../hooks/useReviewCycle'
import { PageHeader } from '../components/cadence/PageHeader'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Icon } from '../components/cadence/Icon'
import { Sparkline } from '../components/cadence/Sparkline'
import { scoreBand, scorePercent, avgScore } from '../lib/reviewUtils'
import type { ReviewObjective } from '../services/reviewCycles.service'
import type { ReviewDraft } from '../hooks/useReviewCycle'

// ── Score chip ────────────────────────────────────────────────────────────

function ScoreChip({ score }: { score: number | null }) {
  const band = scoreBand(score)
  return (
    <span className="cd-rev-score-chip" style={{ color: band.color, background: band.bg }}>
      {scorePercent(score)} {score != null ? band.label : ''}
    </span>
  )
}

// ── KR score slider row ───────────────────────────────────────────────────

function KrScoreRow({
  kr,
  score,
  onChange,
}: {
  kr: ReviewObjective['key_results'][0]
  score: number
  onChange: (v: number) => void
}) {
  const band = scoreBand(score)
  return (
    <div className="cd-rev-kr-row">
      <div className="cd-rev-kr-title">{kr.title}</div>
      <div className="cd-rev-kr-meta">
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          {kr.current_value}{kr.unit ?? ''} / {kr.target_value}{kr.unit ?? ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
          auto: {scorePercent(kr.auto_score)}
        </span>
      </div>
      <div className="cd-rev-slider-wrap">
        <input
          type="range" min={0} max={100} step={1}
          value={Math.round(score * 100)}
          onChange={e => onChange(parseInt(e.target.value) / 100)}
          className="cd-rev-slider"
          style={{ '--slider-color': band.color } as React.CSSProperties}
        />
        <span className="cd-rev-slider-val" style={{ color: band.color }}>
          {scorePercent(score)}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <ProgressBar value={score} height={3} color={band.color} />
      </div>
    </div>
  )
}

// ── Single objective step ─────────────────────────────────────────────────

function ObjectiveStep({
  obj,
  draft,
  onSetKrScore,
  onSetDraft,
  liveScore,
}: {
  obj: ReviewObjective
  draft: ReviewDraft
  onSetKrScore: (krId: string, score: number) => void
  onSetDraft: (patch: Partial<ReviewDraft>) => void
  liveScore: number | null
}) {
  const band = scoreBand(liveScore)

  return (
    <div className="cd-rev-card">
      {/* Objective header */}
      <div className="cd-rev-obj-hd">
        <div className="cd-rev-obj-title">{obj.title}</div>
        <div className="cd-rev-obj-score-live">
          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Objective score</span>
          <ScoreChip score={liveScore} />
        </div>
        <ProgressBar value={liveScore ?? 0} height={4} color={band.color} />
      </div>

      {/* KR scores */}
      <div className="cd-rev-section-title">Key results</div>
      <div className="cd-rev-krs">
        {obj.key_results.map(kr => (
          <KrScoreRow
            key={kr.id}
            kr={kr}
            score={draft.kr_scores[kr.id] ?? kr.auto_score}
            onChange={v => onSetKrScore(kr.id, v)}
          />
        ))}
      </div>

      {/* Reflection */}
      <div className="cd-rev-section-title" style={{ marginTop: 16 }}>Reflection</div>
      <div className="cd-rev-field">
        <label className="cd-rev-field-lbl">What drove this result?</label>
        <textarea
          className="cd-rev-textarea"
          placeholder="Key factors that influenced performance — good or bad…"
          value={draft.reflection_what_drove}
          onChange={e => onSetDraft({ reflection_what_drove: e.target.value })}
        />
      </div>
      <div className="cd-rev-field">
        <label className="cd-rev-field-lbl">What would you improve next time?</label>
        <textarea
          className="cd-rev-textarea"
          placeholder="Lessons learned, process changes, resources needed…"
          value={draft.reflection_improve}
          onChange={e => onSetDraft({ reflection_improve: e.target.value })}
        />
      </div>

      {/* Carry forward */}
      <div className="cd-rev-field">
        <label className="cd-rev-field-lbl">Carry this objective forward?</label>
        <div className="cd-rev-carry-btns">
          {(['yes', 'partial', 'no'] as const).map(v => (
            <button
              key={v}
              type="button"
              className={'cd-btn cd-rev-carry-btn' + (draft.carry_forward === v ? ' is-on' : '')}
              onClick={() => onSetDraft({ carry_forward: v })}
            >
              {v === 'yes' ? 'Yes — all KRs' : v === 'partial' ? 'Partially — unfinished KRs' : 'No'}
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <div className="cd-rev-field">
        <label className="cd-rev-field-lbl">Overall note (optional)</label>
        <textarea
          className="cd-rev-textarea cd-rev-textarea-sm"
          placeholder="Any context for your manager or the team…"
          value={draft.overall_note}
          onChange={e => onSetDraft({ overall_note: e.target.value })}
        />
      </div>
    </div>
  )
}

// ── Completion screen ─────────────────────────────────────────────────────

function CompletionScreen({
  objectives,
  cycleLabel,
}: {
  objectives: ReviewObjective[]
  cycleLabel: string
}) {
  const navigate = useNavigate()
  const scores = objectives.map(o => {
    const krs = o.key_results
    return krs.length ? avgScore(krs.map(k => k.self_score ?? k.auto_score)) : null
  }).filter(s => s != null) as number[]
  const cycleAvg = scores.length ? avgScore(scores) : null
  const cycleBand = scoreBand(cycleAvg)

  return (
    <div className="cd-checkin-success">
      <div className="cd-checkin-success-icon"><Icon name="check" size={32} /></div>
      <div className="cd-checkin-success-title">Self-assessment complete!</div>
      <div className="cd-checkin-success-sub">{objectives.length} objectives scored for {cycleLabel}</div>

      <div className="cd-checkin-summary">
        <div className="cd-checkin-summary-stat">
          <span className="cd-checkin-summary-val">{objectives.length}</span>
          <span className="cd-checkin-summary-lbl">Objectives</span>
        </div>
        <div className="cd-checkin-summary-stat">
          <span className="cd-checkin-summary-val" style={{ color: cycleBand.color }}>
            {scorePercent(cycleAvg)}
          </span>
          <span className="cd-checkin-summary-lbl">Avg score</span>
        </div>
        <div className="cd-checkin-summary-stat">
          <span className="cd-checkin-summary-val">
            {objectives.filter(o => {
              const krs = o.key_results
              const s = avgScore(krs.map(k => k.self_score ?? k.auto_score))
              return s != null && s >= 0.7
            }).length}
          </span>
          <span className="cd-checkin-summary-lbl">Delivered</span>
        </div>
      </div>

      {scores.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <Sparkline values={scores} width={200} height={32} stroke={cycleBand.color} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="cd-btn" onClick={() => navigate('/objectives')}>View OKRs</button>
        <button type="button" className="cd-btn cd-btn-primary" onClick={() => navigate('/dashboard')}>
          Dashboard
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export function ReviewPage() {
  const {
    objectives, drafts, loading, isSubmitting, error,
    isReviewing, allSubmitted,
    setDraft, setKrScore, submitObjective, liveScore,
    cycleLabel, reviewClosesAt,
  } = useReviewCycle()

  const [step, setStep] = useState(0)
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  const currentObj = objectives[step]
  const currentDraft = currentObj ? drafts.get(currentObj.id) : undefined

  const daysLeft = reviewClosesAt
    ? Math.ceil((new Date(reviewClosesAt).getTime() - Date.now()) / 86_400_000)
    : null

  async function handleSubmitStep() {
    if (!currentObj) return
    try {
      await submitObjective(currentObj.id)
      const next = new Set(doneSet).add(step)
      setDoneSet(next)
      if (step === objectives.length - 1) {
        setSubmitted(true)
      } else {
        setStep(s => s + 1)
      }
    } catch { /* error shown via hook */ }
  }

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading review…</p></div>

  if (!isReviewing) {
    return (
      <div className="cd-page">
        <PageHeader title="Review" sub="No active review" />
        <p className="cd-empty-hint">Review period is not currently open for this cycle.</p>
      </div>
    )
  }

  if (objectives.length === 0) {
    return (
      <div className="cd-page">
        <PageHeader title="Review" sub={cycleLabel} />
        <p className="cd-empty-hint">No objectives assigned to you for this cycle.</p>
      </div>
    )
  }

  if (allSubmitted && !submitted) {
    return (
      <div className="cd-page">
        <div className="cd-checkin-shell">
          <PageHeader title="Review" sub={`${cycleLabel} — already submitted`} />
          <CompletionScreen objectives={objectives} cycleLabel={cycleLabel} />
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="cd-page">
        <div className="cd-checkin-shell">
          <CompletionScreen objectives={objectives} cycleLabel={cycleLabel} />
        </div>
      </div>
    )
  }

  const isLast = step === objectives.length - 1

  return (
    <div className="cd-page">
      <div className="cd-checkin-shell">
        {/* Header */}
        <div className="cd-checkin-header">
          <PageHeader title="Self-assessment" sub={cycleLabel} />
          {daysLeft != null && daysLeft >= 0 && (
            <span className="cd-rev-deadline">
              <Icon name="calendar" size={12} /> {daysLeft}d left
            </span>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
          <div className="cd-checkin-dots">
            {objectives.map((_, i) => (
              <span
                key={i}
                className={
                  'cd-checkin-dot' +
                  (doneSet.has(i) || objectives[i].self_review?.submitted_at ? ' cd-checkin-dot--done' : '') +
                  (i === step && !(doneSet.has(i)) ? ' cd-checkin-dot--cur' : '')
                }
              />
            ))}
          </div>
          <span className="cd-checkin-dot-label">{step + 1} of {objectives.length}</span>
        </div>

        {/* Objective step */}
        {currentObj && currentDraft && (
          <ObjectiveStep
            obj={currentObj}
            draft={currentDraft}
            onSetKrScore={(krId, score) => setKrScore(currentObj.id, krId, score)}
            onSetDraft={patch => setDraft(currentObj.id, patch)}
            liveScore={liveScore(currentObj.id)}
          />
        )}

        {error && <div style={{ color: 'var(--bad)', fontSize: 13, marginTop: 8 }}>{error}</div>}

        {/* Nav */}
        <div className="cd-checkin-nav">
          <button type="button" className="cd-btn" onClick={() => setStep(s => s - 1)} disabled={step === 0}>
            ← Back
          </button>
          <div className="cd-checkin-nav-r">
            {!isLast && (
              <button type="button" className="cd-btn" onClick={() => setStep(s => s + 1)}>
                Skip →
              </button>
            )}
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              onClick={handleSubmitStep}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving…' : isLast ? 'Submit all' : 'Save & next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
