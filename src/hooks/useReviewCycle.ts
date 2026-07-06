import { useEffect, useState, useCallback } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import {
  getMyReviewItems, submitSelfAssessment,
  type ReviewObjective, type SelfAssessmentInput, type CarryForward,
} from '../services/reviewCycles.service'
import { avgScore } from '../lib/reviewUtils'

export interface ReviewDraft {
  kr_scores: Record<string, number>         // kr_id → score
  reflection_what_drove: string
  reflection_improve: string
  carry_forward: CarryForward
  overall_note: string
}

function defaultDraft(obj: ReviewObjective): ReviewDraft {
  const kr_scores: Record<string, number> = {}
  obj.key_results.forEach(kr => {
    kr_scores[kr.id] = kr.self_score ?? kr.auto_score
  })
  return {
    kr_scores,
    reflection_what_drove: obj.self_review?.reflection_what_drove ?? '',
    reflection_improve:    obj.self_review?.reflection_improve ?? '',
    carry_forward:         obj.self_review?.carry_forward ?? 'no',
    overall_note:          obj.self_review?.overall_note ?? '',
  }
}

export function useReviewCycle() {
  const { activeCycle } = useCycle()
  const { user } = useAuth()

  const [objectives, setObjectives] = useState<ReviewObjective[]>([])
  const [drafts, setDrafts] = useState<Map<string, ReviewDraft>>(new Map())
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isReviewing = (activeCycle as any)?.status === 'reviewing'

  const reload = useCallback(async () => {
    if (!user?.id || !activeCycle?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const items = await getMyReviewItems(user.id, activeCycle.id)
      setObjectives(items)

      // Build initial drafts
      const d = new Map<string, ReviewDraft>()
      items.forEach(obj => d.set(obj.id, defaultDraft(obj)))
      setDrafts(d)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [user?.id, activeCycle?.id])

  useEffect(() => { reload() }, [reload])

  function setDraft(objId: string, patch: Partial<ReviewDraft>) {
    setDrafts(prev => {
      const next = new Map(prev)
      const cur = next.get(objId) ?? {
        kr_scores: {}, reflection_what_drove: '', reflection_improve: '',
        carry_forward: 'no' as CarryForward, overall_note: '',
      }
      next.set(objId, { ...cur, ...patch })
      return next
    })
  }

  function setKrScore(objId: string, krId: string, score: number) {
    setDrafts(prev => {
      const next = new Map(prev)
      const cur = next.get(objId)
      if (!cur) return prev
      next.set(objId, { ...cur, kr_scores: { ...cur.kr_scores, [krId]: score } })
      return next
    })
  }

  async function submitObjective(objId: string): Promise<void> {
    if (!user?.id || !activeCycle?.id) return
    const obj = objectives.find(o => o.id === objId)
    const draft = drafts.get(objId)
    if (!obj || !draft) return

    setIsSubmitting(true)
    setError(null)
    try {
      const input: SelfAssessmentInput = {
        objective_id: objId,
        cycle_id: activeCycle.id,
        reviewer_id: user.id,
        reflection_what_drove: draft.reflection_what_drove,
        reflection_improve: draft.reflection_improve,
        carry_forward: draft.carry_forward,
        overall_note: draft.overall_note,
        kr_scores: Object.entries(draft.kr_scores).map(([key_result_id, score]) => ({ key_result_id, score })),
      }
      await submitSelfAssessment(input)
      await reload()
    } catch (e) {
      setError(getErrorMessage(e))
      throw e
    } finally {
      setIsSubmitting(false)
    }
  }

  // Live objective score from current draft
  function liveScore(objId: string): number | null {
    const obj = objectives.find(o => o.id === objId)
    const draft = drafts.get(objId)
    if (!obj || !draft) return null
    const scores = obj.key_results.map(kr => draft.kr_scores[kr.id] ?? kr.auto_score)
    return avgScore(scores)
  }

  const selfAssessmentDue = isReviewing && objectives.some(o => !o.self_review?.submitted_at)
  const allSubmitted = objectives.length > 0 && objectives.every(o => o.self_review?.submitted_at)

  return {
    objectives,
    drafts,
    loading,
    isSubmitting,
    error,
    isReviewing,
    selfAssessmentDue,
    allSubmitted,
    setDraft,
    setKrScore,
    submitObjective,
    liveScore,
    reload,
    cycleLabel: activeCycle?.label ?? '',
    cycleId: activeCycle?.id ?? null,
    reviewClosesAt: (activeCycle as any)?.review_closes_at ?? null,
  }
}
