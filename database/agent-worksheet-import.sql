-- ← ADDED (new file) — Super Admin: upload ONE agent's call work.
--
-- CSV columns: NPI, Disposition / Response, Call details * / Note.
-- ← CHANGED: the note may be empty — the disposition is then used as the
-- note, and a note already on the lead is kept.
-- The company and the agent are chosen on the upload screen.
--
-- Each good row is recorded exactly like that agent saving the worksheet
-- themselves (same rules as save_company_worksheet):
--   * the company's worksheet for the lead gets the note + disposition,
--     "updated by" = the agent  → shows on Active Call under that agent;
--   * a call activity is logged (Activities Logged / Last Dialed / Dashboard);
--   * the agent's assignment shows the new status;
--   * claiming dispositions (Follow Up, Interested, Meeting, Proposal,
--     Qualified, Sold) claim the lead for the company — others do not;
--   * an open reminder for the lead is closed by the existing
--     "close reminder when worked" trigger (no callback in the file).
-- Other worksheet fields (phones, email, contact person) are KEPT.
--
-- Rows that cannot be imported are SKIPPED and returned with the reason;
-- the rest are imported. Nothing existing is deleted.
--
-- HOW TO RUN: Supabase → SQL Editor → New query → paste this WHOLE file →
-- Run. Expected result: "Success. No rows returned".
-- Safe to run more than once. Complete on its own: the upload-history
-- tables are created only if they do not exist yet; nothing is deleted.

BEGIN;

