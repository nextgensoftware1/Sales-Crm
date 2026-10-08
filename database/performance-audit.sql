-- Read-only diagnostics for the Supabase SQL editor.
-- Review existing indexes and RLS before proposing migrations.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('master_practices', 'lead_activity', 'lead_assignments',
    'lead_allocations', 'lead_reminders', 'lead_transfers', 'providers', 'users')
ORDER BY tablename, indexname;

SELECT relname, n_live_tup, seq_scan, idx_scan, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;
