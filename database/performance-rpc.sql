-- One-round-trip read functions for the Leads page and practice navigation.
-- Run in the Supabase SQL editor AFTER database/performance-indexes.sql.
-- Safe to re-run (CREATE OR REPLACE).
--
-- Safety:
--   * SECURITY INVOKER: the function runs as the signed-in user, so every
--     table's Row Level Security still applies exactly as with normal REST
--     queries. It cannot see anything the user could not already see.
--   * Not executable by the anonymous role.
--   * The app falls back to its original queries automatically if these
--     functions are missing or fail, so running this file is optional and
--     reversible (see the DROP statements at the bottom).
--
-- Each function returns ONE jsonb array whose objects have exactly the same
-- shape the app's nested PostgREST select produced, so no page logic changes.

-- ---------------------------------------------------------------------------
-- Leads page rows
--   p_mode 'all'   -> every non-roster, non-deleted practice (super admin)
--   p_mode 'owner' -> non-roster practices owned by p_tenant (company admin)
--   p_mode 'ids'   -> non-roster practices in p_ids (assigned / allocated)
--   p_assigned_by  -> when set, include assigned_away (active assignments made
--                     by this user); when null the key is omitted as before
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_rows(
  p_mode text,
  p_tenant uuid default null,
  p_ids uuid[] default null,
  p_assigned_by uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- jsonb_strip_nulls drops null keys (the app reads every field with ?. / ??),
  -- which shrinks the response sent over the network.
  select coalesce(jsonb_agg(jsonb_strip_nulls(t.row_json) order by t.name, t.id), '[]'::jsonb)
  from (
    select
      mp.id,
      mp.name,
      jsonb_build_object(
        'id', mp.id,
        'practice_code', mp.practice_code,
        'name', mp.name,
        'state', mp.state,
        'specialty', mp.specialty,
        'owner_tenant_id', mp.owner_tenant_id,
        'created_at', mp.created_at,
        -- latest activity only (same as order created_at desc limit 1)
        'lead_activity', coalesce((
          select jsonb_build_array(jsonb_build_object('created_at', la.created_at))
          from lead_activity la
          where la.practice_id = mp.id
          order by la.created_at desc
          limit 1
        ), '[]'::jsonb),
        'practice_providers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'providers', case when pr.id is null then null else jsonb_build_object(
              'npi', pr.npi,
              'org_name', pr.org_name,
              'nppes_sex', pr.nppes_sex,
              'nppes_last_updated', pr.nppes_last_updated,
              'payment_adj_pct', pr.payment_adj_pct,
              'at_risk', pr.at_risk,
              'record_source', pr.record_source,
              'entity_type', pr.entity_type,
              'enumeration_date', pr.enumeration_date,
              'provider_signals', (
                select jsonb_build_object(
                  'ccm', ps.ccm, 'pcm', ps.pcm, 'awv', ps.awv, 'tcm', ps.tcm,
                  'bhi', ps.bhi, 'rpm', ps.rpm, 'rcm_fit', ps.rcm_fit)
                from provider_signals ps
                where ps.provider_id = pr.id
                limit 1
              ),
              'provider_mips', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'performance_year', pm.performance_year,
                  'status', pm.status,
                  'reporting_option', pm.reporting_option))
                from provider_mips pm
                where pm.provider_id = pr.id
              ), '[]'::jsonb)
            ) end
          ) order by pp.is_primary desc nulls last)
          from practice_providers pp
          left join providers pr on pr.id = pp.provider_id
          where pp.practice_id = mp.id
        ), '[]'::jsonb)
      )
      || case when p_assigned_by is null then '{}'::jsonb else jsonb_build_object(
        'assigned_away', coalesce((
          select jsonb_agg(jsonb_build_object(
            'users', case when u.id is null then null else jsonb_build_object(
              'full_name', u.full_name,
              'roles', case when r.id is null then null
                            else jsonb_build_object('key', r.key, 'label', r.label) end
            ) end
          ) order by a.assigned_at nulls first)
          from lead_assignments a
          left join users u on u.id = a.assigned_to
          left join roles r on r.id = u.role_id
          where a.practice_id = mp.id
            and a.assigned_by = p_assigned_by
            and a.status = 'active'
        ), '[]'::jsonb)
      ) end
      as row_json
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

-- ---------------------------------------------------------------------------
-- Active allocations (super admin: all companies; others: p_tenant only)
-- ---------------------------------------------------------------------------
create or replace function public.crm_active_allocations(p_tenant uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'practice_id', a.practice_id,
    'tenant_id', a.tenant_id,
    'master_practices', case when mp.id is null then null
                             else jsonb_build_object('practice_code', mp.practice_code) end,
    'tenants', case when tn.id is null then null else jsonb_build_object('name', tn.name) end
  ) order by a.practice_id, a.tenant_id), '[]'::jsonb)
  from lead_allocations a
  left join master_practices mp on mp.id = a.practice_id
  left join tenants tn on tn.id = a.tenant_id
  where a.status = 'active'
    and (p_tenant is null or a.tenant_id = p_tenant)
$$;

-- ---------------------------------------------------------------------------
-- Practice Prev/Next navigation index (id, code, name only)
--   p_owner null -> all non-roster, non-deleted (super admin)
--   p_owner set  -> non-roster practices owned by that company
-- ---------------------------------------------------------------------------
create or replace function public.crm_practice_index(p_owner uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mp.id, 'practice_code', mp.practice_code, 'name', mp.name
  ) order by mp.name, mp.id), '[]'::jsonb)
  from master_practices mp
  where mp.is_roster = false
    and case when p_owner is null then mp.deleted_at is null
             else mp.owner_tenant_id = p_owner end
$$;

revoke all on function public.crm_lead_rows(text, uuid, uuid[], uuid) from public, anon;
revoke all on function public.crm_active_allocations(uuid) from public, anon;
revoke all on function public.crm_practice_index(uuid) from public, anon;
grant execute on function public.crm_lead_rows(text, uuid, uuid[], uuid) to authenticated;
grant execute on function public.crm_active_allocations(uuid) to authenticated;
grant execute on function public.crm_practice_index(uuid) to authenticated;

-- Tell the API layer about the new functions immediately.
notify pgrst, 'reload schema';

-- To undo (the app automatically returns to its original queries):
--   drop function if exists public.crm_lead_rows(text, uuid, uuid[], uuid);
--   drop function if exists public.crm_active_allocations(uuid);
--   drop function if exists public.crm_practice_index(uuid);
