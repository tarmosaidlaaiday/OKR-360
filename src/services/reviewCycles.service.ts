import { supabase } from '../lib/supabase'
import { computeAutoScore, avgScore } from '../lib/reviewUtils'

// ── Types ─────────────────────────────────────────────────────────────────

export type CycleStatus = 'draft' | 'active' | 'reviewing' | 'archived'
export type ReviewStage = 'self' | 'manager' | 'final'
export type CarryForward = 'yes' | 'partial' | 'no'

export interface FullCycle {
  id: string
  label: string
  year: number
  quarter: number
  start_date: string
  end_date: string
  status: CycleStatus
  review_open_at: string | null
  review_closes_at: string | null
  created_by: string | null
}

export interface ReviewKR {
  id: string
  title: string
  target_type: string
  direction: 'up' | 'down'
  current_value: number
  target_value: number
  unit: string | null
  owner_id: string | null
  auto_score: number
  self_score: number | null
  manager_score: number | null
  final_score: number | null
}

export interface ReviewObjective {
  id: string
  title: string
  owner_id: string
  owner_name: string | null
  owner_avatar: string | null
  key_results: ReviewKR[]
  self_review: {
    reflection_what_drove: string
    reflection_improve: string
    carry_forward: CarryForward
    overall_note: string
    submitted_at: string | null
  } | null
  manager_review: { overall_note: string | null; submitted_at: string | null } | null
  auto_score: number
}

export interface CycleSummary {
  cycle: FullCycle
  objectives: ReviewObjective[]
  cycle_score: number | null
  prev_cycle_score: number | null
}

// ── Cycle management ──────────────────────────────────────────────────────

export async function getCycles(): Promise<FullCycle[]> {
  const { data, error } = await supabase
    .from('cycles')
    .select('id, label, year, quarter, start_date, end_date, status, review_open_at, review_closes_at, created_by')
    .order('year', { ascending: false })
    .order('quarter', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map(c => ({ ...c, status: c.status ?? 'active' }))
}

export async function createCycle(input: {
  label: string; year: number; quarter: number;
  start_date: string; end_date: string; review_closes_at?: string
}): Promise<FullCycle> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: orgId } = await supabase.rpc('my_org_id')
  const { data, error } = await supabase
    .from('cycles')
    .insert({ ...input, status: 'draft', created_by: user?.id ?? null, org_id: orgId })
    .select('id, label, year, quarter, start_date, end_date, status, review_open_at, review_closes_at, created_by')
    .single()
  if (error) throw error
  return data as unknown as FullCycle
}

export async function setCycleStatus(cycleId: string, status: CycleStatus, extra?: {
  review_closes_at?: string
}): Promise<void> {
  if (status === 'reviewing') {
    const { error } = await supabase.rpc('notify_review_open', { p_cycle_id: cycleId })
    if (error) throw error
    if (extra?.review_closes_at) {
      await supabase.from('cycles').update({
        review_open_at: new Date().toISOString(),
        review_closes_at: extra.review_closes_at,
      }).eq('id', cycleId)
    }
    return
  }
  const { error } = await supabase.from('cycles').update({
    status,
    ...(status === 'active' ? {} : {}),
  }).eq('id', cycleId)
  if (error) throw error
}

export async function lockCycleScores(cycleId: string, nextCycleId: string | null): Promise<void> {
  const { error } = await supabase.rpc('lock_cycle_scores', {
    p_cycle_id: cycleId,
    p_next_cycle_id: nextCycleId,
  })
  if (error) throw error
}

// ── Fetch review items for a user ─────────────────────────────────────────

