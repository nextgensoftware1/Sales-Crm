-- Atomic Super Admin worksheet CSV import. Run once in the Supabase SQL editor.
BEGIN;

CREATE TABLE IF NOT EXISTS public.worksheet_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.users(id),
  row_count integer NOT NULL CHECK (row_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.worksheet_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.worksheet_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  practice_id uuid NOT NULL REFERENCES public.master_practices(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  agent_id uuid NOT NULL REFERENCES public.users(id),
  raw_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS import_data jsonb;
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS imported_at timestamptz;
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES public.users(id);
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.worksheet_import_batches(id);

-- Import history must not block existing user, company, or lead deletion.
-- raw_data remains available even after one of those referenced records goes.
ALTER TABLE public.worksheet_import_batches ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE public.worksheet_import_batches DROP CONSTRAINT IF EXISTS worksheet_import_batches_uploaded_by_fkey;
ALTER TABLE public.worksheet_import_batches ADD CONSTRAINT worksheet_import_batches_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.worksheet_import_rows ALTER COLUMN practice_id DROP NOT NULL;
ALTER TABLE public.worksheet_import_rows ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.worksheet_import_rows ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE public.worksheet_import_rows DROP CONSTRAINT IF EXISTS worksheet_import_rows_practice_id_fkey;
ALTER TABLE public.worksheet_import_rows ADD CONSTRAINT worksheet_import_rows_practice_id_fkey
  FOREIGN KEY (practice_id) REFERENCES public.master_practices(id) ON DELETE SET NULL;
ALTER TABLE public.worksheet_import_rows DROP CONSTRAINT IF EXISTS worksheet_import_rows_tenant_id_fkey;
ALTER TABLE public.worksheet_import_rows ADD CONSTRAINT worksheet_import_rows_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.worksheet_import_rows DROP CONSTRAINT IF EXISTS worksheet_import_rows_agent_id_fkey;
ALTER TABLE public.worksheet_import_rows ADD CONSTRAINT worksheet_import_rows_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_worksheets DROP CONSTRAINT IF EXISTS lead_worksheets_imported_by_fkey;
ALTER TABLE public.lead_worksheets ADD CONSTRAINT lead_worksheets_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_worksheets DROP CONSTRAINT IF EXISTS lead_worksheets_import_batch_id_fkey;
ALTER TABLE public.lead_worksheets ADD CONSTRAINT lead_worksheets_import_batch_id_fkey
  FOREIGN KEY (import_batch_id) REFERENCES public.worksheet_import_batches(id) ON DELETE SET NULL;

ALTER TABLE public.worksheet_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worksheet_import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worksheet_import_batches_super_admin_read ON public.worksheet_import_batches;
CREATE POLICY worksheet_import_batches_super_admin_read ON public.worksheet_import_batches FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id WHERE u.auth_id = auth.uid() AND r.key = 'super_admin')
);
DROP POLICY IF EXISTS worksheet_import_rows_super_admin_read ON public.worksheet_import_rows;
CREATE POLICY worksheet_import_rows_super_admin_read ON public.worksheet_import_rows FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.users u JOIN public.roles r ON r.id = u.role_id WHERE u.auth_id = auth.uid() AND r.key = 'super_admin')
);

