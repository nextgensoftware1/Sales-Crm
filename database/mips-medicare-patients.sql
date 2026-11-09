-- Medicare Patients for the practice page (MIPS view).
-- Run ONCE in the Supabase SQL Editor BEFORE deploying the new
-- app/upload-actions.ts. Safe to re-run. Includes everything from
-- mips-cms-figures.sql, so it also works if that one was not run.
--   medicare_patients  <- "medicare patients" (CSV column), stored as text
--   exactly as in the file.

ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS mips_score_2024 text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS payment_adj_2026_pct text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS allowed_charges_2024 text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS est_penalty_2026 text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS medicare_patients text;

CREATE OR REPLACE FUNCTION public.enrich_uploaded_leads(
  p_tenant_id uuid, p_rows jsonb, p_promote boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_prov jsonb;
  v_prac jsonb;
  r_prov public.providers;
  r_prac public.master_practices;
  k_prov public.providers;
  k_prac public.master_practices;
  v_count int;
  v_matched boolean;
  v_enriched int := 0;
  v_not_matched text[] := '{}';
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Company is required';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rows must be a list';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_prov := COALESCE(v_item->'provider', '{}'::jsonb);
    v_prac := COALESCE(v_item->'practice', '{}'::jsonb);
    k_prov := jsonb_populate_record(NULL::public.providers,
      jsonb_build_object('npi', v_item->>'npi'));
    k_prac := jsonb_populate_record(NULL::public.master_practices,
      jsonb_build_object('practice_code', v_item->>'code'));
    v_matched := true;

    IF v_prov <> '{}'::jsonb THEN
      r_prov := jsonb_populate_record(NULL::public.providers, v_prov);
      UPDATE public.providers p SET
        name = CASE WHEN v_prov ? 'name'
          THEN r_prov.name ELSE p.name END,
        state = CASE WHEN v_prov ? 'state'
          THEN r_prov.state ELSE p.state END,
        city = CASE WHEN v_prov ? 'city'
          THEN r_prov.city ELSE p.city END,
        postal = CASE WHEN v_prov ? 'postal'
          THEN r_prov.postal ELSE p.postal END,
        taxonomy_desc = CASE WHEN v_prov ? 'taxonomy_desc'
          THEN r_prov.taxonomy_desc ELSE p.taxonomy_desc END,
        phone = CASE WHEN v_prov ? 'phone'
          THEN r_prov.phone ELSE p.phone END,
        nppes_sex = CASE WHEN v_prov ? 'nppes_sex'
          THEN r_prov.nppes_sex ELSE p.nppes_sex END,
        nppes_last_updated = CASE WHEN v_prov ? 'nppes_last_updated'
          THEN r_prov.nppes_last_updated ELSE p.nppes_last_updated END,
        payment_adj_pct = CASE WHEN v_prov ? 'payment_adj_pct'
          THEN r_prov.payment_adj_pct ELSE p.payment_adj_pct END,
        at_risk = CASE WHEN v_prov ? 'at_risk'
          THEN r_prov.at_risk ELSE p.at_risk END,
        penalty = CASE WHEN v_prov ? 'penalty'
          THEN r_prov.penalty ELSE p.penalty END,
        status = CASE WHEN v_prov ? 'status'
          THEN r_prov.status ELSE p.status END,
        taxonomy_code = CASE WHEN v_prov ? 'taxonomy_code'
          THEN r_prov.taxonomy_code ELSE p.taxonomy_code END,
        mailing_phone = CASE WHEN v_prov ? 'mailing_phone'
          THEN r_prov.mailing_phone ELSE p.mailing_phone END,
        entity_type = CASE WHEN v_prov ? 'entity_type'
          THEN r_prov.entity_type ELSE p.entity_type END,
        enumeration_date = CASE WHEN v_prov ? 'enumeration_date'
          THEN r_prov.enumeration_date ELSE p.enumeration_date END,
        record_source = CASE WHEN v_prov ? 'record_source'
          THEN r_prov.record_source ELSE p.record_source END,
        org_name = CASE WHEN v_prov ? 'org_name'
          THEN r_prov.org_name ELSE p.org_name END,
        credential = CASE WHEN v_prov ? 'credential'
          THEN r_prov.credential ELSE p.credential END,
        addr1 = CASE WHEN v_prov ? 'addr1'
          THEN r_prov.addr1 ELSE p.addr1 END,
        auth_official_name = CASE WHEN v_prov ? 'auth_official_name'
          THEN r_prov.auth_official_name ELSE p.auth_official_name END,
        auth_official_title = CASE WHEN v_prov ? 'auth_official_title'
          THEN r_prov.auth_official_title ELSE p.auth_official_title END,
        auth_official_phone = CASE WHEN v_prov ? 'auth_official_phone'
          THEN r_prov.auth_official_phone ELSE p.auth_official_phone END,
        auth_official_credential = CASE WHEN v_prov ? 'auth_official_credential'
          THEN r_prov.auth_official_credential ELSE p.auth_official_credential END,
        primary_practice_address = CASE WHEN v_prov ? 'primary_practice_address'
          THEN r_prov.primary_practice_address ELSE p.primary_practice_address END,
        mailing_address = CASE WHEN v_prov ? 'mailing_address'
          THEN r_prov.mailing_address ELSE p.mailing_address END,
        secondary_practice_address = CASE WHEN v_prov ? 'secondary_practice_address'
          THEN r_prov.secondary_practice_address ELSE p.secondary_practice_address END,
        secondary_phone = CASE WHEN v_prov ? 'secondary_phone'
          THEN r_prov.secondary_phone ELSE p.secondary_phone END,
        secondary_address_count = CASE WHEN v_prov ? 'secondary_address_count'
          THEN r_prov.secondary_address_count ELSE p.secondary_address_count END,
        mips_score_2024 = CASE WHEN v_prov ? 'mips_score_2024'
          THEN r_prov.mips_score_2024 ELSE p.mips_score_2024 END,
        payment_adj_2026_pct = CASE WHEN v_prov ? 'payment_adj_2026_pct'
          THEN r_prov.payment_adj_2026_pct ELSE p.payment_adj_2026_pct END,
        allowed_charges_2024 = CASE WHEN v_prov ? 'allowed_charges_2024'
          THEN r_prov.allowed_charges_2024 ELSE p.allowed_charges_2024 END,
        est_penalty_2026 = CASE WHEN v_prov ? 'est_penalty_2026'
          THEN r_prov.est_penalty_2026 ELSE p.est_penalty_2026 END,
        medicare_patients = CASE WHEN v_prov ? 'medicare_patients'
          THEN r_prov.medicare_patients ELSE p.medicare_patients END
      WHERE p.npi = k_prov.npi
        AND p.owner_tenant_id = p_tenant_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_matched := v_count > 0;
    END IF;

    r_prac := jsonb_populate_record(NULL::public.master_practices, v_prac);
    UPDATE public.master_practices m SET
      is_roster = CASE WHEN p_promote THEN false ELSE m.is_roster END,
      name = CASE WHEN v_prac ? 'name'
        THEN r_prac.name ELSE m.name END,
      state = CASE WHEN v_prac ? 'state'
        THEN r_prac.state ELSE m.state END,
      city = CASE WHEN v_prac ? 'city'
        THEN r_prac.city ELSE m.city END,
      postal = CASE WHEN v_prac ? 'postal'
        THEN r_prac.postal ELSE m.postal END,
      specialty = CASE WHEN v_prac ? 'specialty'
        THEN r_prac.specialty ELSE m.specialty END,
      phone = CASE WHEN v_prac ? 'phone'
        THEN r_prac.phone ELSE m.phone END
    WHERE m.practice_code = k_prac.practice_code
      AND m.owner_tenant_id = p_tenant_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN v_matched := false; END IF;

    IF v_matched THEN
      v_enriched := v_enriched + 1;
    ELSE
      v_not_matched := v_not_matched || (v_item->>'code');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enriched', v_enriched,
    'not_matched', to_jsonb(v_not_matched));
END;
$$;

REVOKE ALL ON FUNCTION public.enrich_uploaded_leads(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enrich_uploaded_leads(uuid, jsonb, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
