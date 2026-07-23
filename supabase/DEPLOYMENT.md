# Deployment Guide

This project has **three independent deployment surfaces**, each with its own pipeline.
A change committed to `main` does NOT automatically reach all three.
Missing a surface is the single most common source of production drift.

---

## Surface 1 — Frontend (Netlify)

**Auto-deploys** on every push to `main` via the Netlify Git integration.

**To verify it's current:**
- Check the Netlify dashboard deploy log, or run:
  ```
  git log origin/main --oneline -1   # last commit pushed
  ```
  and confirm the Netlify deploy timestamp matches.

---

## Surface 2 — Database migrations (Supabase)

**Auto-deploys via GitHub Actions** when `supabase/migrations/**` or `supabase/functions/**`
files change on `main`. The workflow is `.github/workflows/supabase-deploy.yml`.

**To check which migrations are unapplied:**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase migration list --linked
```
Rows where `remote` is blank have not been applied to production.

**To apply pending migrations manually (if CI failed):**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --linked
```

**Critical rules:**
- Never modify a migration file after it has been applied to production.
  Add a new migration instead.
- Never apply schema changes via the Supabase SQL Editor without also
  creating a corresponding migration file. The SQL Editor bypasses the
  migration tracking table — future rebuilds will miss the change.
- All migration statements should use `IF NOT EXISTS` / `OR REPLACE`
  so they are safe to re-run (idempotent).

**Access token:**
Generate one at https://supabase.com/dashboard/account/tokens
The token is personal — don't commit it. Store it in a password manager
or as `SUPABASE_ACCESS_TOKEN` in your shell profile for convenience.

---

## Surface 3 — Edge functions (Supabase)

**Auto-deploys via GitHub Actions** alongside migrations (same workflow).

**To deploy manually (if CI failed):**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy \
  --project-ref githzeldiwxkmruhaver
```

**To check what's deployed:**
Supabase Dashboard → Edge Functions → each function shows "Last updated" timestamp.
Cross-reference with `git log --oneline -- supabase/functions/<name>/index.ts`.

**Current functions:**
- `admin-create-user` — user invite/create/password-reset for admins
- `generate-sample-data` — seeds demo OKR data during onboarding

---

## Schema drift audit query

Run this in the Supabase SQL Editor to check that every table and column
referenced by the frontend exists in the live database.
**Both queries must return zero rows on a healthy database.**

```sql
-- ── Missing tables ──────────────────────────────────────────────────────────
SELECT tablename AS missing_table
FROM (VALUES
  ('checkin_streaks'),('checkins'),('comments'),('confidence_logs'),
  ('cycles'),('initiatives'),('key_result_scores'),('key_results'),
  ('kpi_snapshots'),('kpi_targets'),('kpis'),('kr_tasks'),('levels'),
  ('notification_preferences'),('notifications'),('objective_guardrail_kpis'),
  ('objective_reviews'),('objectives'),('one_on_one_entries'),('one_on_ones'),
  ('org_settings'),('organisations'),('pending_approvals'),('people_units'),
  ('profiles'),('retros'),('tasks'),('teams'),('units')
) AS t(tablename)
WHERE tablename NOT IN (
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
);

