// Cadence domain types — independent of the original OKR types

// OrgLevel — shape returned by the levels table join in objective hooks
export interface OrgLevel {
  id: string
  name: string
  depth: number
  color: string
}

// New configurable level (levels table)
export interface Level {
  id: string
  name: string
  color: string
  position: number  // 0 = top of hierarchy
  enabled: boolean
  org_id?: string
}

// Org unit (units table) — real named entities in the chart
export interface Unit {
  id: string
  name: string
  level_id: string | null
  parent_id: string | null
  position: number
  org_id?: string
}

// Cascade behaviour flags (org_settings table)
export interface OrgSettings {
  id?: string
  org_id?: string
  require_parent_link: boolean
  allow_cross_level: boolean
  individual_level_enabled: boolean
  show_alignment_gaps: boolean
  require_approval?: boolean
}

export interface Person {
  id: string
  name: string
  role: string
  initials: string
  color: string
  team_id?: string | null
  avatar_url?: string | null
}

export interface CadenceTeam {
  id: string
  name: string
  color?: string
  parent_id?: string | null
  level_id?: string | null
  level?: OrgLevel | null
  members: string[]  // person ids
}

export interface CadenceKeyResult {
  id: string
  objective_id: string
  title: string
  owner_id: string | null
  owner?: Person | null
  current_value: number
  target_value: number
  unit: string | null
  target_type: 'numeric' | 'percentage' | 'boolean'
  confidence: (number | null)[]  // per-week, 1–10
}

export interface CadenceObjective {
  id: string
  title: string
  description: string | null
  owner_id: string
  owner?: Person | null
  team_id: string | null
  team?: CadenceTeam | null
  cycle_id: string
  status: string
  // Cascade fields
  level_id: string | null
  level?: OrgLevel | null
  parent_objective_id: string | null
  parent_objective?: { id: string; title: string } | null
  // weekly confidence scores, one per quarter week (null = not yet logged)
  confidence: (number | null)[]
  key_results: CadenceKeyResult[]
  progress: number  // 0..1, computed client-side
}

export interface KPI {
  id: string
  name: string
  unit: string
  direction: 'up' | 'down'  // backward compat (old column)
  good: 'up' | 'down'       // new column — same semantics as direction
  role_name: string
  owner_id: string | null         // old column
  owner_person_id: string | null  // new column
  owner?: Person | null
  plan: number        // from kpi_targets.plan_value
  plan_to_date: number  // computed client-side
  actual: number      // from latest kpi_snapshots.value
  cycle_id?: string | null
  unit_id?: string | null
  trend: number[]     // last 13 kpi_snapshots values
}

export interface KpiSnapshot {
  id: string
  kpi_id: string
  value: number
  week_number: number
  year: number
  recorded_by: string | null
  recorded_at: string
}

export interface OneOnOneEntry {
  id: string
  one_on_one_id: string
  personal_highlight: string | null
  professional_highlight: string | null
  personal_low: string | null
  professional_low: string | null
  work_wins: string | null
  work_blockers: string | null
  work_needs_manager: string | null
  work_topics: string | null
  feedback_for_report: string | null
  feedback_from_report: string | null
  happiness: number | null
  happiness_followup: string | null
  submitted_at: string | null
  last_saved_at: string | null
}

export interface Initiative {
  id: string
  title: string
  owner_id: string | null          // legacy
  owner_person_id: string | null   // new
  owner?: Person | null
  unit_id?: string | null
  status: 'On track' | 'At risk' | 'Off track'
  progress: number  // 0..1
  due_label: string  // legacy
  due: string | null  // new (e.g. "Q3 2026")
  year: number | null
  cycle_id?: string | null
  created_by?: string | null
}

export interface Task {
  id: string
  title: string
  owner_id: string
  objective_id: string | null
  objective_label: string | null
  due_label: string
  due_date?: string | null
  done: boolean
}

