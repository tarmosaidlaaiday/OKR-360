import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────

export type UserStatus = 'active' | 'pending' | 'inactive'
export type UnitRole = 'admin' | 'member' | 'viewer' | 'lead' | 'contributor'

export interface ManagedUser {
  id: string
  full_name: string
  email: string | null
  avatar_url: string | null
  role: string | null           // job title / profile role
  job_title: string | null
  is_global_admin: boolean
  status: UserStatus
  invited_at: string | null
  last_active_at: string | null
  memberships: UserMembership[]
}

export interface UserMembership {
  id: string
  unit_id: string
  unit_name: string
  unit_level_color: string | null
  unit_level_name: string | null
  unit_level_depth: number | null
  role: UnitRole
  is_primary: boolean
}

export interface AdminScope {
  unit_id: string
  depth: number
}

// ── Fetch all users (scoped by RLS + app logic) ───────────────────────────

export async function listUsers(): Promise<ManagedUser[]> {
  // Step 1: fetch profiles (without new columns that may not exist yet)
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_url, role, job_title, is_global_admin, status, invited_at, last_active_at')
    .order('full_name', { ascending: true })

  if (profileError) {
    // Log full error details to help diagnose column/RLS issues
    console.error('[listUsers] profiles error:', {
      message: profileError.message,
      code: (profileError as any).code,
      details: (profileError as any).details,
      hint: (profileError as any).hint,
    })
    // Fallback: try with minimal columns only
    const { data: minData, error: minError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .order('full_name', { ascending: true })
    if (minError) throw new Error(`profiles: ${minError.message} (code: ${(minError as any).code})`)
    return ((minData ?? []) as any[]).map(p => ({
      id: p.id,
      full_name: p.full_name ?? p.id,
      email: null,
      avatar_url: p.avatar_url ?? null,
      role: null,
      job_title: null,
      is_global_admin: false,
      status: 'active' as UserStatus,
      invited_at: null,
      last_active_at: null,
      memberships: [],
    }))
  }

  // Step 2: fetch memberships with units (no levels join — simpler)
  const { data: memberData } = await supabase
    .from('people_units')
    .select('id, person_id, unit_id, role, is_primary, unit:units(id, name, level_id)')

  const membersByPerson: Record<string, any[]> = {}
  for (const m of (memberData ?? []) as any[]) {
    if (!membersByPerson[m.person_id]) membersByPerson[m.person_id] = []
    membersByPerson[m.person_id].push(m)
  }

  return ((profileData ?? []) as any[]).map(p => ({
    id: p.id,
    full_name: p.full_name ?? p.id,
    email: p.email ?? null,
    avatar_url: p.avatar_url ?? null,
    role: p.role ?? null,
    job_title: p.job_title ?? null,
    is_global_admin: p.is_global_admin ?? false,
    status: (p.status ?? 'active') as UserStatus,
    invited_at: p.invited_at ?? null,
    last_active_at: p.last_active_at ?? null,
    memberships: (membersByPerson[p.id] ?? []).map((m: any) => ({
      id: m.id,
      unit_id: m.unit_id,
      unit_name: m.unit?.name ?? '?',
      unit_level_color: null,
      unit_level_name: null,
      unit_level_depth: null,
      role: m.role as UnitRole,
      is_primary: m.is_primary,
    })),
  }))
}

// ── Get caller's admin scope ──────────────────────────────────────────────

export async function getAdminScope(personId: string): Promise<AdminScope[]> {
  const { data, error } = await supabase
    .rpc('get_admin_scope', { p_admin_id: personId })
  if (error) throw error
  return (data ?? []) as AdminScope[]
}

// ── Upsert unit membership (via SECURITY DEFINER fn) ─────────────────────

export async function upsertMembership(
  targetId: string,
  unitId: string,
  role: UnitRole,
  isPrimary = false,
): Promise<void> {
  const { error } = await supabase.rpc('admin_upsert_membership', {
    p_target_id: targetId,
    p_unit_id: unitId,
    p_role: role,
    p_primary: isPrimary,
  })
  if (error) throw error
}

// ── Remove unit membership ────────────────────────────────────────────────

export async function removeMembership(targetId: string, unitId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_membership', {
    p_target_id: targetId,
    p_unit_id: unitId,
  })
  if (error) throw error
}

// ── Set user status ───────────────────────────────────────────────────────

export async function setUserStatus(targetId: string, status: UserStatus): Promise<void> {
  const { error } = await supabase.rpc('admin_set_user_status', {
    p_target_id: targetId,
    p_status: status,
  })
  if (error) throw error
}

// ── Create user directly with password (calls Edge Function) ─────────────

export async function createUser(payload: {
  name: string
  email: string
  password: string
  unit_id: string
  role: UnitRole
  must_change_password: boolean
}): Promise<{ person_id: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'create', ...payload }),
  })

  const text = await resp.text()

  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`Edge function returned non-JSON (${resp.status}): ${text.slice(0, 200)}`) }
  if (json.error) throw new Error(json.error)
  return { person_id: json.person_id }
}

// ── Admin reset user password ─────────────────────────────────────────────

export async function resetUserPassword(personId: string, newPassword: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'reset-password', person_id: personId, new_password: newPassword }),
  })
  const text = await resp.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`Edge function error (${resp.status}): ${text.slice(0, 200)}`) }
  if (json.error) throw new Error(json.error)
}

// ── Email invitation (magic-link) ─────────────────────────────────────────

export async function inviteUser(payload: {
  full_name: string
  email: string
  unit_id: string
  role: UnitRole
  org_id: string
}): Promise<{ person_id: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'invite', ...payload }),
  })

  const text = await resp.text()
  let json: any
  try { json = JSON.parse(text) } catch {
    throw new Error(`Edge function returned non-JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (json.error) throw new Error(json.error)
  return { person_id: json.person_id }
}

export async function resendInvite(_payload: unknown): Promise<void> {
  // No-op: resend not yet implemented (use Supabase dashboard)
}
