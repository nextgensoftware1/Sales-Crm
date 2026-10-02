-- Atomically move an active lead assignment to another eligible user.
-- Run once in the Supabase SQL editor before deploying the matching app code.

BEGIN;

CREATE OR REPLACE FUNCTION public.reassign_worksheet_lead(
  p_practice_id uuid,
  p_tenant_id uuid,
  p_agent_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_role text;
  v_target_role text;
  v_level integer;
  v_target_level integer;
  v_owner_tenant uuid;
  v_claim_tenant uuid;
  v_origin_user uuid;
  v_current_status text;
  v_now timestamptz := now();
BEGIN
  SELECT u.* INTO v_user
  FROM public.users u
  WHERE u.auth_id = auth.uid() AND u.status = 'active';
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT r.key, r.level INTO v_role, v_level
  FROM public.roles r WHERE r.id = v_user.role_id;

  SELECT u.* INTO v_target
  FROM public.users u
  WHERE u.id = p_agent_user_id AND u.status = 'active';
  IF v_target.id IS NULL OR v_target.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Choose an active team member from this company';
  END IF;
  SELECT r.key, r.level INTO v_target_role, v_target_level
  FROM public.roles r WHERE r.id = v_target.role_id;

  IF v_role = 'super_admin' THEN
    IF v_target_role NOT IN ('agent', 'closer') THEN
      RAISE EXCEPTION 'Super Admin can assign worksheets to an Agent or Closer';
    END IF;
  ELSE
    IF v_role NOT IN ('company_admin', 'manager', 'team_lead') THEN
      RAISE EXCEPTION 'You are not allowed to reassign leads';
    END IF;
    IF v_user.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'This worksheet belongs to another company';
    END IF;
    IF v_target_level IS NULL OR v_level IS NULL OR v_target_level <= v_level THEN
      RAISE EXCEPTION 'You can only assign leads to a more junior team member';
    END IF;
  END IF;

  -- Serialize reassignment with worksheet saves and other claim-changing work.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_practice_id::text, 0));

  SELECT mp.owner_tenant_id INTO v_owner_tenant
  FROM public.master_practices mp
  WHERE mp.id = p_practice_id AND mp.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_worksheets w
    WHERE w.practice_id = p_practice_id AND w.tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'Worksheet not found for this company'; END IF;

  IF v_owner_tenant IS DISTINCT FROM p_tenant_id AND NOT EXISTS (
    SELECT 1 FROM public.lead_allocations a
    WHERE a.practice_id = p_practice_id AND a.tenant_id = p_tenant_id AND a.status = 'active'
  ) THEN RAISE EXCEPTION 'This lead is not owned or allocated to this company'; END IF;

  SELECT c.tenant_id INTO v_claim_tenant
  FROM public.lead_company_claims c
  WHERE c.practice_id = p_practice_id AND c.status = 'active'
  LIMIT 1;
  IF v_claim_tenant IS NOT NULL AND v_claim_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'This lead is claimed by another company';
  END IF;

  SELECT w.disposition INTO v_current_status
  FROM public.lead_worksheets w
  WHERE w.practice_id = p_practice_id AND w.tenant_id = p_tenant_id;

  SELECT a.origin_user_id INTO v_origin_user
  FROM public.lead_assignments a
  WHERE a.practice_id = p_practice_id AND a.tenant_id = p_tenant_id
  ORDER BY a.assigned_at ASC
  LIMIT 1;

  UPDATE public.lead_assignments
  SET status = 'inactive'
  WHERE practice_id = p_practice_id AND tenant_id = p_tenant_id AND status = 'active';

  INSERT INTO public.lead_assignments (
    practice_id, tenant_id, assigned_to, assigned_by, origin_user_id,
    assigned_at, status, current_status, last_activity_at
  ) VALUES (
    p_practice_id, p_tenant_id, v_target.id, v_user.id,
    COALESCE(v_origin_user, v_user.id), v_now, 'active', v_current_status, v_now
  )
  ON CONFLICT (practice_id, assigned_to) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    assigned_by = EXCLUDED.assigned_by,
    origin_user_id = COALESCE(public.lead_assignments.origin_user_id, EXCLUDED.origin_user_id),
    assigned_at = EXCLUDED.assigned_at,
    status = 'active',
    current_status = COALESCE(EXCLUDED.current_status, public.lead_assignments.current_status),
    last_activity_at = EXCLUDED.last_activity_at;

  INSERT INTO public.lead_activity (
    practice_id, tenant_id, agent_id, type, disposition, note
  ) VALUES (
    p_practice_id, p_tenant_id, v_user.id, 'status_change',
    'Reassigned to ' || v_target.full_name,
    'Lead reassigned by ' || v_user.full_name
  );

  RETURN jsonb_build_object('assigned_to', v_target.id, 'assigned_by', v_user.id);
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_worksheet_lead(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_worksheet_lead(uuid, uuid, uuid) TO authenticated;

COMMIT;
