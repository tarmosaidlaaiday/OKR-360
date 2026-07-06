import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreatePayload {
  action?: 'create' | 'invite' | 'reset-password'
  // create / invite
  name?: string
  email?: string
  password?: string
  unit_id?: string
  role?: string
  must_change_password?: boolean
  org_id?: string
  // reset-password
  person_id?: string
  new_password?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Service-role client — bypasses RLS, can call auth.admin.*
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify the calling user is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } =
      await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) throw new Error('Not authenticated')

    // Verify caller is global admin or unit admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('is_global_admin, org_id')
      .eq('id', caller.id)
      .single()

    if (!callerProfile?.is_global_admin) {
      // Check if caller has any admin role in people_units
      const { data: adminRows } = await supabaseAdmin
        .from('people_units')
        .select('id')
        .eq('person_id', caller.id)
        .in('role', ['admin', 'lead'])
        .limit(1)
      if (!adminRows || adminRows.length === 0) {
        throw new Error('Forbidden: admin privileges required')
      }
    }

    // Caller must belong to an org — derive org_id from their profile rather
    // than trusting payload.org_id, which would allow cross-tenant assignment.
    const callerOrgId = callerProfile?.org_id
    if (!callerOrgId) throw new Error('Forbidden: caller has no org assigned')

    const payload: CreatePayload = await req.json()
    const action = payload.action ?? 'create'

    // ── Action: reset-password ────────────────────────────────────────────
    if (action === 'reset-password') {
      const { person_id, new_password } = payload
      if (!person_id || !new_password) throw new Error('person_id and new_password required')

      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(
        person_id,
        { password: new_password },
      )
      if (pwErr) throw pwErr

      const { error: profileErr } = await supabaseAdmin
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', person_id)
      if (profileErr) throw new Error(`profiles update: ${profileErr.message}`)

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Action: invite ────────────────────────────────────────────────────
    if (action === 'invite') {
      const { email, unit_id, role = 'member' } = payload
      if (!email || !unit_id) throw new Error('email and unit_id are required')

      // Fetch org name for personalised email subject/body
      const { data: orgRow } = await supabaseAdmin
        .from('organisations')
        .select('name')
        .eq('id', callerOrgId)
        .single()
      const orgName = orgRow?.name ?? 'your organisation'

      const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:5173'
      const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          data: { org_name: orgName },
          redirectTo: `${siteUrl}/onboarding/profile`,
        },
      )
      if (inviteErr) throw inviteErr

      const userId = inviteData.user.id

      // Upsert profile with pending status + org assignment.
      // org_id is always taken from the caller's profile — never from payload.
      // The on_auth_user_created trigger may have already inserted a row with
      // org_id = NULL; this upsert must override that.
      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
        id: userId,
        email,
        org_id: callerOrgId,
        status: 'pending',
        must_change_password: false,
      }, { onConflict: 'id' })
      if (profileErr) throw new Error(`profiles upsert: ${profileErr.message}`)

      // Assign primary unit membership
      const { error: unitErr } = await supabaseAdmin.from('people_units').insert({
        person_id: userId,
        unit_id,
        role,
        is_primary: true,
        org_id: callerOrgId,
      })
      // A duplicate (person already in this unit) is not fatal — log but continue
      if (unitErr && !unitErr.message.includes('duplicate')) {
        console.error('people_units insert error:', unitErr.message)
      }

      // Log to audit_log (best-effort — don't fail the invite if this errors)
      await supabaseAdmin.from('audit_log').insert({
        org_id: callerOrgId,
        actor_id: caller.id,
        action: 'user.invited',
        target_type: 'profile',
        target_id: userId,
        metadata: { email, unit_id, role },
      }).then(() => {})

      return new Response(
        JSON.stringify({ person_id: userId, success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Action: create ────────────────────────────────────────────────────
    const { name, email, password, unit_id, role = 'member', must_change_password = true } = payload
    if (!name || !email || !password || !unit_id) {
      throw new Error('name, email, password, and unit_id are required')
    }

    // 1. Create auth user (email already confirmed — no email verification step)
    const { data: createdUser, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      })
    if (createErr) throw createErr
    const userId = createdUser.user!.id

    // 2. Upsert profile (the on_auth_user_created trigger may have already fired)
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: name,
        email,
        org_id: callerOrgId,
        status: 'active',
        must_change_password,
      }, { onConflict: 'id' })
    if (profileErr) throw new Error(`profiles upsert: ${profileErr.message}`)

    // 3. Add primary unit membership
    const { error: unitErr } = await supabaseAdmin
      .from('people_units')
      .insert({
        person_id: userId,
        unit_id,
        role,
        is_primary: true,
        org_id: callerOrgId,
      })
    if (unitErr && !unitErr.message.includes('duplicate')) {
      throw new Error(`people_units insert: ${unitErr.message}`)
    }

    return new Response(
      JSON.stringify({ person_id: userId, success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
