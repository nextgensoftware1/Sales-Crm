-- transfer-kpi.sql — Transfer KPI: PKR 500 to the agent for each verified transfer.
-- Run once in the Supabase SQL editor, then restart / redeploy the app.
--
-- What it adds (nothing existing is changed):
--   * transfer_kpi_credits — a ledger: one row per verified lead transfer
--     (agent credited, lead, who verified, when, PKR 500). Names are copied
--     in, so the history stays readable even if a lead is deleted later.
--   * verify_transfer(transfer_id) — the ONLY way to add a credit. It checks:
--       - the transfer belongs to the caller's own company;
--       - the caller is the closer who received it, or a manager / company admin;
--       - nobody verifies their own transfer;
--       - each lead is credited once per company (re-transfers don't pay twice).
--   * Row Level Security: agents see their own credits; closers see credits
--     for transfers they received or verified; managers, team leads and
--     company admins see their company's; super admin sees all. Nobody can
--     insert, edit or delete credits directly.
--
-- All-or-nothing: if anything fails, nothing is created.
-- Undo:  drop function if exists public.verify_transfer(uuid);
--        drop table if exists public.transfer_kpi_credits;

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

-- Read-only for signed-in users; writes only happen inside verify_transfer().
REVOKE ALL ON public.transfer_kpi_credits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.transfer_kpi_credits TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     public.users%ROWTYPE;
  v_role     text;
  v_transfer public.lead_transfers%ROWTYPE;
  v_inserted integer;
  v_amount   constant numeric := 500;   -- PKR per verified transfer
BEGIN
  SELECT * INTO v_user FROM public.users WHERE auth_id = auth.uid() AND status = 'active';
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT r.key INTO v_role FROM public.roles r WHERE r.id = v_user.role_id;

  SELECT * INTO v_transfer FROM public.lead_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF v_transfer.tenant_id IS DISTINCT FROM v_user.tenant_id THEN
    RAISE EXCEPTION 'You can only verify transfers in your own company';
  END IF;
  IF NOT (v_role IN ('company_admin', 'manager') OR (v_role = 'closer' AND v_transfer.to_user_id = v_user.id)) THEN
    RAISE EXCEPTION 'Only the receiving closer, a manager or a company admin can verify this transfer';
  END IF;
  IF v_transfer.from_user_id IS NULL THEN RAISE EXCEPTION 'This transfer has no agent to credit'; END IF;
  IF v_transfer.from_user_id = v_user.id THEN RAISE EXCEPTION 'You cannot verify your own transfer'; END IF;

  INSERT INTO public.transfer_kpi_credits
    (tenant_id, practice_id, transfer_id, agent_id, agent_name, practice_code, practice_name,
     verified_by, verified_by_name, amount, currency)
  SELECT v_transfer.tenant_id, v_transfer.practice_id, v_transfer.id, v_transfer.from_user_id, a.full_name,
         mp.practice_code, mp.name, v_user.id, v_user.full_name, v_amount, 'PKR'
  FROM public.users a
  LEFT JOIN public.master_practices mp ON mp.id = v_transfer.practice_id
  WHERE a.id = v_transfer.from_user_id
  ON CONFLICT ON CONSTRAINT transfer_kpi_one_credit_per_lead DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('verified', v_inserted > 0, 'already_verified', v_inserted = 0, 'amount', v_amount, 'currency', 'PKR');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_transfer(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
