-- Lead Pool: filter, sort and page INSIDE the database.
--
-- Before: for Super Admin and Company Admin the Leads page read every lead
-- (~32k rows with provider, MIPS, signals and activity) from Supabase on each
-- first load, then filtered them in the app server's memory. That was the
-- 13.5 s crm_lead_rows_flat call and most of the project's egress.
--
-- Now: the app sends the filters here and gets back only
--   * the number of matching leads,
--   * the ordered list of matching lead codes (small text, for Select all,
--     range select and the lead page's Previous / Next),
--   * the ids of the leads on the current page (the page rows themselves are
--     then read with crm_lead_rows_page, in the crm_lead_rows_flat format),
--   * the summary numbers and dropdown options (overview).
-- The rules are the same as lib/lead-filters.ts + lib/leads-data.ts.
--
-- Agents, Closers, Managers and Team Leads are NOT affected: their list is
-- only their own assigned leads (small) and keeps the existing path.
--
-- Safe to run more than once. Read-only (SELECT only). SECURITY INVOKER, so
-- the same Row Level Security rules apply as for the existing lead reads.
-- Requires performance-rpc-v4.sql (crm_lead_rows_flat), already run.
-- Undo:
--   drop function if exists public.crm_lead_rows_page(uuid[], uuid);
--   drop function if exists public.crm_lead_page(text, uuid, uuid, jsonb, text, text[], text[], text, integer, integer, text[], boolean);
--   drop function if exists public.crm_lead_base(text, uuid, uuid, text[], text[]);
--   drop function if exists public.crm_iso_date(text);
--   drop function if exists public.crm_zone_of(text);

-- ---------------------------------------------------------------------------
-- Same as toIsoCalendarDate() in lib/lead-filters.ts: "YYYY-MM-DD" or NULL.
-- Accepts 2024-05-12 / 2024/5/12 / 2024-05-12T..., 5/12/2024 (US month
-- first) and Excel day numbers (20000-80000).
-- ---------------------------------------------------------------------------
create or replace function public.crm_iso_date(p_value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := btrim(coalesce(p_value, ''));
  m text[];
  y int; mo int; d int;
  serial int;
  dt date;
  check_year int;
begin
  if v = '' then return null; end if;

  m := regexp_match(v, '^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})');
  if m is not null then
    y := m[1]::int; mo := m[2]::int; d := m[3]::int;
  else
    m := regexp_match(v, '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)');
    if m is not null then
      y := m[3]::int; mo := m[1]::int; d := m[2]::int;
    elsif v ~ '^\d{5}(\.\d+)?$' then
      serial := floor(v::numeric)::int;
      if serial < 20000 or serial > 80000 then return null; end if;
      dt := date '1899-12-30' + serial;
      y := extract(year from dt)::int; mo := extract(month from dt)::int; d := extract(day from dt)::int;
    else
      return null;
    end if;
  end if;

  if mo < 1 or mo > 12 or d < 1 or d > 31 then return null; end if;
  -- JavaScript Date.UTC treats years 0-99 as 1900-1999 when checking the day.
  check_year := case when y between 0 and 99 then 1900 + y else y end;
  if d > extract(day from (make_date(check_year, mo, 1) + interval '1 month - 1 day'))::int then
    return null;
  end if;
  return lpad(y::text, 4, '0') || '-' || lpad(mo::text, 2, '0') || '-' || lpad(d::text, 2, '0');
end;
$$;

-- Same as ZONE_BY_STATE in lib/lead-filters.ts (blank / unknown -> Other).
create or replace function public.crm_zone_of(p_state text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_state in ('CT','DE','FL','GA','ME','MD','MA','NH','NJ','NY','NC','OH','PA','RI','SC','VT',
                     'VA','WV','DC','MI','IN','KY') then 'EST'
    when p_state in ('AL','AR','IL','IA','KS','LA','MN','MS','MO','NE','ND','OK','SD','TN','TX','WI') then 'CST'
    when p_state in ('AZ','CO','ID','MT','NM','UT','WY') then 'MST'
    when p_state in ('CA','NV','OR','WA') then 'PST'
    else 'Other'
  end
$$;

-- ---------------------------------------------------------------------------
-- The viewer's lead list with every field the filters, sort and summary use.
--   p_scope 'all'     -> Super Admin: every non-roster, non-deleted lead
--   p_scope 'company' -> Company Admin: leads the company owns, then leads
--                        allocated to it; minus leads another company claimed
-- One row per lead code (first one wins, as in the app).
-- p_codes limits the list to those codes (used to open one page).
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_base(
  p_scope text,
  p_tenant uuid,
  p_user uuid,
  p_priority_codes text[] default null,
  p_codes text[] default null
)
returns table (
  ord bigint,
  id uuid,
  practice_code text,
  name text,
  state text,
  specialty text,
  created_at timestamptz,
  origin int,
  org_name text,
  entity_type text,
  enumeration_date text,
  last_updated text,
  npi_found boolean,
  ccm boolean, pcm boolean, awv boolean, tcm boolean, bhi boolean, rpm boolean, rcm_fit boolean,
  has_mips boolean,
  worked boolean,
  is_email boolean,
  allocated boolean,
  alloc_tenants uuid[],
  alloc_names text[],
  away_name text,
  away_at timestamptz,
  priority boolean
)
language plpgsql
stable
security invoker
set search_path = public
-- plan with the real values on every call (a generic plan was ~3x slower)
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  return query
  with cand as (
    select mp.id, mp.practice_code, mp.name, mp.state, mp.specialty, mp.created_at,
           (mp.lead_category = 'Email') as is_email, 0 as origin
      from master_practices mp
     where p_scope = 'all'
       and mp.is_roster = false and mp.deleted_at is null
       and (p_codes is null or mp.practice_code = any(p_codes))
    union all
    select mp.id, mp.practice_code, mp.name, mp.state, mp.specialty, mp.created_at,
           (mp.lead_category = 'Email'), 0
      from master_practices mp
     where p_scope = 'company'
       and mp.owner_tenant_id = p_tenant and mp.is_roster = false
       and (p_codes is null or mp.practice_code = any(p_codes))
    union all
    select mp.id, mp.practice_code, mp.name, mp.state, mp.specialty, mp.created_at,
           (mp.lead_category = 'Email'), 1
      from master_practices mp
     where p_scope = 'company'
       and mp.is_roster = false
       and mp.id in (select la.practice_id from lead_allocations la
                      where la.status = 'active' and la.tenant_id = p_tenant)
       and (p_codes is null or mp.practice_code = any(p_codes))
  ),
  kept as (
    select c.*,
           row_number() over (partition by c.practice_code order by c.origin, c.name, c.id) as dup
      from cand c
     where p_scope = 'all'
        or not exists (select 1 from lead_company_claims cl
                        where cl.practice_id = c.id and cl.status = 'active'
                          and cl.tenant_id is distinct from p_tenant)
  ),
  alloc as materialized (
    select mp2.practice_code as code, a.practice_id, a.tenant_id,
           coalesce(tn.name, 'Unknown company') as tname
      from lead_allocations a
      left join master_practices mp2 on mp2.id = a.practice_id
      left join tenants tn on tn.id = a.tenant_id
     where a.status = 'active'
       and (p_scope = 'all' or a.tenant_id = p_tenant)
       and mp2.practice_code is not null
       and (p_codes is null or mp2.practice_code = any(p_codes))
  ),
  alloc_first as (
    select distinct on (code, tenant_id) code, tenant_id, tname, practice_id
      from alloc
     where tenant_id is not null
     order by code, tenant_id, practice_id
  ),
  alloc_code as materialized (
    -- one row per allocated lead code (computed once, then joined by code)
    select d.code, g.tenants, g.names
      from (select distinct code from alloc) d
      left join (
        select f.code,
               array_agg(f.tenant_id order by f.practice_id, f.tenant_id) as tenants,
               array_agg(f.tname order by f.practice_id, f.tenant_id) as names
          from alloc_first f
         group by f.code
      ) g on g.code = d.code
  ),
  -- The per-lead details below are read for all leads in one pass each
  -- (hash joins), not one lead at a time — much faster for ~30k leads.
  kept1 as materialized (select * from kept where kept.dup = 1),
  -- primary provider: same choice as crm_lead_rows_flat
  prv as materialized (
    select distinct on (pp.practice_id)
           pp.practice_id, pr.id as provider_id, pr.org_name, pr.entity_type::text as entity_type,
           pr.enumeration_date::text as enumeration_date, pr.nppes_last_updated::text as last_updated,
           pr.record_source
      from kept1 k1
      join practice_providers pp on pp.practice_id = k1.id
      left join providers pr on pr.id = pp.provider_id
     order by pp.practice_id, pp.is_primary desc nulls last, pp.provider_id
  ),
  sig as materialized (
    select distinct on (ps.provider_id) ps.provider_id, ps.ccm, ps.pcm, ps.awv, ps.tcm, ps.bhi, ps.rpm, ps.rcm_fit
      from provider_signals ps
     where ps.provider_id in (select prv.provider_id from prv)
     order by ps.provider_id, ps.ctid
  ),
  -- MIPS 2026 text, read the same way as lib/lead-row-map.ts (mipsByYear[2026])
  mips as materialized (
    select x.provider_id, lower((array_agg(x.val order by x.rn))[count(*)]) as v2026
      from (
        select raw.provider_id, raw.rn,
               case when coalesce(raw.y, 0) <> 0 then raw.y
                    when raw.t ~ '^\d{4}' then substring(raw.t from 1 for 4)::int
               end as yr,
               coalesce(nullif(regexp_replace(raw.t, '^\d{4}\s*-\s*', ''), ''), raw.t) as val
          from (
            select pm.provider_id, pm.performance_year::int as y,
                   regexp_replace(coalesce(pm.reporting_option::text, pm.status::text, ''), '^\s+|\s+$', '', 'g') as t,
                   row_number() over (partition by pm.provider_id order by pm.ctid) as rn
              from provider_mips pm
             where pm.provider_id in (select prv.provider_id from prv)
          ) raw
      ) x
     where x.yr = 2026
     group by x.provider_id
  ),
  -- "worked": the latest activity (newest first, empty dates first) has a date
  act as materialized (
    select la.practice_id, bool_and(la.created_at is not null) as has_date
      from lead_activity la
     where la.practice_id in (select kept1.id from kept1)
     group by la.practice_id
  )
  select
    case when p_scope = 'all' then 0 else k.origin end::bigint as ord,
    k.id, k.practice_code, k.name, k.state, k.specialty, k.created_at, k.origin,
    prv.org_name, prv.entity_type, prv.enumeration_date, prv.last_updated,
    (lower(btrim(coalesce(prv.record_source, ''))) like '%found%'
       and lower(btrim(coalesce(prv.record_source, ''))) not like '%not found%') as npi_found,
    coalesce(sig.ccm, false), coalesce(sig.pcm, false), coalesce(sig.awv, false), coalesce(sig.tcm, false),
    coalesce(sig.bhi, false), coalesce(sig.rpm, false), coalesce(sig.rcm_fit, false),
    coalesce(mips.v2026 ~ '(individual|group|apm)', false) as has_mips,
    coalesce(act.has_date, false) as worked,
    coalesce(k.is_email, false),
    (ac.code is not null) as allocated,
    case when p_scope = 'all' then coalesce(ac.tenants, '{}') else '{}' end,
    case when p_scope = 'all' then coalesce(ac.names, '{}') else '{}' end,
    aw.name, aw.assigned_at,
    (k.practice_code = any(coalesce(p_priority_codes, '{}')))
  from kept1 k
  left join prv on prv.practice_id = k.id
  left join sig on sig.provider_id = prv.provider_id
  left join mips on mips.provider_id = prv.provider_id
  left join act on act.practice_id = k.id
  left join alloc_code ac on ac.code = k.practice_code
  -- Company Admin: the latest active assignment this admin handed out
  left join lateral (
    select case when u.id is null then null else coalesce(u.full_name, '') end as name, a.assigned_at
      from lead_assignments a
      left join users u on u.id = a.assigned_to
     where p_scope = 'company'
       and a.practice_id = k.id and a.assigned_by = p_user and a.status = 'active'
     order by a.assigned_at desc nulls last
     limit 1
  ) aw on true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The Lead Pool query.
--   p_action 'list'     -> {"total", "codes" (newline-separated, when
--                          p_want_codes), "page": [{id, code, alloc}]}
--   p_action 'resolve'  -> {"page": [...]} for the codes in p_codes, in that
--                          order (opening another page of a known list)
--   p_action 'overview' -> summary numbers and dropdown options
--   p_action 'first'    -> 'list' + "overview", from one pass (opening the page)
-- p_filters is the sanitized LeadFilters object from the app.
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_page(
  p_scope text,
  p_tenant uuid,
  p_user uuid,
  p_filters jsonb,
  p_time_zone text,
  p_priority_codes text[],
  p_extra_codes text[],
  p_action text,
  p_offset integer,
  p_limit integer,
  p_codes text[],
  p_want_codes boolean
)
returns json
language plpgsql
stable
security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_search text := lower(regexp_replace(coalesce(f->>'search', ''), '^\s+|\s+$', '', 'g'));
  v_state text := coalesce(f->>'stateFilter', '');
  v_zone text := coalesce(f->>'zoneFilter', '');
  v_specialty text := coalesce(f->>'specialtyFilter', '');
  v_specialties text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(
                            case when jsonb_typeof(f->'specialtyFilters') = 'array' then f->'specialtyFilters' else '[]'::jsonb end) x), '{}');
  v_disposition text := coalesce(f->>'dispositionFilter', '');
  v_signals text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(
                            case when jsonb_typeof(f->'activeSignals') = 'array' then f->'activeSignals' else '[]'::jsonb end) x), '{}');
  v_cat text := coalesce(f->>'catTab', '');
  v_source text := coalesce(f->>'sourceTab', 'All');
  v_pool text := coalesce(f->>'poolTab', '');
  v_view text := coalesce(f->>'assignedView', 'all');
  v_company text := coalesce(f->>'companyFilter', '');
  v_enum_type text := coalesce(f->>'enumTypeFilter', '');
  v_npi_type text := coalesce(f->>'npiTypeFilter', '');
  v_lu_from text := coalesce(f->>'lastUpdatedFrom', '');
  v_lu_to text := coalesce(f->>'lastUpdatedTo', '');
  v_en_from text := coalesce(f->>'enumDateFrom', '');
  v_en_to text := coalesce(f->>'enumDateTo', '');
  v_assigned_date text := coalesce(f->>'assignedDateFilter', '');
  v_tz text := 'UTC';
  v_has_priority boolean := coalesce(cardinality(p_priority_codes), 0) > 0;
  v_is_super boolean := (p_scope = 'all');
  v_result json;
