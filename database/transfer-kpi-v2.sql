-- transfer-kpi-v2.sql — Transfer KPI with Verify / Reject and a required note.
-- Run once in the Supabase SQL editor, then restart / redeploy the app.
-- Works whether or not database/transfer-kpi.sql was run before: existing
-- verified credits are kept (they become status 'verified', note empty).
--
-- Rules (enforced here, in the database):
--   * Decision is 'verified' (PKR 500 to the transferring agent) or
--     'rejected' (PKR 0 — no KPI). A note explaining the decision is required.
--   * Only in your own company; by the closer who received the transfer, or
--     any manager / company admin (so a manager who received it can decide).
--   * Nobody decides on their own transfer.
--   * One decision per lead per company — no double payments, no flip-flopping.
--   * Row Level Security as before; nobody can insert/edit/delete directly.
--
-- All-or-nothing: if anything fails, nothing changes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.transfer_kpi_credits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  practice_id      uuid REFERENCES public.master_practices(id) ON DELETE SET NULL,
  transfer_id      uuid REFERENCES public.lead_transfers(id) ON DELETE SET NULL,
  agent_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  agent_name       text,
  practice_code    text,
  practice_name    text,
  verified_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_by_name text,
  amount           numeric(12,2) NOT NULL DEFAULT 500 CHECK (amount >= 0),
  currency         text NOT NULL DEFAULT 'PKR',
  verified_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_kpi_one_credit_per_lead UNIQUE (tenant_id, practice_id)
);

-- v2 columns: the decision and the reviewer's note.
ALTER TABLE public.transfer_kpi_credits ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'verified';
ALTER TABLE public.transfer_kpi_credits ADD COLUMN IF NOT EXISTS note text;
DO $$ BEGIN
  ALTER TABLE public.transfer_kpi_credits
    ADD CONSTRAINT transfer_kpi_status_valid CHECK (status IN ('verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_transfer_kpi_tenant_verified ON public.transfer_kpi_credits (tenant_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_kpi_agent_verified  ON public.transfer_kpi_credits (agent_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_kpi_transfer        ON public.transfer_kpi_credits (transfer_id);

ALTER TABLE public.transfer_kpi_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfer_kpi_credits_select ON public.transfer_kpi_credits;
CREATE POLICY transfer_kpi_credits_select ON public.transfer_kpi_credits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.roles r ON r.id = u.role_id
      WHERE u.auth_id = auth.uid() AND u.status = 'active'
        AND (
          r.key = 'super_admin'
          OR (
            u.tenant_id = transfer_kpi_credits.tenant_id
            AND (
              r.key IN ('company_admin', 'manager', 'team_lead')
              OR u.id = transfer_kpi_credits.agent_id
              OR u.id = transfer_kpi_credits.verified_by
              OR EXISTS (
                SELECT 1 FROM public.lead_transfers t
                WHERE t.id = transfer_kpi_credits.transfer_id AND t.to_user_id = u.id
              )
            )
          )
        )
    )
  );

REVOKE ALL ON public.transfer_kpi_credits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.transfer_kpi_credits TO authenticated;

-- v1 had verify_transfer(uuid); v2 takes a decision and a note.
DROP FUNCTION IF EXISTS public.verify_transfer(uuid);

CREATE OR REPLACE FUNCTION public.verify_transfer(p_transfer_id uuid, p_decision text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     public.users%ROWTYPE;
  v_role     text;
  v_transfer public.lead_transfers%ROWTYPE;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note     text := btrim(coalesce(p_note, ''));
  v_inserted integer;
  v_existing text;
  v_amount   constant numeric := 500;   -- PKR per verified transfer
BEGIN
  SELECT * INTO v_user FROM public.users WHERE auth_id = auth.uid() AND status = 'active';
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_user.role_id;

  IF v_decision NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'Choose Verify or Reject'; END IF;
  IF char_length(v_note) < 3 THEN RAISE EXCEPTION 'Please add a note explaining your decision'; END IF;
  IF char_length(v_note) > 1000 THEN RAISE EXCEPTION 'The note is too long (1000 characters max)'; END IF;

  SELECT * INTO v_transfer FROM public.lead_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.tenant_id IS DISTINCT FROM v_user.tenant_id THEN
    RAISE EXCEPTION 'You can only review transfers in your own company';
  END IF;
  IF NOT (v_role IN ('company_admin', 'manager') OR (v_role = 'closer' AND v_transfer.to_user_id = v_user.id)) THEN
    RAISE EXCEPTION 'Only the person who received this transfer, a manager or a company admin can review it';
  END IF;
  IF v_transfer.from_user_id IS NULL THEN RAISE EXCEPTION 'This transfer has no agent to credit'; END IF;
  IF v_transfer.from_user_id = v_user.id THEN RAISE EXCEPTION 'You cannot review your own transfer'; END IF;

  INSERT INTO public.transfer_kpi_credits
    (tenant_id, practice_id, transfer_id, agent_id, agent_name, practice_code, practice_name,
     verified_by, verified_by_name, amount, currency, status, note)
  SELECT v_transfer.tenant_id, v_transfer.practice_id, v_transfer.id, v_transfer.from_user_id, a.full_name,
         mp.practice_code, mp.name, v_user.id, v_user.full_name,
         CASE WHEN v_decision = 'verified' THEN v_amount ELSE 0 END, 'PKR', v_decision, v_note
  FROM public.users a
  LEFT JOIN public.master_practices mp ON mp.id = v_transfer.practice_id
  WHERE a.id = v_transfer.from_user_id
  ON CONFLICT ON CONSTRAINT transfer_kpi_one_credit_per_lead DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT status INTO v_existing FROM public.transfer_kpi_credits
      WHERE tenant_id = v_transfer.tenant_id AND practice_id = v_transfer.practice_id;
    RETURN jsonb_build_object('decided', false, 'already_decided', true, 'status', v_existing);
  END IF;
  RETURN jsonb_build_object('decided', true, 'already_decided', false, 'status', v_decision,
    'amount', CASE WHEN v_decision = 'verified' THEN v_amount ELSE 0 END, 'currency', 'PKR');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_transfer(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_transfer(uuid, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