-- ---- Upload history tables (skipped automatically if already there) ----
CREATE TABLE IF NOT EXISTS public.worksheet_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  row_count integer NOT NULL CHECK (row_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.worksheet_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.worksheet_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  practice_id uuid REFERENCES public.master_practices(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  raw_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS import_data jsonb;
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS imported_at timestamptz;
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_worksheets ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.worksheet_import_batches(id) ON DELETE SET NULL;

-- Only Super Admin can read upload history (same as the existing importer).
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

-- ---- The import function ----

CREATE OR REPLACE FUNCTION public.import_agent_worksheets(
  p_filename text,
  p_tenant_id uuid,
  p_agent_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_role text;
  v_agent public.users%ROWTYPE;
  v_row jsonb;
  v_npi text;
  v_disposition text;
  v_notes text;
  v_practice uuid;
  v_claim_tenant uuid;
  v_batch uuid;
  v_now timestamptz := now();
  v_imported integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_codes jsonb := '[]'::jsonb;
  v_claiming boolean;
  v_matches integer;
  v_note_given boolean; -- ← ADDED: false = the file's note was empty
BEGIN
  SELECT u.* INTO v_admin FROM public.users u WHERE u.auth_id = auth.uid() AND u.status = 'active';
  IF v_admin.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_admin.role_id;
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION 'Only a Super Admin can import worksheets'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Upload must contain between 1 and 2,000 rows';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status = 'active' AND NOT COALESCE(t.is_platform, false)) THEN
    RAISE EXCEPTION 'Choose an active sales company';
  END IF;
  SELECT u.* INTO v_agent FROM public.users u WHERE u.id = p_agent_id AND u.tenant_id = p_tenant_id AND u.status = 'active';
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'The chosen agent is not an active user of that company'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_npi := regexp_replace(COALESCE(v_row->>'npi', ''), '\D', '', 'g');
    v_disposition := NULLIF(btrim(COALESCE(v_row->>'disposition', '')), '');
    v_notes := NULLIF(btrim(COALESCE(v_row->>'notes', '')), '');
    v_note_given := COALESCE((v_row->>'note_given')::boolean, true); -- ← ADDED
    v_practice := NULL;

    -- Each row is its own small transaction: a problem skips only that row.
    BEGIN
      IF v_npi !~ '^\d{10}$' THEN RAISE EXCEPTION 'NPI must contain exactly 10 digits'; END IF;
      IF v_disposition IS NULL THEN RAISE EXCEPTION 'Disposition is empty'; END IF;
      IF length(v_disposition) > 60 THEN RAISE EXCEPTION 'Disposition is too long'; END IF;
      IF v_notes IS NULL THEN RAISE EXCEPTION 'Call details / note is empty'; END IF;

      SELECT count(*), (array_agg(mp.id))[1] INTO v_matches, v_practice FROM public.master_practices mp
        WHERE mp.deleted_at IS NULL AND mp.practice_code = 'PR-' || v_npi;
      IF v_matches = 0 THEN RAISE EXCEPTION 'NPI not found in the Leads Engine'; END IF;
      IF v_matches > 1 THEN RAISE EXCEPTION 'NPI matches more than one lead (ambiguous)'; END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(v_practice::text, 0));

      SELECT c.tenant_id INTO v_claim_tenant FROM public.lead_company_claims c
        WHERE c.practice_id = v_practice AND c.status = 'active' LIMIT 1;
      IF v_claim_tenant IS NOT NULL AND v_claim_tenant <> p_tenant_id THEN
        RAISE EXCEPTION 'Lead is claimed by another company';
      END IF;
      IF EXISTS (SELECT 1 FROM public.lead_transfers t
                 WHERE t.practice_id = v_practice AND t.tenant_id = p_tenant_id AND t.to_user_id <> p_agent_id) THEN
        RAISE EXCEPTION 'Lead was transferred to another person';
      END IF;

      -- Uploading the same file twice must not count the work twice.
      -- (← CHANGED: with an empty note in the file, the same agent + same
      -- disposition already counts as recorded.)
      IF EXISTS (SELECT 1 FROM public.lead_worksheets w
                 WHERE w.practice_id = v_practice AND w.tenant_id = p_tenant_id AND w.updated_by = p_agent_id
                   AND w.disposition = v_disposition AND (w.call_details = v_notes OR NOT v_note_given)) THEN
        RAISE EXCEPTION 'Already recorded for this agent (same disposition and note)';
      END IF;

      -- Keep the lead reachable for the company and the agent (never move an
      -- existing allocation date; re-open only if it had been revoked).
      INSERT INTO public.lead_allocations (practice_id, tenant_id, allocated_by, allocated_at, status)
      VALUES (v_practice, p_tenant_id, v_admin.id, v_now, 'active')
      ON CONFLICT (practice_id, tenant_id) DO UPDATE SET
        status = 'active',
        allocated_by = CASE WHEN public.lead_allocations.status = 'active' THEN public.lead_allocations.allocated_by ELSE EXCLUDED.allocated_by END,
        allocated_at = CASE WHEN public.lead_allocations.status = 'active' THEN public.lead_allocations.allocated_at ELSE EXCLUDED.allocated_at END;

      INSERT INTO public.lead_assignments (practice_id, tenant_id, assigned_to, assigned_by, origin_user_id, assigned_at, status, current_status, last_activity_at)
      VALUES (v_practice, p_tenant_id, p_agent_id, v_admin.id, v_admin.id, v_now, 'active', v_disposition, v_now)
      ON CONFLICT (practice_id, assigned_to) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id, status = 'active',
        current_status = EXCLUDED.current_status, last_activity_at = EXCLUDED.last_activity_at;

      -- Same claim rule as a normal worksheet save.
      v_claiming := lower(replace(v_disposition, ' ', '_')) = ANY
        (ARRAY['follow_up','interested','meeting','proposal','qualified','sold']);
      IF v_claiming AND v_claim_tenant IS NULL THEN
        INSERT INTO public.lead_company_claims (practice_id, tenant_id, claimed_by, trigger_disposition)
        VALUES (v_practice, p_tenant_id, p_agent_id, v_disposition);
      END IF;

      -- The worksheet: note + disposition by the agent. Phones / email /
      -- contact person already on the worksheet are kept.
      -- ← CHANGED: when the file's note was empty, an existing note is KEPT;
      -- the disposition is used as the note only if there was none.
      INSERT INTO public.lead_worksheets (practice_id, tenant_id, call_details, disposition, updated_by, updated_at,
        import_data, imported_at, imported_by)
      VALUES (v_practice, p_tenant_id, v_notes, v_disposition, p_agent_id, v_now, NULL, v_now, v_admin.id)
      ON CONFLICT (practice_id, tenant_id) DO UPDATE SET
        call_details = CASE WHEN v_note_given THEN EXCLUDED.call_details
                            ELSE COALESCE(NULLIF(btrim(public.lead_worksheets.call_details), ''), EXCLUDED.call_details) END,
        disposition = EXCLUDED.disposition,
        callback_at = NULL,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at,
        import_data = NULL,
        imported_at = EXCLUDED.imported_at,
        imported_by = EXCLUDED.imported_by;

      IF v_disposition <> 'New' THEN
        INSERT INTO public.lead_activity (practice_id, tenant_id, agent_id, type, disposition, note)
        VALUES (v_practice, p_tenant_id, p_agent_id, 'call', v_disposition, v_notes);
      END IF;

      v_imported := v_imported + 1;
      v_codes := v_codes || jsonb_build_array(jsonb_build_object(
        'row_number', v_row->'row_number', 'practice_id', v_practice, 'npi', v_npi, 'raw', v_row->'raw'));
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'row', v_row->'row_number', 'npi', NULLIF(v_npi, ''), 'reason', SQLERRM));
    END;
  END LOOP;

  -- Audit trail of the upload (only when something was imported).
  IF v_imported > 0 THEN
    INSERT INTO public.worksheet_import_batches (filename, uploaded_by, row_count)
    VALUES (COALESCE(NULLIF(btrim(p_filename), ''), 'agent-worksheets.csv'), v_admin.id, v_imported)
    RETURNING id INTO v_batch;
    INSERT INTO public.worksheet_import_rows (batch_id, row_number, practice_id, tenant_id, agent_id, raw_data)
    SELECT v_batch, (x->>'row_number')::integer, (x->>'practice_id')::uuid, p_tenant_id, p_agent_id, COALESCE(x->'raw', '{}'::jsonb)
    FROM jsonb_array_elements(v_codes) x
    ON CONFLICT (batch_id, row_number) DO NOTHING;
    UPDATE public.lead_worksheets w SET import_batch_id = v_batch
      FROM jsonb_array_elements(v_codes) x
      WHERE w.practice_id = (x->>'practice_id')::uuid AND w.tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'imported', v_imported,
    'skipped', v_skipped,
    'npis', (SELECT COALESCE(jsonb_agg(x->>'npi'), '[]'::jsonb) FROM jsonb_array_elements(v_codes) x),
    'agent_auth_id', v_agent.auth_id,
    'batch_id', v_batch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_agent_worksheets(text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_agent_worksheets(text, uuid, uuid, jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