CREATE OR REPLACE FUNCTION public.import_worksheet_csv(p_filename text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.users%ROWTYPE; v_role text; v_batch uuid; v_row jsonb;
  v_tenant uuid; v_agent uuid; v_practice uuid; v_claim_tenant uuid;
  v_errors jsonb := '[]'::jsonb; v_count integer := 0; v_matches integer;
  v_callback timestamptz; v_timezone text;
BEGIN
  SELECT u.* INTO v_admin FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active';
  IF v_admin.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_admin.role_id;
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION 'Only a Super Admin can import worksheets'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Upload must contain between 1 and 2,000 rows';
  END IF;

  -- Resolve every foreign key first. Returning here guarantees no partial import.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT count(*), (array_agg(id))[1] INTO v_matches, v_tenant FROM public.tenants
      WHERE status = 'active' AND NOT COALESCE(is_platform, false)
        AND lower(btrim(name)) = lower(btrim(v_row->>'company_name'));
    IF v_matches <> 1 THEN v_errors := v_errors || jsonb_build_array(format('Row %s: company "%s" was %s.', v_row->>'row_number', v_row->>'company_name', CASE WHEN v_matches=0 THEN 'not found' ELSE 'ambiguous' END)); CONTINUE; END IF;

    SELECT count(*), (array_agg(u.id))[1] INTO v_matches, v_agent FROM public.users u
      WHERE u.tenant_id = v_tenant AND u.status = 'active' AND lower(btrim(u.full_name)) = lower(btrim(v_row->>'agent_name'));
    IF v_matches <> 1 THEN v_errors := v_errors || jsonb_build_array(format('Row %s: active user "%s" was %s in that company.', v_row->>'row_number', v_row->>'agent_name', CASE WHEN v_matches=0 THEN 'not found' ELSE 'ambiguous' END)); CONTINUE; END IF;

    SELECT count(*), (array_agg(id))[1] INTO v_matches, v_practice FROM public.master_practices
      WHERE deleted_at IS NULL AND practice_code = 'PR-' || (v_row->>'npi');
    IF v_matches <> 1 THEN v_errors := v_errors || jsonb_build_array(format('Row %s: NPI %s was %s.', v_row->>'row_number', v_row->>'npi', CASE WHEN v_matches=0 THEN 'not found in Leads Engine' ELSE 'ambiguous' END)); CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.lead_company_claims c WHERE c.practice_id=v_practice AND c.status='active' AND c.tenant_id<>v_tenant) THEN
      v_errors := v_errors || jsonb_build_array(format('Row %s: NPI %s is already claimed by another company.', v_row->>'row_number', v_row->>'npi'));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_errors) > 0 THEN RETURN jsonb_build_object('ok',false,'message','Validation failed; no rows were imported.','errors',v_errors); END IF;

  INSERT INTO public.worksheet_import_batches(filename, uploaded_by, row_count)
    VALUES (COALESCE(NULLIF(btrim(p_filename),''),'worksheet.csv'), v_admin.id, jsonb_array_length(p_rows)) RETURNING id INTO v_batch;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT id INTO v_tenant FROM public.tenants WHERE status='active' AND NOT COALESCE(is_platform,false) AND lower(btrim(name))=lower(btrim(v_row->>'company_name'));
    SELECT id INTO v_agent FROM public.users WHERE tenant_id=v_tenant AND status='active' AND lower(btrim(full_name))=lower(btrim(v_row->>'agent_name'));
    SELECT id INTO v_practice FROM public.master_practices WHERE deleted_at IS NULL AND practice_code='PR-'||(v_row->>'npi');
    v_timezone := NULLIF(v_row->>'timezone','');
    -- The source provides a date but no time. Use 09:00 local business time.
    v_callback := CASE WHEN NULLIF(v_row->>'callback_date','') IS NULL THEN NULL ELSE
      ((v_row->>'callback_date')::date + time '09:00') AT TIME ZONE CASE v_timezone
        WHEN 'Eastern' THEN 'America/New_York' WHEN 'Central' THEN 'America/Chicago'
        WHEN 'Mountain' THEN 'America/Denver' WHEN 'Pacific' THEN 'America/Los_Angeles' ELSE 'UTC' END END;

    -- Match the normal worksheet save path and serialize claims/reminders for
    -- the same lead while this row is written.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_practice::text, 0));
    -- The Super Admin CSV is authoritative for both company allocation and
    -- agent assignment, keeping the imported worksheet reachable normally.
    INSERT INTO public.lead_allocations(practice_id,tenant_id,allocated_by,allocated_at,status)
    VALUES(v_practice,v_tenant,v_admin.id,now(),'active')
    ON CONFLICT(practice_id,tenant_id) DO UPDATE SET
      allocated_by=EXCLUDED.allocated_by,allocated_at=EXCLUDED.allocated_at,status='active';
    INSERT INTO public.lead_assignments(practice_id,tenant_id,assigned_to,assigned_by,origin_user_id,assigned_at,status,current_status,last_activity_at)
    VALUES(v_practice,v_tenant,v_agent,v_admin.id,v_admin.id,now(),'active','Follow Up',now())
    ON CONFLICT(practice_id,assigned_to) DO UPDATE SET
      tenant_id=EXCLUDED.tenant_id,assigned_by=EXCLUDED.assigned_by,status='active',
      current_status='Follow Up',last_activity_at=EXCLUDED.last_activity_at;
    SELECT tenant_id INTO v_claim_tenant FROM public.lead_company_claims WHERE practice_id=v_practice AND status='active' LIMIT 1;
    IF v_claim_tenant IS NOT NULL AND v_claim_tenant <> v_tenant THEN
      RAISE EXCEPTION 'NPI % is already claimed by another company', v_row->>'npi';
    END IF;
    IF v_claim_tenant IS NULL THEN
      INSERT INTO public.lead_company_claims(practice_id,tenant_id,claimed_by,trigger_disposition)
      VALUES(v_practice,v_tenant,v_agent,'Follow Up');
    END IF;

    INSERT INTO public.lead_worksheets(practice_id,tenant_id,call_details,additional_phone,concerned_person,direct_line,
      callback_at,timezone,disposition,updated_by,updated_at,import_data,imported_at,imported_by,import_batch_id)
    VALUES(v_practice,v_tenant,v_row->>'notes',NULLIF(v_row->>'secondary_phone',''),NULLIF(v_row->>'provider_name',''),
      NULLIF(v_row->>'phone_number',''),v_callback,v_timezone,'Follow Up',v_agent,now(),v_row->'raw_data',now(),v_admin.id,v_batch)
    ON CONFLICT(practice_id,tenant_id) DO UPDATE SET call_details=EXCLUDED.call_details,additional_phone=EXCLUDED.additional_phone,
      concerned_person=EXCLUDED.concerned_person,direct_line=EXCLUDED.direct_line,callback_at=EXCLUDED.callback_at,
      timezone=EXCLUDED.timezone,disposition=EXCLUDED.disposition,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at,
      import_data=EXCLUDED.import_data,imported_at=EXCLUDED.imported_at,imported_by=EXCLUDED.imported_by,import_batch_id=EXCLUDED.import_batch_id;
    INSERT INTO public.worksheet_import_rows(batch_id,row_number,practice_id,tenant_id,agent_id,raw_data)
      VALUES(v_batch,(v_row->>'row_number')::integer,v_practice,v_tenant,v_agent,v_row->'raw_data');
    IF v_callback IS NOT NULL THEN
      UPDATE public.lead_reminders SET remind_at=v_callback,note='Callback (Follow Up)',agent_id=v_agent
        WHERE id=(SELECT id FROM public.lead_reminders WHERE practice_id=v_practice AND tenant_id=v_tenant AND done IS NOT TRUE ORDER BY created_at DESC LIMIT 1);
      IF NOT FOUND THEN
        INSERT INTO public.lead_reminders(practice_id,tenant_id,agent_id,remind_at,note)
        VALUES(v_practice,v_tenant,v_agent,v_callback,'Callback (Follow Up)');
      END IF;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'imported',v_count,'batch_id',v_batch);
END; $$;

REVOKE ALL ON FUNCTION public.import_worksheet_csv(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_worksheet_csv(text,jsonb) TO authenticated;
COMMIT;

-- Make the newly created RPC visible to PostgREST immediately. Supabase also
-- refreshes automatically, but this avoids a stale schema-cache window.
NOTIFY pgrst, 'reload schema';