export async function getMyReviewItems(userId: string, cycleId: string): Promise<ReviewObjective[]> {
  // Objectives owned by user in this cycle, with KRs
  const { data: objs, error } = await supabase
    .from('objectives')
    .select(`
      id, title, owner_id,
      owner:profiles!owner_id(id, full_name, avatar_url),
      key_results(id, title, target_type, direction, current_value, target_value, unit, owner_id, final_score)
    `)
    .eq('cycle_id', cycleId)
    .eq('owner_id', userId)

  if (error) throw error

  // Also get existing reviews
  const objIds = ((objs ?? []) as any[]).map((o: any) => o.id)
  const krIds = ((objs ?? []) as any[]).flatMap((o: any) => (o.key_results ?? []).map((k: any) => k.id))

  const [reviewsRes, scoresRes] = await Promise.all([
    objIds.length ? supabase
      .from('objective_reviews')
      .select('*')
      .in('objective_id', objIds)
      .eq('cycle_id', cycleId) : { data: [], error: null },
    krIds.length ? supabase
      .from('key_result_scores')
      .select('*')
      .in('key_result_id', krIds)
      .eq('cycle_id', cycleId) : { data: [], error: null },
  ])

  const reviews = (reviewsRes.data ?? []) as any[]
  const scores = (scoresRes.data ?? []) as any[]

  return ((objs ?? []) as any[]).map((o: any): ReviewObjective => {
    const selfReview = reviews.find(r => r.objective_id === o.id && r.stage === 'self') ?? null
    const mgrReview  = reviews.find(r => r.objective_id === o.id && r.stage === 'manager') ?? null

    const krs: ReviewKR[] = (o.key_results ?? []).map((k: any): ReviewKR => {
      const auto = computeAutoScore(k.current_value, k.target_value, k.target_type, k.direction ?? 'up')
      const selfScore = scores.find(s => s.key_result_id === k.id && s.stage === 'self')?.score ?? null
      const mgrScore  = scores.find(s => s.key_result_id === k.id && s.stage === 'manager')?.score ?? null
      const finScore  = scores.find(s => s.key_result_id === k.id && s.stage === 'final')?.score ?? k.final_score ?? null
      return {
        id: k.id,
        title: k.title,
        target_type: k.target_type,
        direction: k.direction ?? 'up',
        current_value: k.current_value,
        target_value: k.target_value,
        unit: k.unit,
        owner_id: k.owner_id,
        auto_score: auto,
        self_score: selfScore,
        manager_score: mgrScore,
        final_score: finScore,
      }
    })

    const autoObjScore = krs.length
      ? krs.reduce((s, k) => s + k.auto_score, 0) / krs.length
      : 0

    return {
      id: o.id,
      title: o.title,
      owner_id: o.owner_id,
      owner_name: o.owner?.full_name ?? null,
      owner_avatar: o.owner?.avatar_url ?? null,
      key_results: krs,
      auto_score: autoObjScore,
      self_review: selfReview ? {
        reflection_what_drove: selfReview.reflection_what_drove ?? '',
        reflection_improve: selfReview.reflection_improve ?? '',
        carry_forward: selfReview.carry_forward ?? 'no',
        overall_note: selfReview.overall_note ?? '',
        submitted_at: selfReview.submitted_at,
      } : null,
      manager_review: mgrReview ? {
        overall_note: mgrReview.overall_note ?? null,
        submitted_at: mgrReview.submitted_at,
      } : null,
    }
  })
}

// ── Submit self-assessment ─────────────────────────────────────────────────

export interface SelfAssessmentInput {
  objective_id: string
  cycle_id: string
  reviewer_id: string
  reflection_what_drove: string
  reflection_improve: string
  carry_forward: CarryForward
  overall_note: string
  kr_scores: { key_result_id: string; score: number }[]
}

export async function submitSelfAssessment(input: SelfAssessmentInput): Promise<void> {
  // Upsert objective review
  const { error: revErr } = await supabase
    .from('objective_reviews')
    .upsert({
      objective_id: input.objective_id,
      cycle_id: input.cycle_id,
      reviewer_id: input.reviewer_id,
      stage: 'self',
      reflection_what_drove: input.reflection_what_drove,
      reflection_improve: input.reflection_improve,
      carry_forward: input.carry_forward,
      overall_note: input.overall_note,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'objective_id,reviewer_id,stage' })
  if (revErr) throw revErr

  // Upsert KR scores
  if (input.kr_scores.length) {
    const { error: scoreErr } = await supabase
      .from('key_result_scores')
      .upsert(
        input.kr_scores.map(s => ({
          key_result_id: s.key_result_id,
          cycle_id: input.cycle_id,
          reviewer_id: input.reviewer_id,
          stage: 'self',
          score: s.score,
          scored_at: new Date().toISOString(),
        })),
        { onConflict: 'key_result_id,reviewer_id,stage' },
      )
    if (scoreErr) throw scoreErr
  }
}

// ── Team review (manager view) ────────────────────────────────────────────

export interface TeamMemberReview {
  person_id: string
  full_name: string
  avatar_url: string | null
  objectives: ReviewObjective[]
  self_complete: boolean
  manager_complete: boolean
}

export async function getTeamReviews(unitId: string, cycleId: string): Promise<TeamMemberReview[]> {
  // Get unit members
  const { data: members, error: memErr } = await supabase
    .from('people_units')
    .select('person_id, person:profiles!person_id(id, full_name, avatar_url)')
    .eq('unit_id', unitId)
  if (memErr) throw memErr

  const results: TeamMemberReview[] = []
  for (const m of (members ?? []) as any[]) {
    const items = await getMyReviewItems(m.person_id, cycleId)
    results.push({
      person_id: m.person_id,
      full_name: m.person?.full_name ?? 'Unknown',
      avatar_url: m.person?.avatar_url ?? null,
      objectives: items,
      self_complete: items.length > 0 && items.every(o => o.self_review?.submitted_at),
      manager_complete: items.length > 0 && items.every(o => o.manager_review?.submitted_at),
    })
  }
  return results
}

// ── Submit manager score override ─────────────────────────────────────────

export async function submitManagerScoreOverride(input: {
  key_result_id: string
  cycle_id: string
  reviewer_id: string
  score: number
  note: string
}): Promise<void> {
  const { error } = await supabase
    .from('key_result_scores')
    .upsert({
      key_result_id: input.key_result_id,
      cycle_id: input.cycle_id,
      reviewer_id: input.reviewer_id,
      stage: 'manager',
      score: input.score,
      note: input.note,
      scored_at: new Date().toISOString(),
    }, { onConflict: 'key_result_id,reviewer_id,stage' })
  if (error) throw error
}

