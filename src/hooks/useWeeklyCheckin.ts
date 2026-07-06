import { useEffect, useState, useCallback } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import { getMyKRsForCheckin, submitCheckin, getMyStreak, currentWeekYear } from '../services/weeklyCheckins.service'
import type { CheckinKR, CheckinDraft, CheckinStreak } from '../types/cadence'

export function useWeeklyCheckin() {
  const { activeCycle } = useCycle()
  const { user } = useAuth()

  const [krs, setKrs] = useState<CheckinKR[]>([])
  const [loading, setLoading] = useState(true)
  const [streak, setStreak] = useState<CheckinStreak | null>(null)
  const [drafts, setDrafts] = useState<Map<string, CheckinDraft>>(new Map())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDone, setIsDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { week, year } = currentWeekYear()

  useEffect(() => {
    if (!activeCycle?.id || !user?.id) { setLoading(false); return }
    setLoading(true)

    Promise.all([
      getMyKRsForCheckin(user.id, activeCycle.id),
      getMyStreak(user.id),
    ]).then(([fetchedKrs, fetchedStreak]) => {
      setKrs(fetchedKrs)
      setStreak(fetchedStreak)

      // Pre-fill drafts from this week's existing check-ins
      const initialDrafts = new Map<string, CheckinDraft>()
      for (const kr of fetchedKrs) {
        const existing = kr.this_week_checkin
        initialDrafts.set(kr.id, {
          new_value:    existing?.new_value   ?? kr.current_value,
          confidence:   existing?.confidence  ?? 0,
          will_score:   existing?.will_score  ?? 0,
          will_action:  existing?.will_action ?? '',
          has_blocker:  existing?.has_blocker ?? false,
          blocker_text: existing?.blocker_text ?? '',
          note:         existing?.note ?? '',
        })
      }
      setDrafts(initialDrafts)

      // Already done if all KRs have this-week checkins
      const allDone = fetchedKrs.length > 0 && fetchedKrs.every(kr => kr.this_week_checkin !== null)
      setIsDone(allDone)
    }).catch(err => {
      console.error(err)
    }).finally(() => {
      setLoading(false)
    })
  }, [activeCycle?.id, user?.id])

  const setDraft = useCallback((krId: string, draft: Partial<CheckinDraft>) => {
    setDrafts(prev => {
      const next = new Map(prev)
      const existing = next.get(krId) ?? {
        new_value: 0, confidence: 0, will_score: 0, will_action: '', has_blocker: false, blocker_text: '', note: '',
      }
      next.set(krId, { ...existing, ...draft })
      return next
    })
  }, [])

  const submitAll = useCallback(async () => {
    if (!user?.id || !activeCycle?.id) return
    setIsSubmitting(true)
    setError(null)

    try {
      for (const kr of krs) {
        const draft = drafts.get(kr.id)
        if (!draft) continue
        await submitCheckin({
          key_result_id: kr.id,
          person_id:     user.id,
          week_number:   week,
          year,
          cycle_id:      activeCycle.id,
          new_value:     draft.new_value,
          confidence:    draft.confidence || 5,
          will_score:    draft.will_score || null,
          will_action:   draft.will_action || null,
          has_blocker:   draft.has_blocker,
          blocker_text:  draft.blocker_text || null,
          note:          draft.note || null,
        })
      }
      const updatedStreak = await getMyStreak(user.id)
      setStreak(updatedStreak)
      setIsDone(true)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }, [krs, drafts, user?.id, activeCycle?.id, week, year])

  // A check-in is "due" if there are KRs and not all have been submitted this week
  const isCheckInDue = krs.length > 0 && !isDone

  return { krs, loading, drafts, setDraft, submitAll, isSubmitting, isDone, streak, isCheckInDue, error, week, year }
}