-- ── Missing columns ─────────────────────────────────────────────────────────
SELECT col.table_name, col.column_name AS missing_column
FROM (VALUES
  -- checkins (v2 columns)
  ('checkins','blocker_text'),('checkins','confidence'),('checkins','has_blocker'),
  ('checkins','new_value'),('checkins','note'),('checkins','person_id'),
  ('checkins','week_number'),('checkins','year'),
  -- key_results
  ('key_results','confidence'),('key_results','direction'),('key_results','final_score'),
  ('key_results','owner_id'),('key_results','start_value'),('key_results','target_type'),
  ('key_results','unit'),
  -- levels
  ('levels','color'),('levels','depth'),('levels','enabled'),
  -- notifications (v2 columns)
  ('notifications','action_url'),('notifications','read_at'),
  -- objective_guardrail_kpis (added 2026-07-12)
  ('objective_guardrail_kpis','objective_id'),('objective_guardrail_kpis','kpi_id'),
  ('objective_guardrail_kpis','created_by'),
  -- objective_reviews
  ('objective_reviews','carry_forward'),('objective_reviews','overall_note'),
  ('objective_reviews','reflection_improve'),('objective_reviews','reflection_what_drove'),
  -- one_on_one_entries
  ('one_on_one_entries','feedback_for_report'),('one_on_one_entries','feedback_from_report'),
  ('one_on_one_entries','happiness'),('one_on_one_entries','happiness_followup'),
  ('one_on_one_entries','last_saved_at'),('one_on_one_entries','personal_highlight'),
  ('one_on_one_entries','personal_low'),('one_on_one_entries','professional_highlight'),
  ('one_on_one_entries','professional_low'),('one_on_one_entries','work_blockers'),
  ('one_on_one_entries','work_needs_manager'),('one_on_one_entries','work_topics'),
  ('one_on_one_entries','work_wins'),
  -- profiles
  ('profiles','avatar_url'),('profiles','color'),('profiles','job_title'),('profiles','role'),
  -- teams
  ('teams','color'),
  -- units
  ('units','level_id'),('units','parent_id'),('units','position')
) AS col(table_name, column_name)
WHERE (col.table_name, col.column_name) NOT IN (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
);
```

---

## SECURITY DEFINER function inventory

Every time a SECURITY DEFINER function or storage RLS policy is added or modified,
run this query in the SQL Editor and compare against the checklist below:

```sql
SELECT n.nspname AS schema, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef = true
ORDER BY p.proname;
```

**Tenant-scoping checklist — apply to every SECURITY DEFINER function and every new RLS policy BEFORE merging:**

- [ ] **No org-widening fallback**: no `OR org_id IS NULL` or `OR tenant_id IS NULL` branches that silently widen scope to cross-tenant rows
- [ ] **Parameters validated against caller's org**: any `p_person_id`, `p_org_id`, `p_unit_id`, etc. accepted as input must be confirmed to belong to the same org as `auth.uid()` before acting on them — the function must not trust caller-supplied IDs blindly
- [ ] **No `WITH CHECK (true)`**: insert/update RLS policies must scope by org membership, not allow unrestricted writes (see the guardrail_insert policy for the correct pattern)
- [ ] **RLS still applies for plain reads within the function**: SECURITY DEFINER bypasses RLS by default — if the function SELECTs from tenant-scoped tables, include explicit `WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())` filters rather than relying on RLS to enforce them
- [ ] **Storage policies path-scoped**: storage INSERT/UPDATE/DELETE policies must check `(storage.foldername(name))[1]` matches the caller's own ID or org ID — not just `bucket_id`
- [ ] **No privilege escalation via EXECUTE**: every new function granted `EXECUTE TO authenticated` should be reviewed to confirm an authenticated user cannot use it to act on another org's data

### WARNING: Bare `true` policies are a recurring high-probability failure mode

This exact class of bug — `USING (true)` or `WITH CHECK (true)` on tenant-scoped tables — has
recurred **5 times in a single day** (2026-07-15). Treat every new migration as suspect until
the RLS checklist is explicitly completed. The pattern is always the same:

1. A migration creates a new table or policy with `USING (true)` as a "temporary" placeholder.
2. The migration is applied. The bug is now live.
3. A later audit catches it and a separate fix migration is required.

**Never ship a migration with `USING (true)`, `WITH CHECK (true)`, or `USING (auth.role() = 'authenticated')` on a multi-tenant table.** These are not defaults — they are security vulnerabilities.

---

**Known-clean functions (as of 2026-07-15, post definitive security sweep):**

Full audit run on 2026-07-15 (migration `20260715000003_fix_all_cross_tenant_rls.sql`).
All 22 SECURITY DEFINER functions reviewed; 4 newly fixed:
- `admin_upsert_membership` — now validates p_target_id and p_unit_id belong to caller's org ✓
- `clear_must_change_password` — now validates p_target_id belongs to caller's org ✓
- `seed_default_permissions` — now validates p_org_id = my_org_id() before seeding ✓
- `update_checkin_streak` — now validates p_person_id belongs to caller's org ✓

Functions confirmed clean (no caller-supplied IDs or org-validated):
- `sync_kr_on_checkin` — trigger, operates on `NEW` row only ✓
- `send_notification` — org-validates p_person_id against caller's org; drops cross-org silently ✓
- `handle_user_activation` — trigger on `auth.users`, no caller parameters ✓
- `my_org_id` — reads caller's own org from profiles; no parameters ✓

**RLS policies audited and fixed (2026-07-15):**
- `notifications.notif_insert_any` WITH CHECK (true) → replaced with org-scoped insert ✓
- `objectives`: "authenticated can read all" USING (auth.role()='authenticated') → org-scoped ✓
- `key_results`: "authenticated can read all" → org-scoped via objectives.org_id ✓
- `checkins`: "authenticated can read all" → org-scoped via key_results→objectives chain ✓
- `confidence_logs`: USING (true) → org-scoped via key_results→objectives chain ✓
- `kr_tasks`: USING (true) → org-scoped via key_results→objectives chain ✓
- `kr_scores`: USING (true) → org-scoped via cycles.org_id ✓
- `checkin_streaks`: USING (true) → org-scoped via profiles.org_id ✓
- `people_units`: USING (true) → org-scoped via org_id column ✓
- `tasks`: "read all" USING (auth.role()='authenticated') → owner_id = auth.uid() ✓
- `objective_guardrail_kpis`: no `WITH CHECK (true)` anywhere ✓
- `avatars` storage: write/update/delete gated on caller's own folder ✓

---

## CI: GitHub Actions

The workflow `.github/workflows/supabase-deploy.yml` runs automatically on every push
to `main` that touches `supabase/migrations/**` or `supabase/functions/**`.

**To verify the last run succeeded:**
- GitHub → Actions → "Deploy Supabase (migrations + edge functions)"
- Every merge that added migration files should have a green run.
- A yellow/orange run that was only manually triggered (not auto-triggered by a push)
  means the automatic path hasn't been exercised — re-check the workflow trigger paths.

**Required GitHub secrets** (Settings → Secrets and variables → Actions):
- `SUPABASE_ACCESS_TOKEN` — personal token from supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_REF` — `githzeldiwxkmruhaver`

If a run fails, the error will be in the "Push pending migrations" step.
The most common cause is an expired access token — regenerate and update the secret.

---

## Checklist before releasing a feature that touches the DB

- [ ] Migration file created in `supabase/migrations/` with timestamp prefix `YYYYMMDD_NNN_name.sql`
- [ ] Migration uses `IF NOT EXISTS` / `OR REPLACE` throughout (idempotent)
- [ ] Migration uses `IF NOT EXISTS` / `OR REPLACE` throughout (idempotent)
- [ ] If adding a SECURITY DEFINER function or RLS policy: full tenant-scoping checklist above completed
- [ ] `supabase db push --linked` run locally and output confirms 0 errors (or CI ran green)
- [ ] `supabase migration list --linked` shows no blank `remote` entries
- [ ] Schema drift audit query above updated to include any new tables/columns
- [ ] If edge functions changed: `supabase functions deploy <name>` run (or CI ran green)
- [ ] `npm run build` is clean

## Frontend access-control checklist

When adding a new page that should be admin-only:

- [ ] The route is nested inside `<Route element={<AdminRoute />}>` in `src/App.tsx` — **RLS alone is not sufficient** because it only gates data, not the page render
- [ ] `AdminRoute` calls `isOrgOrUnitAdmin(user.id)` (in `src/services/permissions.service.ts`) and redirects non-admins to `/dashboard`
- [ ] No admin-only sidebar link is shown to non-admins (check the `isAdmin` guard in `Sidebar.tsx`)

## Login brute-force protection

The login form includes a client-side exponential backoff (UX speed bump only — disables the
button for up to 60s after repeated failures). **This is not the real defence.**

**Required Supabase dashboard setting:** Auth → Rate limits → "Failed sign-in rate limit"  
Default is 30 per hour. For production, set this to ≤10 per hour per IP.  
This requires a **Supabase Pro plan** (rate limiting is not available on the free tier).

Without the server-side setting, a determined attacker can bypass the client-side backoff by
calling the Supabase Auth API directly.
