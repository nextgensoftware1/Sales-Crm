-- Performance indexes for the Leads page, practice detail and navigation.
-- Run in the Supabase SQL editor. Every statement is IF NOT EXISTS, so it is
-- safe to re-run. Run database/performance-audit.sql first if you want to see
-- which of these already exist under another name.
--
-- Why: PostgREST turns nested selects (practice_providers -> providers ->
-- provider_signals / provider_mips, and lead_activity ORDER BY ... LIMIT 1)
-- into one lateral sub-query PER ROW. Without an index on each foreign key,
-- every one of those sub-queries is a sequential scan, so a 1,000-row page
-- does thousands of table scans. That is the ~700ms per master_practices page
-- in the dev log.

-- Each index is created independently: if a table or column name differs in
-- your database, that one index is skipped with a NOTICE and the rest still run.
create or replace function pg_temp.try_index(stmt text) returns void language plpgsql as $f$
begin
  execute stmt;
exception when others then
  raise notice 'skipped (%): %', sqlerrm, stmt;
end $f$;

-- Embedded relationships used by the Leads page (one lookup per lead row)
select pg_temp.try_index('create index if not exists idx_practice_providers_practice on public.practice_providers (practice_id)');
select pg_temp.try_index('create index if not exists idx_practice_providers_provider on public.practice_providers (provider_id)');
select pg_temp.try_index('create index if not exists idx_provider_signals_provider   on public.provider_signals (provider_id)');
select pg_temp.try_index('create index if not exists idx_provider_mips_provider      on public.provider_mips (provider_id)');

-- "Last dialed": latest activity per practice (ORDER BY created_at DESC LIMIT 1)
select pg_temp.try_index('create index if not exists idx_lead_activity_practice_created on public.lead_activity (practice_id, created_at desc)');

-- Lead list scans, sorted by name then id (matches the new ORDER BY)
select pg_temp.try_index('create index if not exists idx_master_practices_active_name on public.master_practices (name, id) where is_roster = false and deleted_at is null');
select pg_temp.try_index('create index if not exists idx_master_practices_owner_name on public.master_practices (owner_tenant_id, name, id) where is_roster = false');
select pg_temp.try_index('create index if not exists idx_master_practices_code on public.master_practices (practice_code)');

-- Allocations / assignments / transfers / claims / worksheets
select pg_temp.try_index('create index if not exists idx_lead_allocations_status_practice on public.lead_allocations (status, practice_id, tenant_id)');
select pg_temp.try_index('create index if not exists idx_lead_allocations_tenant_status   on public.lead_allocations (tenant_id, status, practice_id)');
select pg_temp.try_index('create index if not exists idx_lead_assignments_to_status       on public.lead_assignments (assigned_to, status, practice_id)');
select pg_temp.try_index('create index if not exists idx_lead_assignments_practice_by     on public.lead_assignments (practice_id, assigned_by, status)');
select pg_temp.try_index('create index if not exists idx_lead_transfers_to_user           on public.lead_transfers (to_user_id, practice_id)');
select pg_temp.try_index('create index if not exists idx_lead_transfers_practice_created  on public.lead_transfers (practice_id, created_at desc)');
select pg_temp.try_index('create index if not exists idx_lead_company_claims_status       on public.lead_company_claims (status, practice_id)');
select pg_temp.try_index('create index if not exists idx_lead_worksheets_tenant_practice  on public.lead_worksheets (tenant_id, practice_id)');
select pg_temp.try_index('create index if not exists idx_lead_worksheets_practice_updated on public.lead_worksheets (practice_id, updated_at desc)');

-- Practice detail roster lookups and per-request profile lookup
select pg_temp.try_index('create index if not exists idx_providers_org_pac on public.providers (org_pac_id)');
select pg_temp.try_index('create index if not exists idx_users_auth_id     on public.users (auth_id)');

-- Reminders bell (polled from every page)
select pg_temp.try_index('create index if not exists idx_lead_reminders_tenant_remind on public.lead_reminders (tenant_id, remind_at)');
select pg_temp.try_index('create index if not exists idx_lead_reminders_agent_remind  on public.lead_reminders (agent_id, remind_at)');

-- Refresh planner statistics so the new indexes are used immediately
do $$
declare t text;
begin
  foreach t in array array['master_practices','practice_providers','providers','provider_signals',
    'provider_mips','lead_activity','lead_allocations','lead_assignments','lead_transfers',
    'lead_company_claims','lead_worksheets','lead_reminders','users'] loop
    begin execute format('analyze public.%I', t);
    exception when others then raise notice 'analyze skipped: %', t; end;
  end loop;
end $$;
