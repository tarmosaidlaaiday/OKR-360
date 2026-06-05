-- Seed default hierarchy levels for any org that has none yet.
-- Uses a CTE so all four rows are inserted in one shot per org.

WITH orgs_without_levels AS (
  SELECT o.id AS org_id
  FROM public.organisations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.levels l WHERE l.org_id = o.id
  )
)
INSERT INTO public.levels (name, color, position, enabled, org_id)
SELECT d.name, d.color, d.position, true, o.org_id
FROM orgs_without_levels o
CROSS JOIN (VALUES
  ('Company',    '#6366f1', 0),
  ('Department', '#8b5cf6', 1),
  ('Team',       '#22c55e', 2)
) AS d(name, color, position);

SELECT 'default levels seeded for orgs without levels' AS status;
