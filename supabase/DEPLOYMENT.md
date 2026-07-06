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

**Does NOT auto-deploy.** Migrations in `supabase/migrations/` must be pushed manually.

**To apply pending migrations:**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db push --linked
```

**To check which migrations are unapplied:**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase migration list --linked
```
Rows where `remote` is blank have not been applied to production.

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

**Does NOT auto-deploy.** Each function under `supabase/functions/` must be
deployed separately with the CLI.

**To deploy a single function:**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy <function-name> --project-ref githzeldiwxkmruhaver
```

**To deploy all functions at once:**
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase functions deploy --project-ref githzeldiwxkmruhaver
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
referenced by the frontend exists in the live database:

```sql
-- Missing tables
SELECT tablename AS missing_table
FROM (VALUES
  ('checkin_streaks'),('checkins'),('comments'),('confidence_logs'),
  ('cycles'),('initiatives'),('key_result_scores'),('key_results'),
  ('kpi_snapshots'),('kpi_targets'),('kpis'),('kr_tasks'),('levels'),
  ('notification_preferences'),('notifications'),('objective_reviews'),
  ('objectives'),('one_on_one_entries'),('one_on_ones'),('org_settings'),
  ('organisations'),('pending_approvals'),('people_units'),('profiles'),
  ('retros'),('tasks'),('teams'),('units')
) AS t(tablename)
WHERE tablename NOT IN (
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
);

-- Missing columns (embedded PostgREST selects)
SELECT col.table_name, col.column_name AS missing_column
FROM (VALUES
  ('checkins','blocker_text'),('checkins','confidence'),('checkins','has_blocker'),
  ('checkins','new_value'),('checkins','note'),('checkins','person_id'),
  ('checkins','week_number'),('checkins','year'),
  ('key_results','confidence'),('key_results','direction'),('key_results','final_score'),
  ('key_results','owner_id'),('key_results','start_value'),('key_results','target_type'),
  ('key_results','unit'),
  ('levels','color'),('levels','depth'),('levels','enabled'),
  ('objective_reviews','carry_forward'),('objective_reviews','overall_note'),
  ('objective_reviews','reflection_improve'),('objective_reviews','reflection_what_drove'),
  ('one_on_one_entries','feedback_for_report'),('one_on_one_entries','feedback_from_report'),
  ('one_on_one_entries','happiness'),('one_on_one_entries','happiness_followup'),
  ('one_on_one_entries','last_saved_at'),('one_on_one_entries','personal_highlight'),
  ('one_on_one_entries','personal_low'),('one_on_one_entries','professional_highlight'),
  ('one_on_one_entries','professional_low'),('one_on_one_entries','work_blockers'),
  ('one_on_one_entries','work_needs_manager'),('one_on_one_entries','work_topics'),
  ('one_on_one_entries','work_wins'),
  ('profiles','avatar_url'),('profiles','color'),('profiles','job_title'),('profiles','role'),
  ('teams','color'),
  ('units','level_id'),('units','parent_id'),('units','position')
) AS col(table_name, column_name)
WHERE (col.table_name, col.column_name) NOT IN (
  SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
);
```

Both queries should return zero rows on a healthy database.

---

## Checklist before releasing a feature that touches the DB

- [ ] Migration file created in `supabase/migrations/` with timestamp prefix
- [ ] Migration uses `IF NOT EXISTS` / `OR REPLACE` throughout
- [ ] `supabase db push --linked` run and output confirms 0 errors
- [ ] `supabase migration list --linked` shows no blank `remote` entries
- [ ] If edge functions changed: `supabase functions deploy <name>` run
- [ ] `npm run build` is clean
