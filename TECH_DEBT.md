# TECH_DEBT.md

Tracked schema and architectural debt. Each item includes the context needed
to pick it up in a future sprint without re-investigating.

---

## 1. Consolidate `teams` + `units` tables

**Status:** Deferred (2026-05-27)  
**Effort:** Medium — requires a DB migration + 4-5 file changes

### Background

The app has two overlapping concepts for org structure:

| Table | Columns | Used by |
|-------|---------|---------|
| `teams` | `id, name, description, parent_id, level_id` | `objectives.team_id`, `TeamsPage`, `SettingsPage`, `teams.service.ts` |
| `units` | `id, name, level_id, parent_id, position` | `people_units.unit_id`, `UnitPage`, `StructurePage`, all check-in/1:1/KPI queries |

`teams` is the legacy table from `schema.sql` (v1 design).  
`units` is the newer org-structure table from `schema-org-structure.sql` and is the primary entity everywhere except objectives.

### What needs to happen

1. **Add `unit_id` to `objectives`** (already done — `objectives.unit_id uuid REFERENCES units`).
2. **Backfill `objectives.unit_id`** from `objectives.team_id` — for each team, find or create the matching unit, then set `unit_id`.
3. **Update all objectives queries** to join `unit:units(id, name)` instead of `team:teams(id, name)`.
4. **Migrate `TeamsPage`** to show units instead of teams (or redirect `/teams` → `/units`).
5. **Drop `objectives.team_id`** FK and column.
6. **Consider dropping `teams` table** once no FK references remain.

### Files to change

- `src/services/objectives.service.ts` — remove `team:teams(id, name)` join
- `src/hooks/useCadenceObjectives.ts` — same
- `src/hooks/useMyFocusObjectives.ts` — same
- `src/hooks/useUnitDetail.ts` — same
- `src/pages/TeamsPage.tsx` — switch data source
- `src/pages/SettingsPage.tsx` — team selector → unit selector
- `src/services/teams.service.ts` — deprecate or remove
- `src/hooks/useTeams.ts` — deprecate or remove
- Migration: backfill + FK swap + optional DROP TABLE teams

### Risk

Medium. `objectives.team_id` is a non-null-constrained FK in some rows.
The backfill step must ensure every team has a corresponding unit before
dropping the column. Run in a transaction with a rollback test.

---

## 2. `permissions` table cleanup

**Status:** Deferred (2026-05-27)  
**Effort:** Low

`permissions` table exists and is populated by `seed_default_permissions(org_id)` 
(called during org provisioning by service_role). Zero frontend `.from()` calls.

If fine-grained permission checking is never built into the frontend, 
drop the table and remove the `seed_default_permissions` function in a future migration.

If it is built: create a `permissions.service.ts` and wire it into the auth/role check flow.

---

## 3. OrgLevel type rename

**Status:** Low priority

`OrgLevel` interface in `src/types/cadence.ts` was originally a legacy alias for 
the old `org_levels` table. After the 2026-05-27 consolidation, it now represents 
the shape of a `levels` table row as returned by PostgREST joins. The type is 
accurate but the name is misleading.

Consider renaming `OrgLevel` → `HierarchyLevel` in a future cleanup PR.
Grep scope: `src/types/cadence.ts` + everywhere `OrgLevel` is imported.