begin
  if p_scope not in ('all', 'company') then raise exception 'Unknown lead scope'; end if;
  if p_scope = 'company' and p_tenant is null then raise exception 'Company is required'; end if;
  if p_time_zone is not null and exists (select 1 from pg_timezone_names where name = p_time_zone) then
    v_tz := p_time_zone;
  end if;

  if p_action = 'overview' then
    with b as (select * from crm_lead_base(p_scope, p_tenant, p_user, p_priority_codes, null)),
    mx as (select max(b.created_at) as t from b)
    select json_build_object(
      'total', (select count(*) from b),
      'stateCounts', (select coalesce(json_agg(json_build_array(s.state, s.n)), '[]'::json)
                        from (select b.state, count(*) as n from b group by b.state) s),
      'specialties', (select coalesce(json_agg(distinct b.specialty), '[]'::json)
                        from b where coalesce(b.specialty, '') <> ''),
      'allocatedCount', (select count(*) from b where cardinality(b.alloc_tenants) > 0),
      'assignedAwayCount', (select count(*) from b where b.away_name is not null),
      'workedCount', (select count(*) from b where b.worked),
      'newCount', (select count(*) from b, mx
                    where b.created_at is not null and b.created_at >= mx.t - interval '5 minutes'),
      'leadCompanies', (select coalesce(json_agg(json_build_object('id', c.tid, 'name', c.tname) order by c.pos), '[]'::json)
                          from (select distinct on (u.tid) u.tid, u.tname, u.pos
                                  from (select t.tid, t.tname,
                                               row_number() over (order by b.ord, b.name, b.id, t.i) as pos
                                          from b
                                          cross join lateral unnest(b.alloc_tenants, b.alloc_names)
                                               with ordinality as t(tid, tname, i)) u
                                 order by u.tid, u.pos) c)
    ) into v_result;
    return v_result;
  end if;

  if p_action = 'resolve' then
    select json_build_object('page', coalesce(json_agg(json_build_object(
             'id', b.id, 'code', b.practice_code, 'alloc', b.allocated,
             'companies', (select coalesce(json_agg(json_build_object('id', t.tid, 'name', t.tname) order by t.i), '[]'::json)
                             from unnest(b.alloc_tenants, b.alloc_names) with ordinality as t(tid, tname, i)),
             'email', b.is_email
           ) order by array_position(p_codes, b.practice_code)), '[]'::json))
      into v_result
      from crm_lead_base(p_scope, p_tenant, p_user, p_priority_codes, p_codes) b;
    return v_result;
  end if;

  -- 'first' = 'list' + the overview, from ONE pass over the leads (opening
  -- the Lead Pool); 'list' alone for filter changes.
  if p_action not in ('list', 'first') then raise exception 'Unknown action'; end if;

  with b as (select * from crm_lead_base(p_scope, p_tenant, p_user, p_priority_codes, null)),
  mx as (select max(b.created_at) as t from b),
  filtered as (
    select b.*
      from b, mx
     where
       -- Company (Super Admin only)
       (not v_is_super or v_company = ''
          or (v_company = '__unassigned__' and cardinality(b.alloc_tenants) = 0)
          or (v_company <> '__unassigned__' and v_company = any(b.alloc_tenants::text[])))
       -- Search box (+ phone / email / city / ZIP matches found by the app)
       and (v_search = ''
          or strpos(lower(coalesce(b.name, '')), v_search) > 0
          or strpos(lower(coalesce(b.practice_code, '')), v_search) > 0
          or strpos(lower(coalesce(b.state, '')), v_search) > 0
          or strpos(lower(coalesce(b.specialty, '')), v_search) > 0
          or strpos(lower(coalesce(b.org_name, '')), v_search) > 0
          or strpos(lower(coalesce(b.entity_type, '')), v_search) > 0
          or exists (select 1 from unnest(b.alloc_names) n where strpos(lower(n), v_search) > 0)
          or (b.away_name is not null and strpos(lower(b.away_name), v_search) > 0)
          or b.practice_code = any(coalesce(p_extra_codes, '{}')))
       and (v_state = '' or b.state = v_state)
       and (v_zone = '' or crm_zone_of(nullif(b.state, '')) = v_zone)
       and (case when cardinality(v_specialties) > 0
                 then coalesce(b.specialty, '') <> '' and b.specialty = any(v_specialties)
                 else v_specialty = '' or b.specialty = v_specialty end)
       -- Category tabs
       and (v_cat <> 'MIPS' or b.has_mips)
       and (v_cat <> 'RCM' or b.rcm_fit)
       and (v_cat <> 'CCM' or b.ccm)
       and (v_cat <> 'Credentialing' or b.npi_found)
       and (v_cat <> 'Email' or b.is_email)
       and (v_cat <> 'Credentialing' or (
              (v_enum_type = '' or coalesce(b.entity_type, '') = v_enum_type)
              and ((v_en_from = '' and v_en_to = '')
                   or (crm_iso_date(b.enumeration_date) is not null
                       and (v_en_from = '' or crm_iso_date(b.enumeration_date) collate "C" >= v_en_from collate "C")
                       and (v_en_to = '' or crm_iso_date(b.enumeration_date) collate "C" <= v_en_to collate "C")))))
       and ((v_lu_from = '' and v_lu_to = '')
            or (crm_iso_date(b.last_updated) is not null
                and (v_lu_from = '' or crm_iso_date(b.last_updated) collate "C" >= v_lu_from collate "C")
                and (v_lu_to = '' or crm_iso_date(b.last_updated) collate "C" <= v_lu_to collate "C")))
       -- Admin views carry no call status, so a status filter matches nothing
       and v_disposition = ''
       and (v_npi_type = '' or (case
              when btrim(coalesce(b.entity_type, '')) = '' then ''
              when lower(btrim(b.entity_type)) like '%2%' or lower(btrim(b.entity_type)) like '%org%' then 'NPI-2'
              when lower(btrim(b.entity_type)) like '%1%' or lower(btrim(b.entity_type)) like '%ind%' then 'NPI-1'
              else '' end) = v_npi_type)
       -- Signal pills (all chosen must match)
       and (not ('ccm' = any(v_signals)) or b.ccm)
       and (not ('pcm' = any(v_signals)) or b.pcm)
       and (not ('awv' = any(v_signals)) or b.awv)
       and (not ('tcm' = any(v_signals)) or b.tcm)
       and (not ('bhi' = any(v_signals)) or b.bhi)
       and (not ('rpm' = any(v_signals)) or b.rpm)
       and (not ('rcmFit' = any(v_signals)) or b.rcm_fit)
       and (not ('mips' = any(v_signals)) or b.has_mips)
       -- Source tabs
       and (v_source not in ('Allocated', 'Uploaded')
            or (v_source = 'Allocated' and b.allocated)
            or (v_source = 'Uploaded' and not b.allocated))
       -- Pool tabs
       and (v_pool <> 'New Leads'
            or (b.created_at is not null and b.created_at >= mx.t - interval '5 minutes'))
       and (v_pool <> 'Worked Leads' or b.worked)
       and (v_pool <> 'Not Worked Leads' or not b.worked)
       -- "My assigned" and the Assigned-on date
       and (v_view <> 'mine' or b.priority)
       and (v_assigned_date = ''
            or (b.away_at is not null
                and to_char(b.away_at at time zone v_tz, 'YYYY-MM-DD') = v_assigned_date))
  ),
  ordered as (
    select fl.*,
           row_number() over (
             order by
               case when v_has_priority and v_view = 'all' then (case when fl.priority then 0 else 1 end) else 0 end,
               case when v_has_priority and v_view = 'all' then 0 else fl.ord end,
               -- with "my assigned" first, the app sorted names like JavaScript's
               -- localeCompare (ICU); otherwise the list keeps the database order
               case when v_has_priority and v_view = 'all' then fl.name collate "und-x-icu" end,
               fl.name,
               fl.ord,
               fl.id
           ) as pos
      from filtered fl
  )
  select json_build_object(
    'overview', case when p_action = 'first' then json_build_object(
          'total', (select count(*) from b),
          'stateCounts', (select coalesce(json_agg(json_build_array(s.state, s.n)), '[]'::json)
                            from (select b.state, count(*) as n from b group by b.state) s),
          'specialties', (select coalesce(json_agg(distinct b.specialty), '[]'::json)
                            from b where coalesce(b.specialty, '') <> ''),
          'allocatedCount', (select count(*) from b where cardinality(b.alloc_tenants) > 0),
          'assignedAwayCount', (select count(*) from b where b.away_name is not null),
          'workedCount', (select count(*) from b where b.worked),
          'newCount', (select count(*) from b, mx
                        where b.created_at is not null and b.created_at >= mx.t - interval '5 minutes'),
          'leadCompanies', (select coalesce(json_agg(json_build_object('id', c.tid, 'name', c.tname) order by c.pos), '[]'::json)
                              from (select distinct on (u.tid) u.tid, u.tname, u.pos
                                      from (select t.tid, t.tname,
                                                   row_number() over (order by b.ord, b.name, b.id, t.i) as pos
                                              from b
                                              cross join lateral unnest(b.alloc_tenants, b.alloc_names)
                                                   with ordinality as t(tid, tname, i)) u
                                     order by u.tid, u.pos) c)
        ) end,
    'total', (select count(*) from ordered),
    'codes', case when p_want_codes then (select string_agg(o.practice_code, E'\n' order by o.pos) from ordered o) end,
    'page', (select coalesce(json_agg(json_build_object(
               'id', o.id, 'code', o.practice_code, 'alloc', o.allocated,
               'companies', (select coalesce(json_agg(json_build_object('id', t.tid, 'name', t.tname) order by t.i), '[]'::json)
                               from unnest(o.alloc_tenants, o.alloc_names) with ordinality as t(tid, tname, i)),
               'email', o.is_email
             ) order by o.pos), '[]'::json)
               from ordered o
              where o.pos > greatest(coalesce(p_offset, 0), 0)
                and o.pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 20), 1), 200))
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rows of one Lead Pool page, in exactly the crm_lead_rows_flat format
-- (the column list below is copied from it unchanged). A separate function
-- because crm_lead_rows_flat's 'ids' mode cannot use the index inside a
-- function and scans every lead to find a page's 20.
-- ---------------------------------------------------------------------------
create or replace function public.crm_lead_rows_page(
  p_ids uuid[],
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
    where mp.id = any(coalesce(p_ids, '{}'::uuid[]))
      and mp.is_roster = false
  ) t
$$;

-- Same access as the other lead functions: signed-in users only (RLS applies).
revoke all on function public.crm_lead_rows_page(uuid[], uuid) from public, anon;
revoke all on function public.crm_lead_base(text, uuid, uuid, text[], text[]) from public, anon;
revoke all on function public.crm_lead_page(text, uuid, uuid, jsonb, text, text[], text[], text, integer, integer, text[], boolean) from public, anon;
grant execute on function public.crm_lead_rows_page(uuid[], uuid) to authenticated;
grant execute on function public.crm_lead_base(text, uuid, uuid, text[], text[]) to authenticated;
grant execute on function public.crm_lead_page(text, uuid, uuid, jsonb, text, text[], text[], text, integer, integer, text[], boolean) to authenticated;
grant execute on function public.crm_iso_date(text) to authenticated;
grant execute on function public.crm_zone_of(text) to authenticated;

notify pgrst, 'reload schema';
