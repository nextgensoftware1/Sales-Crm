-- Email marketing leads.
-- Run ONCE in the Supabase SQL Editor BEFORE deploying the matching code.
-- Safe to re-run.
--
--   * master_practices.lead_category — 'Email' for leads uploaded with
--     Lead_Category = Email (set only for NEW leads; existing leads are not
--     changed and keep working as call leads).
--   * lead_email_worksheets — the latest email work per lead per company
--     (email address + response). Shown on the Email Sheet Report page.
--   * lead_email_activity — every save, as history.
--   * save_email_worksheet(...) — one permission-checked save.

BEGIN;

ALTER TABLE public.master_practices ADD COLUMN IF NOT EXISTS lead_category text;
CREATE INDEX IF NOT EXISTS idx_master_practices_lead_category
  ON public.master_practices (lead_category) WHERE lead_category IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_email_worksheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.master_practices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text,
  response text NOT NULL,
  note text,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_email_worksheets_tenant_updated
  ON public.lead_email_worksheets (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_email_worksheets_updated_by
  ON public.lead_email_worksheets (updated_by);

CREATE TABLE IF NOT EXISTS public.lead_email_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.master_practices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  email text,
  response text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_email_activity_lead
  ON public.lead_email_activity (practice_id, tenant_id, created_at DESC);

-- Read access: own company, or Super Admin. (Writes go through the function.)
ALTER TABLE public.lead_email_worksheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_email_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_email_worksheets_scoped_read ON public.lead_email_worksheets;
CREATE POLICY lead_email_worksheets_scoped_read ON public.lead_email_worksheets
  FOR SELECT TO authenticated USING (
    tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active')
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
               WHERE u.auth_id = auth.uid() AND u.status = 'active' AND r.key = 'super_admin')
  );
DROP POLICY IF EXISTS lead_email_activity_scoped_read ON public.lead_email_activity;
CREATE POLICY lead_email_activity_scoped_read ON public.lead_email_activity
  FOR SELECT TO authenticated USING (
    tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active')
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id
               WHERE u.auth_id = auth.uid() AND u.status = 'active' AND r.key = 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.save_email_worksheet(
  p_practice_id uuid,
  p_email text,
  p_response text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_role text;
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_response text := NULLIF(btrim(p_response), '');
  v_note text := NULLIF(btrim(p_note), '');
  v_claim_tenant uuid;
  v_now timestamptz := now();
BEGIN
  SELECT u.* INTO v_user FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active';
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_user.role_id;
  IF v_user.tenant_id IS NULL THEN RAISE EXCEPTION 'A company account is required to save an email worksheet'; END IF;

  IF v_response IS NULL OR v_response NOT IN
    ('Not Found','Undeliverable','Unsubscribed','Email Sent','Got Reply','Not Considerable','Not Interested','Invalid') THEN
    RAISE EXCEPTION 'Choose a response';
  END IF;
  IF v_email IS NULL AND v_response IN ('Email Sent','Got Reply','Undeliverable','Unsubscribed','Not Interested') THEN
    RAISE EXCEPTION 'An email address is required for "%"', v_response;
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;
  IF length(COALESCE(v_note, '')) > 5000 THEN RAISE EXCEPTION 'Note is too long'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.master_practices mp
    WHERE mp.id = p_practice_id AND mp.deleted_at IS NULL
      AND lower(COALESCE(mp.lead_category, '')) = 'email'
      AND (mp.owner_tenant_id = v_user.tenant_id OR EXISTS (
        SELECT 1 FROM public.lead_allocations la
        WHERE la.practice_id = mp.id AND la.tenant_id = v_user.tenant_id AND la.status = 'active'))
  ) THEN RAISE EXCEPTION 'This email lead is not available to your company'; END IF;

  IF v_role IN ('agent', 'closer') AND NOT EXISTS (
    SELECT 1 FROM public.lead_assignments a
      WHERE a.practice_id = p_practice_id AND a.assigned_to = v_user.id AND a.status = 'active'
    UNION ALL
    SELECT 1 FROM public.lead_transfers t
      WHERE t.practice_id = p_practice_id AND t.to_user_id = v_user.id AND v_role = 'closer'
  ) THEN RAISE EXCEPTION 'This lead is not assigned to you'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_practice_id::text, 0));
  SELECT c.tenant_id INTO v_claim_tenant FROM public.lead_company_claims c
    WHERE c.practice_id = p_practice_id AND c.status = 'active' LIMIT 1;
  IF v_claim_tenant IS NOT NULL AND v_claim_tenant <> v_user.tenant_id THEN
    RAISE EXCEPTION 'This lead is claimed by another company';
  END IF;

  INSERT INTO public.lead_email_worksheets (practice_id, tenant_id, email, response, note, updated_by, updated_at)
  VALUES (p_practice_id, v_user.tenant_id, v_email, v_response, v_note, v_user.id, v_now)
  ON CONFLICT (practice_id, tenant_id) DO UPDATE SET
    email = EXCLUDED.email, response = EXCLUDED.response, note = EXCLUDED.note,
    updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.lead_email_activity (practice_id, tenant_id, agent_id, email, response, note, created_at)
  VALUES (p_practice_id, v_user.tenant_id, v_user.id, v_email, v_response, v_note, v_now);

  -- Status column on the Leads Engine shows the latest email response.
  UPDATE public.lead_assignments SET current_status = 'Email: ' || v_response, last_activity_at = v_now
    WHERE practice_id = p_practice_id AND assigned_to = v_user.id;

  RETURN jsonb_build_object('ok', true, 'response', v_response);
END;
$$;

REVOKE ALL ON FUNCTION public.save_email_worksheet(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_email_worksheet(uuid, text, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
