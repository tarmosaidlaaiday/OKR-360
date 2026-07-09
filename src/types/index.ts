export type ObjectiveStatus = 'on_track' | 'at_risk' | 'behind' | 'completed'
export type KrTargetType = 'numeric' | 'percentage' | 'boolean'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  team_id: string | null
  org_id: string | null
  status?: string | null
  created_at: string
  must_change_password?: boolean
}

export interface Organisation {
  id: string
  name: string
  slug: string
  industry: string | null
  size: string | null
  plan: string
  trial_ends_at: string
  created_by: string | null
  created_at: string
  logo_url: string | null
  primary_color: string
}

export interface Team {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface Cycle {
  id: string
  year: number
  quarter: number
  label: string
  start_date: string
  end_date: string
  created_at: string
  period_type?: 'year' | 'half' | 'quarter'
  period_number?: number
}

export interface KeyResult {
  id: string
  objective_id: string
  title: string
  target_type: KrTargetType
  current_value: number
  target_value: number
  unit: string | null
  created_at: string
  updated_at: string
}

export interface Objective {
  id: string
  title: string
  description: string | null
  owner_id: string
  team_id: string | null
  unit_id?: string | null
  parent_objective_id?: string | null
  cycle_id: string
  status: ObjectiveStatus
  created_at: string
  updated_at: string
  // joined
  owner?: Profile
  unit?: { id: string; name: string; color?: string } | null
  key_results?: KeyResult[]
}

export interface Checkin {
  id: string
  key_result_id: string
  author_id: string
  value_at_checkin: number
  notes: string | null
  created_at: string
  // joined
  author?: Profile
  key_result?: KeyResult
}

// Form input types
export interface CreateObjectiveInput {
  title: string
  description?: string
  team_id?: string | null
  unit_id?: string | null
  parent_objective_id?: string | null
  cycle_id: string
  status: ObjectiveStatus
}

export interface UpdateObjectiveInput extends Partial<CreateObjectiveInput> {}

export interface CreateKeyResultInput {
  objective_id: string
  title: string
  target_type: KrTargetType
  target_value: number
  unit?: string | null
}

export interface UpdateKeyResultInput extends Partial<Omit<CreateKeyResultInput, 'objective_id'>> {
  current_value?: number
}

export interface CreateCheckinInput {
  key_result_id: string
  value_at_checkin: number
  notes?: string
}

export interface Comment {
  id: string
  org_id: string
  author_id: string
  objective_id: string | null
  key_result_id: string | null
  kpi_id: string | null
  body: string
  created_at: string
  updated_at: string
  author?: { full_name: string; avatar_url: string | null }
}
