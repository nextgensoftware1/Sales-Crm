-- performance-rpc-v4.sql — compact Leads page rows (smaller, less memory).
-- Run in the Supabase SQL editor AFTER performance-rpc-v3.sql, then restart
-- `npm run dev` / the server.
--
-- What it does: ADDS one new read-only function, crm_lead_rows_flat. Nothing
-- existing is changed or dropped. It returns the same leads, in the same
-- order, as crm_lead_rows, but each lead is a compact list of values instead
-- of nested objects with repeated key names, and only the first provider
-- (the only one the page reads). The result is several times smaller, so the
-- database needs much less memory to build it.
--
-- Safety: read-only, SECURITY INVOKER (Row Level Security still applies),
-- not executable by anon. If this function is missing or fails, the app
-- automatically uses crm_lead_rows (v3) instead.
-- Undo:  drop function if exists public.crm_lead_rows_flat(text, uuid, uuid[], uuid);
--
-- Row layout (decoded by lib/lead-pack.ts -> decodeFlatLead):
--   [ id, practice_code, name, state, specialty, owner_tenant_id, created_at,
--     latest_activity_at,
--     provider | null  = [ npi, org_name, nppes_sex, nppes_last_updated,
--                          payment_adj_pct, at_risk, record_source,
--                          entity_type, enumeration_date,
--                          signals | null = [ccm, pcm, awv, tcm, bhi, rpm, rcm_fit],
--                          mips | null    = [[performance_year, status, reporting_option], ...] ],
--     assigned_away | null = [[assigned_at, user | null = [full_name, role_key]], ...] ]

create or replace function public.crm_lead_rows_flat(
  p_mode text,
  p_tenant uuid default null,
  p_ids uuid[] default null,
  p_assigned_by uuid default null
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(json_agg(t.r order by t.name, t.id), '[]'::json)
  from (
    select
      mp.id,
      mp.name,
      json_build_array(
        mp.id, mp.practice_code, mp.name, mp.state, mp.specialty,
        mp.owner_tenant_id, mp.created_at,
        (select la.created_at
           from lead_activity la
          where la.practice_id = mp.id
          order by la.created_at desc
          limit 1),
        (select case when pr.id is null then null else json_build_array(
                  pr.npi, pr.org_name, pr.nppes_sex, pr.nppes_last_updated,
                  pr.payment_adj_pct, pr.at_risk, pr.record_source,
                  pr.entity_type, pr.enumeration_date,
                  (select json_build_array(ps.ccm, ps.pcm, ps.awv, ps.tcm, ps.bhi, ps.rpm, ps.rcm_fit)
                     from provider_signals ps
                    where ps.provider_id = pr.id
                    limit 1),
                  (select json_agg(json_build_array(pm.performance_year, pm.status, pm.reporting_option))
                     from provider_mips pm
                    where pm.provider_id = pr.id)
                ) end
           from practice_providers pp
           left join providers pr on pr.id = pp.provider_id
          where pp.practice_id = mp.id
          order by pp.is_primary desc nulls last, pp.provider_id
          limit 1),
        case when p_assigned_by is null then null else (
          select json_agg(json_build_array(
                   a.assigned_at,
                   case when u.id is null then null else json_build_array(u.full_name, r.key) end
                 ) order by a.assigned_at nulls first)
            from lead_assignments a
            left join users u on u.id = a.assigned_to
            left join roles r on r.id = u.role_id
           where a.practice_id = mp.id
             and a.assigned_by = p_assigned_by
             and a.status = 'active'
        ) end
      ) as r
    from master_practices mp
    where mp.is_roster = false
      and case p_mode
            when 'all'   then mp.deleted_at is null
            when 'owner' then mp.owner_tenant_id = p_tenant
            when 'ids'   then mp.id = any(coalesce(p_ids, '{}'::uuid[]))
            else false
          end
  ) t
$$;

revoke all on function public.crm_lead_rows_flat(text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.crm_lead_rows_flat(text, uuid, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