export interface OneOnOne {
  id: string
  manager_id: string
  report_id: string
  report?: Person | null
  manager?: Person | null
  next_date: string | null      // old column
  scheduled_at: string | null   // new column
  happiness: number | null      // 1–10 (on old column or from entries)
  agenda: string | null
  done: boolean
  status: 'draft' | 'done' | null
  cycle_id: string | null
  summary: string | null
  entry?: OneOnOneEntry | null
}

export interface TweakValues {
  theme: 'warm' | 'cool' | 'mono'
  density: 'compact' | 'default' | 'comfy'
  accent: string
  dark: boolean
}

// ── Weekly check-in ──────────────────────────────────────────────────────

export interface WeeklyCheckin {
  id: string
  key_result_id: string
  person_id: string
  week_number: number
  year: number
  cycle_id: string
  new_value: number
  confidence: number
  will_score: number | null
  will_action: string | null
  has_blocker: boolean
  blocker_text: string | null
  note: string | null
  submitted_at: string
}

export interface CheckinKR extends CadenceKeyResult {
  objective_title: string
  objective_id: string
  this_week_checkin: WeeklyCheckin | null
  last_week_checkin: WeeklyCheckin | null
}

export interface CheckinStreak {
  person_id: string
  current_streak: number
  longest_streak: number
  last_checkin_week: number | null
  last_checkin_year: number | null
}

export interface AppNotification {
  id: string
  person_id: string
  type: 'checkin_due' | 'checkin_reminder' | 'blocker_flagged' | 'nudge'
    | 'review_open' | 'cycle_archived' | 'okr_unaligned' | 'invite_accepted'
  title: string
  body: string | null
  read: boolean
  read_at: string | null
  action_url: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface CheckinDraft {
  new_value: number
  confidence: number  // 0 = not yet set
  will_score: number  // 0 = not yet set
  will_action: string
  has_blocker: boolean
  blocker_text: string
  note: string
}

export interface IndividualRetro {
  id: string
  person_id: string
  week_number: number
  year: number
  parking_lot: string | null
  top_work: string | null
  notes_text: string | null
  feedforward: string | null
}

export interface PendingApproval {
  id: string
  person_id: string
  email: string
  full_name: string
  org_id: string
  requested_at: string
}

// ── People-unit membership ────────────────────────────────────────────────

export type PeopleUnitRole = 'member' | 'lead' | 'contributor' | 'admin' | 'viewer'

export interface PeopleUnit {
  id: string
  person_id: string
  unit_id: string
  role: PeopleUnitRole
  is_primary: boolean
  joined_at: string
  unit?: Unit
  person?: Person
}

// ── KR-level tasks ───────────────────────────────────────────────────────

export type KrTaskStatus = 'todo' | 'in_progress' | 'done'

export interface KrTask {
  id: string
  key_result_id: string
  title: string
  status: KrTaskStatus
  due_date: string | null
  assignee_id: string | null
  assignee?: { id: string; full_name: string; avatar_url: string | null; color: string } | null
  created_by: string
  created_at: string
}

// ── Cascade visibility ───────────────────────────────────────────────────

export interface VisibleUnit {
  unit_id: string
  unit_name: string
  depth: number
}

export const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  'On track':  { fg: '#1F7A4D', bg: 'color-mix(in oklab, #1F7A4D 12%, transparent)' },
  'At risk':   { fg: '#9A6A11', bg: 'color-mix(in oklab, #9A6A11 14%, transparent)' },
  'Off track': { fg: '#B23A3A', bg: 'color-mix(in oklab, #B23A3A 12%, transparent)' },
}

// Depth 0–4 level colors. Index = depth.
export const LEVEL_COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#22c55e', '#f97316'] as const

export function levelColor(depth: number | undefined | null): string {
  if (depth == null) return '#888'
  return LEVEL_COLORS[Math.min(depth, LEVEL_COLORS.length - 1)]
}
