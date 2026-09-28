-- Secure editing for worksheets created by the Super Admin CSV import.
-- Run once in the Supabase SQL editor after worksheet-csv-import.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.worksheet_import_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES public.master_practices(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  edited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_fields jsonb NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worksheet_import_updates_tenant_created
  ON public.worksheet_import_updates (tenant_id, created_at DESC);
ALTER TABLE public.worksheet_import_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worksheet_import_updates_admin_read ON public.worksheet_import_updates;
CREATE POLICY worksheet_import_updates_admin_read ON public.worksheet_import_updates
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.id = u.role_id
      WHERE u.auth_id = auth.uid()
        AND u.status = 'active'
        AND (
          r.key = 'super_admin'
          OR (r.key IN ('company_admin','manager','team_lead') AND u.tenant_id = worksheet_import_updates.tenant_id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.update_imported_worksheet(
  p_tenant_id uuid,
  p_practice_id uuid,
  p_import_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_tenant_id uuid;
  v_role text;
  v_existing jsonb;
  v_changed jsonb;
  v_changed_count integer;
BEGIN
  SELECT u.id, u.tenant_id, r.key
  INTO v_user_id, v_user_tenant_id, v_role
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE u.auth_id = auth.uid() AND u.status = 'active';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_role NOT IN ('super_admin','company_admin','manager','team_lead','agent','closer') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_role <> 'super_admin' AND v_user_tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'This worksheet belongs to another company';
  END IF;
  IF jsonb_typeof(p_import_data) IS DISTINCT FROM 'object' OR p_import_data = '{}'::jsonb THEN
    RAISE EXCEPTION 'Worksheet fields must be a non-empty object';
  END IF;

  SELECT import_data INTO v_existing
  FROM public.lead_worksheets
  WHERE tenant_id = p_tenant_id
    AND practice_id = p_practice_id
    AND import_data IS NOT NULL
    AND (v_role NOT IN ('agent','closer') OR updated_by = v_user_id)
  FOR UPDATE;

  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'Worksheet not found or unavailable';
  END IF;
  -- Editing may change values, but it must never silently add or remove columns.
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_existing) AS keys(k))
     IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_import_data) AS keys(k)) THEN
    RAISE EXCEPTION 'Worksheet columns do not match the imported file';
  END IF;

  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object(
    'before', v_existing->k,
    'after', p_import_data->k
  )), '{}'::jsonb)
  INTO v_changed
  FROM jsonb_object_keys(v_existing) AS keys(k)
  WHERE v_existing->k IS DISTINCT FROM p_import_data->k;

  IF v_changed = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'message', 'No worksheet values changed.');
  END IF;
  SELECT count(*) INTO v_changed_count FROM jsonb_object_keys(v_changed);

  INSERT INTO public.worksheet_import_updates(
    practice_id, tenant_id, edited_by, changed_fields, before_data, after_data
  ) VALUES (
    p_practice_id, p_tenant_id, v_user_id, v_changed, v_existing, p_import_data
  );

  UPDATE public.lead_worksheets
  SET import_data = p_import_data,
      call_details = COALESCE(p_import_data->>'Notes', call_details),
      additional_phone = CASE WHEN p_import_data ? 'Secondary Phone' THEN NULLIF(p_import_data->>'Secondary Phone', '') ELSE additional_phone END,
      concerned_person = CASE WHEN p_import_data ? 'Provider''s Name' THEN NULLIF(p_import_data->>'Provider''s Name', '') ELSE concerned_person END,
      direct_line = CASE WHEN p_import_data ? 'Phone Number' THEN NULLIF(p_import_data->>'Phone Number', '') ELSE direct_line END,
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND practice_id = p_practice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', format('Worksheet saved successfully. %s field(s) updated.', v_changed_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_imported_worksheet(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_imported_worksheet(uuid,uuid,jsonb) TO authenticated;

COMMIT;
