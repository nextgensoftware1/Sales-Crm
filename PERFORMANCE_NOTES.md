# Performance review and changes

## Latest verified results — 22 September 2026

### Homepage options and practice counter follow-up

- Homepage dropdown options now load on first selection/focus/hover through an authenticated, private/no-store endpoint. The initial lead render no longer fetches the team/company dropdown lists. Loading and retry states are present; the original option role/tenant rules remain.
- Assigned-away names are embedded in each lead query and filtered by the verified assigning user and active status. Removed the standalone assigned-away query. No long-lived lead cache was introduced.
- Practice previous/next navigation and its total now use the role's lead pool, instead of an unfiltered global practice query. Agents/closers use assigned/transferred anchors; managers/team leads use their personal assignments with cross-company engagement exclusion; company admins use owned/allocated anchors; super-admins use nondeleted anchors. Deduplicates codes and reads all result pages. An open roster member outside the anchor pool shows the available-lead total without a misleading position. Query failure shows "Count unavailable" rather than a false zero.
- 32 regression tests pass, including all six navigation scopes, more than 1,000 assigned leads, and dropdown endpoint permissions. TypeScript passes. Live authenticated count/visual verification remains outstanding.

- Homepage now embeds only the latest activity per practice, removing the separate activity batch reads. Checked the relationship against the live REST API with read-only requests. A 30-lead sample returned matching latest timestamps: warm two-request reads took 329–330ms, combined reads took 155–199ms. This is a small query benchmark, not an authenticated page benchmark.
- Reminder names are embedded in the scoped reminder query, removing a later lookup stage. Practice transfer recipient names and roster editor names are also embedded; roster now uses two sequential requests instead of three.
- All 21 regression tests pass, including role visibility, reminder scopes, missing/deleted practice display, and roster editor names.
- Bundled the same Latin variable font families with licenses; `npm run build` now completes successfully, including TypeScript and static generation. Earlier font-build failures below are historical. The successful build required running outside the execution sandbox because worker spawning was blocked there.
- Production smoke test on a temporary server: `/login` returned HTTP 200, included the email input and local fonts, and took 381ms cold, then 22ms and 18ms warm. Signed-out `/` redirected to login through the streamed Next response. These timings do not predict authenticated homepage performance.
- Added `database/performance-audit.sql`, a read-only index/table-statistics/RLS inspection script. It has not been executed; no indexes, policies, or live records were changed.

Database access finding: the anonymous API key returned a practice row in the limited relationship check without a signed-in user. This demonstrates anonymous access to at least that row; it does not establish how other tables are protected. For a private CRM, review the existing RLS policies and anonymous grants before deployment. Application page checks alone do not restrict direct REST access.

Still outstanding: full server-side filtering/pagination with equivalent global counts and select-all/range semantics; query plans/index verification; authenticated production benchmarks; visual browser checks. Those are not claimed complete by this pass.

Reviewed and updated 21 September 2026.

## What the supplied timings show

The repeated home requests spent about 1.2–6 seconds in application code, with proxy time ranging from roughly 0.2 to 1.8 seconds. Practice requests spent about 2.8–4.4 seconds in application code. First visits also included development compilation (2.1 seconds for worksheet reports and 2.6 seconds for one practice). Compilation time must be separated from warm request latency when comparing changes.

These logs locate slow layers, but do not independently establish SQL execution time, network latency, browser rendering time, or production performance.

## Implemented

