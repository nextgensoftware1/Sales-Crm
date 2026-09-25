-- Multi-company lead allocation, isolated worksheets, and first-company claim.
-- Run once in the Supabase SQL editor before deploying the matching app code.

BEGIN;

-- A lead may be allocated once to each company. Remove a legacy one-lead-only
-- constraint when it exists, then preserve the real allocation identity.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.lead_allocations'::regclass
      AND c.contype = 'u'
      AND (SELECT array_agg(a.attname ORDER BY key_position)
           FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, key_position)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum)
          = ARRAY['practice_id']::name[]
  LOOP
    EXECUTE format('ALTER TABLE public.lead_allocations DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

-- Some existing installations enforce exclusivity with a partial unique
-- index instead of a named table constraint.
DROP INDEX IF EXISTS public.uq_active_allocation_per_practice;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_allocations_practice_tenant
  ON public.lead_allocations (practice_id, tenant_id);

CREATE TABLE IF NOT EXISTS public.lead_company_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.master_practices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL REFERENCES public.users(id),
  trigger_disposition text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'sold', 'closed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid REFERENCES public.users(id),
  release_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_company_claims_one_active
  ON public.lead_company_claims (practice_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_lead_company_claims_tenant
  ON public.lead_company_claims (tenant_id, status, practice_id);

CREATE TABLE IF NOT EXISTS public.lead_worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.master_practices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_details text NOT NULL,
  additional_phone text,
  email text,
  concerned_person text,
  direct_line text,
  callback_at timestamptz,
  timezone text,
  disposition text NOT NULL DEFAULT 'New',
  updated_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_worksheets_tenant_updated
  ON public.lead_worksheets (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_worksheets_user_updated
  ON public.lead_worksheets (updated_by, updated_at DESC);

ALTER TABLE public.lead_company_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_worksheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_claims_authenticated_read ON public.lead_company_claims;
CREATE POLICY lead_claims_authenticated_read ON public.lead_company_claims
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lead_worksheets_scoped_read ON public.lead_worksheets;
CREATE POLICY lead_worksheets_scoped_read ON public.lead_worksheets
  FOR SELECT TO authenticated USING (
    tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.auth_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
      WHERE u.auth_id = auth.uid() AND r.key = 'super_admin'
    )
  );

-- Existing global worksheet values are copied to the company of the person who
-- last saved them. The original columns remain temporarily for rollback.
INSERT INTO public.lead_worksheets (
  practice_id, tenant_id, call_details, additional_phone, email,
  concerned_person, direct_line, callback_at, timezone, disposition,
  updated_by, updated_at, created_at
)
SELECT mp.id, u.tenant_id, COALESCE(mp.ws_call_details, 'Imported worksheet'),
  mp.ws_additional_phone, mp.ws_email, mp.ws_concerned_person,
  mp.ws_direct_line, mp.ws_callback_at, mp.ws_timezone,
  COALESCE(mp.ws_disposition, 'New'), mp.ws_updated_by,
  COALESCE(mp.ws_updated_at, now()), COALESCE(mp.ws_updated_at, now())
FROM public.master_practices mp
JOIN public.users u ON u.id = mp.ws_updated_by
WHERE mp.ws_updated_at IS NOT NULL AND u.tenant_id IS NOT NULL
ON CONFLICT (practice_id, tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_company_worksheet(
  p_practice_id uuid,
  p_call_details text,
  p_additional_phone text,
  p_email text,
  p_concerned_person text,
  p_direct_line text,
  p_callback_at timestamptz,
  p_timezone text,
  p_disposition text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_role text;
  v_claim public.lead_company_claims%ROWTYPE;
  v_now timestamptz := now();
  v_claiming boolean;
BEGIN
  SELECT u.* INTO v_user
  FROM public.users u
  WHERE u.auth_id = auth.uid() AND u.status = 'active';

  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_user.role_id;
  IF v_user.tenant_id IS NULL THEN RAISE EXCEPTION 'A company account is required to save a worksheet'; END IF;
  IF NULLIF(btrim(p_call_details), '') IS NULL THEN RAISE EXCEPTION 'Call details are required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.master_practices mp
    WHERE mp.id = p_practice_id AND mp.deleted_at IS NULL
      AND (mp.owner_tenant_id = v_user.tenant_id OR EXISTS (
        SELECT 1 FROM public.lead_allocations la
        WHERE la.practice_id = mp.id AND la.tenant_id = v_user.tenant_id AND la.status = 'active'
      ))
  ) THEN RAISE EXCEPTION 'This lead is not available to your company'; END IF;

  IF v_role IN ('agent', 'closer') AND NOT EXISTS (
    SELECT 1 FROM public.lead_assignments a
      WHERE a.practice_id = p_practice_id AND a.assigned_to = v_user.id AND a.status = 'active'
    UNION ALL
    SELECT 1 FROM public.lead_transfers t
      WHERE t.practice_id = p_practice_id AND t.to_user_id = v_user.id AND v_role = 'closer'
  ) THEN RAISE EXCEPTION 'This lead is not assigned to you'; END IF;

  v_claiming := lower(replace(btrim(p_disposition), ' ', '_')) = ANY
    (ARRAY['follow_up','interested','meeting','proposal','qualified','sold']);

  -- An advisory transaction lock makes the check/insert deterministic even
  -- when two companies save the same lead at the same instant.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_practice_id::text, 0));
  SELECT * INTO v_claim FROM public.lead_company_claims
    WHERE practice_id = p_practice_id AND status = 'active' LIMIT 1;

  IF v_claim.id IS NOT NULL AND v_claim.tenant_id <> v_user.tenant_id THEN
    RAISE EXCEPTION 'This lead was claimed by another company while you were working';
  END IF;

  IF v_claiming AND v_claim.id IS NULL THEN
    INSERT INTO public.lead_company_claims
      (practice_id, tenant_id, claimed_by, trigger_disposition)
    VALUES (p_practice_id, v_user.tenant_id, v_user.id, p_disposition);
  END IF;

  INSERT INTO public.lead_worksheets (
    practice_id, tenant_id, call_details, additional_phone, email,
    concerned_person, direct_line, callback_at, timezone, disposition,
    updated_by, updated_at
  ) VALUES (
    p_practice_id, v_user.tenant_id, btrim(p_call_details),
    NULLIF(btrim(p_additional_phone), ''), NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_concerned_person), ''), NULLIF(btrim(p_direct_line), ''),
    p_callback_at, NULLIF(btrim(p_timezone), ''), p_disposition,
    v_user.id, v_now
  ) ON CONFLICT (practice_id, tenant_id) DO UPDATE SET
    call_details = EXCLUDED.call_details,
    additional_phone = EXCLUDED.additional_phone,
    email = EXCLUDED.email,
    concerned_person = EXCLUDED.concerned_person,
    direct_line = EXCLUDED.direct_line,
    callback_at = EXCLUDED.callback_at,
    timezone = EXCLUDED.timezone,
    disposition = EXCLUDED.disposition,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  IF p_callback_at IS NOT NULL THEN
    INSERT INTO public.lead_reminders (practice_id, tenant_id, agent_id, remind_at, note)
    VALUES (p_practice_id, v_user.tenant_id, v_user.id, p_callback_at,
      'Callback (' || COALESCE(p_disposition, 'Worksheet') || ')');
  END IF;

  IF COALESCE(p_disposition, 'New') <> 'New' THEN
    INSERT INTO public.lead_activity (practice_id, tenant_id, agent_id, type, disposition, note)
    VALUES (p_practice_id, v_user.tenant_id, v_user.id, 'call', p_disposition, btrim(p_call_details));
    UPDATE public.lead_assignments SET current_status = p_disposition, last_activity_at = v_now
      WHERE practice_id = p_practice_id AND assigned_to = v_user.id;
  END IF;

  RETURN jsonb_build_object('claimed', v_claiming, 'tenant_id', v_user.tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_company_worksheet(uuid,text,text,text,text,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_company_worksheet(uuid,text,text,text,text,text,timestamptz,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_company_claim(
  p_practice_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE auth_id = auth.uid() AND status = 'active';
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_user.role_id;
  IF v_role NOT IN ('closer', 'company_admin') THEN
    RAISE EXCEPTION 'Only a closer or company admin may complete a company claim';
  END IF;
  UPDATE public.lead_company_claims
    SET status = CASE WHEN p_status IN ('sold','closed') THEN p_status ELSE 'released' END,
        released_at = now(), released_by = v_user.id, release_reason = p_reason
    WHERE practice_id = p_practice_id AND tenant_id = v_user.tenant_id AND status = 'active';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_company_claim(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_company_claim(uuid,text,text) TO authenticated;

COMMIT;