export async function submitManagerObjectiveReview(input: {
  objective_id: string
  cycle_id: string
  reviewer_id: string
  overall_note: string
}): Promise<void> {
  const { error } = await supabase
    .from('objective_reviews')
    .upsert({
      objective_id: input.objective_id,
      cycle_id: input.cycle_id,
      reviewer_id: input.reviewer_id,
      stage: 'manager',
      overall_note: input.overall_note,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'objective_id,reviewer_id,stage' })
  if (error) throw error
}

// ── Cycle summary ─────────────────────────────────────────────────────────

export async function getCycleSummary(cycleId: string): Promise<CycleSummary> {
  const { data: cycle, error: cycErr } = await supabase
    .from('cycles')
    .select('id, label, year, quarter, start_date, end_date, status, review_open_at, review_closes_at, created_by')
    .eq('id', cycleId)
    .single()
  if (cycErr) throw cycErr

  const { data: objs, error: objErr } = await supabase
    .from('objectives')
    .select(`
      id, title, owner_id, final_score,
      owner:profiles!owner_id(id, full_name, avatar_url),
      key_results(id, title, target_type, direction, current_value, target_value, unit, owner_id, final_score),
      reviews:objective_reviews(stage, carry_forward, reflection_what_drove, reflection_improve, overall_note, submitted_at)
    `)
    .eq('cycle_id', cycleId)
  if (objErr) throw objErr

  // Get scores
  const krIds = ((objs ?? []) as any[]).flatMap((o: any) => (o.key_results ?? []).map((k: any) => k.id))
  const { data: scores } = krIds.length ? await supabase
    .from('key_result_scores')
    .select('*')
    .in('key_result_id', krIds)
    .eq('cycle_id', cycleId)
    .eq('stage', 'final') : { data: [] }

  const scoresByKrId = new Map<string, number>()
  ;((scores ?? []) as any[]).forEach((s: any) => scoresByKrId.set(s.key_result_id, s.score))

  const reviewObjs: ReviewObjective[] = ((objs ?? []) as any[]).map((o: any): ReviewObjective => {
    const selfReview = (o.reviews ?? []).find((r: any) => r.stage === 'self') ?? null
    const mgrReview  = (o.reviews ?? []).find((r: any) => r.stage === 'manager') ?? null

    const krs: ReviewKR[] = (o.key_results ?? []).map((k: any): ReviewKR => ({
      id: k.id,
      title: k.title,
      target_type: k.target_type,
      direction: k.direction ?? 'up',
      current_value: k.current_value,
      target_value: k.target_value,
      unit: k.unit,
      owner_id: k.owner_id,
      auto_score: computeAutoScore(k.current_value, k.target_value, k.target_type, k.direction ?? 'up'),
      self_score: null,
      manager_score: null,
      final_score: scoresByKrId.get(k.id) ?? k.final_score ?? null,
    }))

    const autoObjScore = krs.length ? krs.reduce((s, k) => s + k.auto_score, 0) / krs.length : 0

    return {
      id: o.id,
      title: o.title,
      owner_id: o.owner_id,
      owner_name: o.owner?.full_name ?? null,
      owner_avatar: o.owner?.avatar_url ?? null,
      key_results: krs,
      auto_score: autoObjScore,
      self_review: selfReview ? {
        reflection_what_drove: selfReview.reflection_what_drove ?? '',
        reflection_improve: selfReview.reflection_improve ?? '',
        carry_forward: selfReview.carry_forward ?? 'no',
        overall_note: selfReview.overall_note ?? '',
        submitted_at: selfReview.submitted_at,
      } : null,
      manager_review: mgrReview ? {
        overall_note: mgrReview.overall_note ?? null,
        submitted_at: mgrReview.submitted_at,
      } : null,
    }
  })

  const finalScores = reviewObjs.map(o => {
    const krs = o.key_results
    return avgScore(krs.map(k => k.final_score).filter(s => s != null) as number[]) ?? o.auto_score
  }).filter(s => s != null) as number[]
  const cycleScore = finalScores.length ? finalScores.reduce((a, b) => a + b, 0) / finalScores.length : null

  // Look up previous cycle score from archived cycles
  const { data: prevCycles } = await supabase
    .from('cycles')
    .select('id')
    .eq('year', (cycle as any).year)
    .eq('quarter', (cycle as any).quarter - 1)
    .eq('status', 'archived')
    .maybeSingle()

  let prevCycleScore: number | null = null
  if (prevCycles) {
    const { data: prevObjs } = await supabase
      .from('objectives')
      .select('final_score')
      .eq('cycle_id', (prevCycles as any).id)
      .not('final_score', 'is', null)
    if (prevObjs && prevObjs.length) {
      prevCycleScore = (prevObjs as any[]).reduce((s: number, o: any) => s + o.final_score, 0) / prevObjs.length
    }
  }

  return {
    cycle: cycle as unknown as FullCycle,
    objectives: reviewObjs,
    cycle_score: cycleScore,
    prev_cycle_score: prevCycleScore,
  }
}