- Replaced middleware with the installed Next.js proxy convention. The proxy refreshes expiring session cookies without making a redundant user-verification request for valid sessions. It never uses session contents to authorize requests. Pages and actions still verify identity with Auth.
- Added request-render memoization for Supabase client creation, verified identity, and the current profile. No shared persistent cache of authenticated user data was introduced.
- Parallelized independent homepage metadata queries, consolidated allocation and assignment reads, and bounded chunked query concurrency to four. Activity chunks previously ran sequentially.
- Batched practice editor and transfer reads with other independent detail queries. Worksheet and roster component keys reset state when navigating between leads.
- Replaced internal full-page anchor navigation with Next links. Dense table links disable prefetch to avoid background query bursts. Added a route loading fallback.
- Login and logout now perform one navigation at the authentication boundary, also clearing browser/module state between users.
- Admin forms receive role/company options with the initial page response instead of additional mount-time Server Action requests. Company selection also handles newly created companies after refresh.
- Worksheet save now records its activity within the same verified request instead of dispatching a second action. Reminder and activity writes run concurrently after the worksheet update. Partial failures produce a warning; these operations are not a database transaction.
- Reused already-loaded company metadata in transfer reporting and initialized its company selection from server data.
- Removed identity-header trust from the unused verified-user helper.

## Verification

- `npm run test:performance`: all 13 tests pass. Covers bounded query concurrency, cookie forwarding, verified identity, all six role visibility fixtures, worksheet transfer locks, one activity per save, callbacks, and partial failure reporting.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passes.
- Source lint (`app lib proxy.ts next.config.ts`): 286 errors and 9 warnings remain, compared with the initial 295 errors and 10 warnings. The project is not lint-clean.
- `npm run build`: blocked by connection failures downloading Fraunces, Inter Tight, and JetBrains Mono from Google Fonts. Production build completion remains unverified.

Tests mock Supabase; they do not validate deployed foreign keys, RLS policies, query plans, or live browser behavior. No authenticated production benchmark or database modification was performed. No numerical speed improvement is claimed without comparable measurements.

## Remaining work with the largest likely payoff

Latest log-driven pass: for assignment-scoped roles, the main lead read now starts immediately after personal assignments/transfers resolve, without waiting for dropdowns or other metadata. Manager/team-lead engagement exclusion is limited to their assigned practice IDs and other tenants, replacing a global active-assignment scan. Existing six-role visibility fixtures still pass. The loading skeleton was rewritten into smaller components and successfully compiled using the installed Next SWC compiler to check the reported JSX parsing error.

Second latency pass: super-admin lead scans and company-admin owned-lead scans now start alongside metadata reads. Practice candidates, personal assignments, and closer transfers load concurrently after profile verification. Company roster authorization reuses the allocation result instead of repeating it. All 17 regression tests and TypeScript pass. Added development-only `[crm:db]` timing output for Supabase response arrival (not SQL execution time or response body consumption). Logs omit query parameters, headers and payloads. Set `CRM_PERF_LOG=0` to disable. These changes still require live before/after measurements; no millisecond savings are assumed.

Follow-up loading improvements: replaced the plain loading text with a responsive, theme-aware workspace skeleton and a practice-specific detail skeleton. Includes an accessible loading status and reduced-motion support, without extra data requests. Roster requests now show progress and recover from network failures with retryable feedback. TypeScript, targeted lint for these components, and all 13 existing regression tests pass. Browser visual verification remains outstanding.

1. Move lead filtering, sorting, counts, and pagination to database queries together. The current home page still loads all accessible leads because its browser filters and bulk-selection behavior depend on that complete set. Large datasets remain expensive.
2. Inspect actual SQL plans and existing indexes for practice codes, assignments, tenant allocations, activity by practice/date, reminders, and transfers. The repository has no schema or index inventory; adding speculative indexes would not establish improvement.
3. Measure application-to-Supabase latency and deployment region placement. Variable external round trips can dominate even optimized query scheduling.
4. Complete the production build with Google Fonts connectivity or licensed local font assets, then benchmark a warm production server.

For a fair comparison, use the same account, role, filters, dataset, and deployment; record one cold request separately, then at least 20 warm requests per route. Compare median and p95 server latency, request counts, transferred bytes, and browser navigation responsiveness. Include home, practice details, worksheet save, dashboard, reminders, clients, transfers, reports, and admin. Recheck all roles and cross-account logout/login behavior before deployment.
