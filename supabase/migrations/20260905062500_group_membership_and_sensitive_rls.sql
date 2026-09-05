-- Foundation hardening 3B
-- Canonicalize group membership in group_physical_courts and remove public
-- access to data that participant-facing pages never need.

-- group_physical_courts is the canonical mapping between a group, the physical
-- display court number, and the underlying courts.id. Deleting a group should
-- remove only its mapping rows automatically.
ALTER TABLE public.group_physical_courts
  DROP CONSTRAINT IF EXISTS group_physical_courts_group_id_fkey;
ALTER TABLE public.group_physical_courts
  ADD CONSTRAINT group_physical_courts_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.court_groups(id) ON DELETE CASCADE;

-- Backfill membership for editable sessions created before the canonical mapping
-- was used. Ended sessions are intentionally skipped because archive-freeze
-- triggers forbid retroactive writes to ended-session operational tables.
-- court_units.group_court_numbers contains display numbers; the sibling court
-- units contain the real court_id for each display number in that same session.
INSERT INTO public.group_physical_courts (
  group_id,
  court_number,
  court_id,
  session_id
)
SELECT
  group_unit.court_group_id,
  member_number.court_number,
  court_unit.court_id,
  group_unit.session_id
FROM public.court_units group_unit
JOIN public.sessions s
  ON s.id = group_unit.session_id
 AND s.status <> 'ended'
CROSS JOIN LATERAL unnest(group_unit.group_court_numbers) AS member_number(court_number)
JOIN public.court_units court_unit
  ON court_unit.session_id = group_unit.session_id
 AND court_unit.type = 'court'
 AND court_unit.court_number = member_number.court_number
 AND court_unit.court_id IS NOT NULL
JOIN public.court_groups cg
  ON cg.id = group_unit.court_group_id
 AND cg.session_id = group_unit.session_id
WHERE group_unit.type = 'group'
  AND group_unit.court_group_id IS NOT NULL
  AND group_unit.session_id IS NOT NULL
  AND group_unit.group_court_numbers IS NOT NULL
ON CONFLICT (group_id, court_number, session_id)
DO UPDATE SET court_id = EXCLUDED.court_id;

CREATE UNIQUE INDEX IF NOT EXISTS group_physical_courts_group_court_session_idx
  ON public.group_physical_courts(group_id, court_id, session_id);

CREATE INDEX IF NOT EXISTS group_physical_courts_session_group_idx
  ON public.group_physical_courts(session_id, group_id, court_number);

-- Participant-facing pages do not need feedback, rotation diagnostics, or the
-- substitution audit trail. Keep those rows private to admins/service-role.
DROP POLICY IF EXISTS "Anyone can view feedback" ON public.feedback;
DROP POLICY IF EXISTS "Anyone can insert feedback" ON public.feedback;
DROP POLICY IF EXISTS "Admins can view feedback" ON public.feedback;
CREATE POLICY "Admins can view feedback"
  ON public.feedback FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view rotation_audit" ON public.rotation_audit;
DROP POLICY IF EXISTS "Admins can view rotation_audit" ON public.rotation_audit;
CREATE POLICY "Admins can view rotation_audit"
  ON public.rotation_audit FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Anyone can view match_substitutions" ON public.match_substitutions;
DROP POLICY IF EXISTS "Admins can view match_substitutions" ON public.match_substitutions;
CREATE POLICY "Admins can view match_substitutions"
  ON public.match_substitutions FOR SELECT
  TO authenticated
  USING (public.is_admin());
