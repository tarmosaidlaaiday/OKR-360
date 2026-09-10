-- Team Meetings: unit-scoped meeting management with monthly management rhythm.
-- Three tables: team_meetings (the meeting itself), team_meeting_participants
-- (who attends a specific meeting instance), and team_meeting_commitments
-- (per-person action items that carry forward when unresolved).
--
-- RLS philosophy:
--   team_meetings has org_id directly → direct subquery comparison (personal_tasks pattern).
--   participants and commitments have no org_id → EXISTS through team_meetings (unavoidable).
--   Write access on meetings/participants: unit lead or global admin for that specific unit.
--   Write access on commitments: any org member adding their own (person_id = auth.uid()),
--   OR a unit lead adding for others.

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_meetings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  cycle_id     uuid REFERENCES public.cycles(id),
  scheduled_at timestamptz NOT NULL,
  recurrence   text NOT NULL DEFAULT 'none', -- 'none' | 'weekly' | 'biweekly' | 'monthly'
  status       text NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'completed' | 'cancelled'
  plan_notes   text,
  created_by   uuid NOT NULL REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_meeting_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_meeting_id uuid NOT NULL REFERENCES public.team_meetings(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE(team_meeting_id, person_id)
);

CREATE TABLE IF NOT EXISTS public.team_meeting_commitments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_meeting_id         uuid NOT NULL REFERENCES public.team_meetings(id) ON DELETE CASCADE,
  person_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  description             text NOT NULL,
  linked_task_id          uuid REFERENCES public.personal_tasks(id) ON DELETE SET NULL,
  carried_forward_from_id uuid REFERENCES public.team_meeting_commitments(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_meeting_commitments ENABLE ROW LEVEL SECURITY;

-- ─── team_meetings RLS ───────────────────────────────────────────────────────

-- Read: any org member can see meetings in their org
DO $$ BEGIN
  CREATE POLICY "team_meetings_read" ON public.team_meetings
    FOR SELECT TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Insert: global admin OR lead/admin of THIS specific unit; created_by must be the caller
DO $$ BEGIN
  CREATE POLICY "team_meetings_insert" ON public.team_meetings
    FOR INSERT TO authenticated
    WITH CHECK (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND created_by = auth.uid()
      AND (
        public.is_global_admin()
        OR EXISTS (
          SELECT 1 FROM public.people_units
           WHERE person_id = auth.uid()
             AND unit_id = team_meetings.unit_id
             AND role IN ('admin', 'lead')
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Update: global admin OR lead/admin of THIS specific unit
DO $$ BEGIN
  CREATE POLICY "team_meetings_update" ON public.team_meetings
    FOR UPDATE TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND (
        public.is_global_admin()
        OR EXISTS (
          SELECT 1 FROM public.people_units
           WHERE person_id = auth.uid()
             AND unit_id = team_meetings.unit_id
             AND role IN ('admin', 'lead')
        )
      )
    )
    WITH CHECK (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Delete: global admin OR lead/admin of THIS specific unit
DO $$ BEGIN
  CREATE POLICY "team_meetings_delete" ON public.team_meetings
    FOR DELETE TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND (
        public.is_global_admin()
        OR EXISTS (
          SELECT 1 FROM public.people_units
           WHERE person_id = auth.uid()
             AND unit_id = team_meetings.unit_id
             AND role IN ('admin', 'lead')
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── team_meeting_participants RLS ───────────────────────────────────────────

-- Read: any org member (access scoped via parent team_meeting's org_id)
DO $$ BEGIN
  CREATE POLICY "team_meeting_participants_read" ON public.team_meeting_participants
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_participants.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Insert: unit lead/admin for the meeting's unit
DO $$ BEGIN
  CREATE POLICY "team_meeting_participants_insert" ON public.team_meeting_participants
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_participants.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
           AND (
             public.is_global_admin()
             OR EXISTS (
               SELECT 1 FROM public.people_units pu
                WHERE pu.person_id = auth.uid()
                  AND pu.unit_id = tm.unit_id
                  AND pu.role IN ('admin', 'lead')
             )
           )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Delete: same as insert
DO $$ BEGIN
  CREATE POLICY "team_meeting_participants_delete" ON public.team_meeting_participants
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_participants.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
           AND (
             public.is_global_admin()
             OR EXISTS (
               SELECT 1 FROM public.people_units pu
                WHERE pu.person_id = auth.uid()
                  AND pu.unit_id = tm.unit_id
                  AND pu.role IN ('admin', 'lead')
             )
           )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── team_meeting_commitments RLS ────────────────────────────────────────────

-- Read: any org member
DO $$ BEGIN
  CREATE POLICY "team_meeting_commitments_read" ON public.team_meeting_commitments
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_commitments.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Insert: any org member adding their own commitment, OR unit lead adding for others
DO $$ BEGIN
  CREATE POLICY "team_meeting_commitments_insert" ON public.team_meeting_commitments
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_commitments.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
      AND (
        -- Adding your own commitment
        team_meeting_commitments.person_id = auth.uid()
        OR public.is_global_admin()
        -- Unit lead adding for a participant
        OR EXISTS (
          SELECT 1 FROM public.team_meetings tm
           WHERE tm.id = team_meeting_commitments.team_meeting_id
             AND EXISTS (
               SELECT 1 FROM public.people_units pu
                WHERE pu.person_id = auth.uid()
                  AND pu.unit_id = tm.unit_id
                  AND pu.role IN ('admin', 'lead')
             )
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Update: own commitment, unit lead, or global admin
DO $$ BEGIN
  CREATE POLICY "team_meeting_commitments_update" ON public.team_meeting_commitments
    FOR UPDATE TO authenticated
    USING (
      team_meeting_commitments.person_id = auth.uid()
      OR public.is_global_admin()
      OR EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_commitments.team_meeting_id
           AND EXISTS (
             SELECT 1 FROM public.people_units pu
              WHERE pu.person_id = auth.uid()
                AND pu.unit_id = tm.unit_id
                AND pu.role IN ('admin', 'lead')
           )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_commitments.team_meeting_id
           AND tm.org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Delete: same as update
DO $$ BEGIN
  CREATE POLICY "team_meeting_commitments_delete" ON public.team_meeting_commitments
    FOR DELETE TO authenticated
    USING (
      team_meeting_commitments.person_id = auth.uid()
      OR public.is_global_admin()
      OR EXISTS (
        SELECT 1 FROM public.team_meetings tm
         WHERE tm.id = team_meeting_commitments.team_meeting_id
           AND EXISTS (
             SELECT 1 FROM public.people_units pu
              WHERE pu.person_id = auth.uid()
                AND pu.unit_id = tm.unit_id
                AND pu.role IN ('admin', 'lead')
           )
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
