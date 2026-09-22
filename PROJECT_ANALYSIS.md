# Sales CRM project analysis

Historical snapshot: this analysis predates the subsequent performance changes. See [PERFORMANCE_NOTES.md](./PERFORMANCE_NOTES.md) for implemented changes and current verification results.

Reviewed: 21 September 2026. Scope: the local project supplied in this task.

The application implements a substantial medical-practice sales workflow, but its authorization rules, allocation semantics, failure handling, and reporting are inconsistent. It needs correctness and database verification work before a production-readiness claim would be justified.

This was an analysis pass. Application source and database records were not changed. Checks generated normal build/lint artifacts under `.next`; this report is the deliverable.

## 1. Coverage and limits

- Inventoried all application/library modules, routes, configuration, assets, and the backup directory; traced the active pages, client interactions, server actions, and Supabase clients.
- There are 66 TypeScript/TSX/CSS files under `app` and `lib`, approximately 10,500 lines including commented legacy implementations, 13 page routes, and references to 15 database tables.
- Read the installed Next.js server-action guide and middleware deprecation reference. Findings use the installed version's conventions.
- Ran TypeScript, ESLint, dependency inventory, and a production build attempt. Reproduced date and MIPS mapping issues with isolated JavaScript calculations.
- Checked environment variable names only; secret values are not reproduced here.
- This folder is not a Git repository. There is no local commit history or reliable baseline for attributing existing changes.
- No database schema, migrations, RLS policies, RPC definitions, seed data, automated tests, or CI configuration were found in the supplied source tree.
- No authenticated browser workflow or live database mutation was performed. RLS, indexes, foreign keys, triggers, deployed settings, and actual data volumes remain unverified. This is source analysis, not a penetration test or visual QA sign-off.

## 2. Architecture

| Layer | Implementation |
|---|---|
| Framework | Next.js 16.3.3 App Router, React/React DOM 19.2.8 |
| Language | TypeScript with strict checking; extensive `any` casts weaken database type checking |
| Authentication | Supabase email/password sign-in, cookie-based SSR session client |
| Backend | Server Components for page reads; `use server` modules for reads and mutations |
| Database | Supabase/Postgres, accessed directly through the Supabase SDK |
| Privileged operations | Service-role client used by user creation for the Auth Admin API |
| Presentation | Per-page `AppShell`, custom CSS variables, dark/light themes, inline styles, SVG charts/icons |
| Styling tooling | Tailwind 4/PostCSS installed; the active CSS files do not import Tailwind, so utility classes in the layout should not be assumed to be generated |
| State | React state, some module-level client caches, URL parameters for dashboard dates |
| Deployment | Standard `next build` / `next start`; no project-specific deployment runbook |

Normal flow: browser event → server action → cookie-authenticated Supabase client → database query/write → result → client state update or `router.refresh()`.

The middleware refreshes authentication through `auth.getUser()`. It does not enforce active-account status or authorization. Each page/action implements its own user/profile lookup and role logic. There is no central authorization/data-access layer.

`app/layout.tsx` loads fonts and the two active stylesheets (`globals.css`, then `design-system.css`). It does not mount `AppChrome`. The active pages mount `AppShell` themselves. `reference.css` is not imported by application code.

## 3. Product and route map

| Route | Purpose | Principal limitations |
|---|---|---|
| `/login` | Email/password login and account-status check | Recovery button is inert; remember-me checkbox does not affect persistence |
| `/` | Lead pool, filters, selection, CSV upload, allocation, assignment | Fetches entire practice dataset; allocation uses older action; some controls are samples |
| `/practice/[code]` | Practice/provider profile, roster, worksheet, transfer, sale, activity history | Complex duplicated access rules; timezone errors; history limited to 20 rows |
| `/dashboard` | Activity, transfers, sales, contract value, MRR, clients, charts | Mixed time scopes and row-limited sums; incentives are sample values |
| `/reminders` | Personal/company/platform callbacks, mark done | No pagination; repeated worksheet saves create duplicates |
| `/transfers` | Handoffs with current worksheet details, grouped by company | Initial company is blank for server-loaded Super Admin view |
| `/clients` | Active client registry with contract and MRR | No pagination; query errors look like an empty registry |
| `/admin` | Companies, team lists, user creation, role reference, allocation history | Creation caches are stale; company lifecycle is not atomic |
| `/admin/view` | Super Admin inspection of another user's lead list | View logic differs from actual home-page rules; page itself only checks sign-in |
| `/assignments` | Review/remove assignments made by caller | Cannot remove platform-owned allocated leads |
| `/agent-assigned` | Management overview of agent/closer assignments | Unpaginated reads; page gating weaker than action gating |
| `/worksheet-reports` | Latest worksheet per lead for management | Owned-only scope excludes allocated leads; newest 300 only |
| `/deleted-leads` | Super Admin restore/permanent deletion | Broad organization deletion scope and partial-failure risks |

### Roles as currently implemented

| Role | Home-page visibility | Management capabilities |
|---|---|---|
| Super Admin | All non-roster, non-soft-deleted practices | Allocate, import, manage companies/users, delete/restore, global oversight |
| Company Admin | Company-owned and actively allocated practices | Import, assign to junior roles, create junior users, close sales |
| Manager | Practices actively assigned to the manager | Import, assign company-owned/allocated leads to junior roles, create junior users |
| Team Lead | Practices actively assigned to the team lead | Assign company-owned/allocated leads to junior roles, create junior users |
| Agent | Active assignments | Worksheet, activity, reminders, transfers |
| Closer | Active assignments plus incoming transfers | Worksheet and sale closing |

Management reminders/transfers/dashboard views are company-wide, even where the home pool is assignment-only. All non-Super-Admin users see company-scoped clients. These differences need an explicit permission matrix; they should not be inferred from the sidebar.

## 4. Database model inferred from code

| Table | Responsibility |
|---|---|
| `tenants` | Company identity, platform flag, lifecycle status |
| `roles` | Role key, display label, numeric hierarchy level |
| `users` | Application profile linked by `auth_id`, company, role, status |
| `master_practices` | Lead identity, owner, roster/deletion flags, latest worksheet fields |
| `providers` | NPI/provider identity and organization/medical-business metadata |
| `practice_providers` | Practice/provider join |
| `provider_signals` | CCM, PCM, AWV, TCM, BHI, RPM, RCM flags |
| `provider_mips` | Reporting option/status/year data |
| `lead_allocations` | Practice allocated to company |
| `lead_assignments` | Practice assigned to person, assigning/origin user, current status |
| `lead_activity` | Calls/status changes with actor, disposition, note, timestamp |
| `lead_reminders` | Agent callback time, note, completion flag |
| `lead_transfers` | Handoff sender/recipient, note used as handoff status |
| `sales` | Sale actor, service, contract value, MRR |
| `client_ownership` | Active client ownership linked to sale |

The roster action also calls `get_org_roster(clicked_npi)`. Its implementation and execution permissions are absent.

Identifiers need clarification: imports deduplicate within a tenant, but many actions resolve a practice using only `practice_code = PR-<NPI>` with `maybeSingle()`. If codes can repeat between tenants, these lookups fail or become ambiguous; if codes are globally unique, per-tenant duplicate detection is insufficient. The database constraints decide which case applies.

## 5. Highest-priority findings

### A. Active-account enforcement exists only in the login flow

Evidence: [app/auth-actions.ts:12](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/auth-actions.ts:12>), [app/login/page.tsx:38](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/login/page.tsx:38>), [app/admin-manage-actions.ts:12](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin-manage-actions.ts:12>), [middleware.ts:29](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/middleware.ts:29>).

`checkAccountStatus()` rejects suspended users/companies after browser login, but authenticated pages and mutation helpers generally do not recheck those statuses. Suspending a company does not revoke Auth sessions. An existing session can still reach application code that authorizes by role alone. In particular, user creation then invokes a service-role Auth operation. Actual database access may additionally be restricted by RLS, which cannot be verified here. The login check also permits statuses other than `suspended`, including `inactive`.

Repair: use a shared verified-profile guard that requires an allowed active user/company status at each protected action and data entry point; enforce equivalent database policies.

### B. Mutation authorization is weaker than detail-page authorization

Evidence: [app/actions.ts:499](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:499>), [app/actions.ts:617](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:617>), [app/actions.ts:680](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:680>), [app/worksheet-actions.ts:20](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-actions.ts:20>), [app/roster-actions.ts:73](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/roster-actions.ts:73>).

The detail page checks assignments, allocations, and roster access. Worksheet/activity/transfer actions do not consistently repeat those checks. `transferToCloser()` accepts a recipient ID without checking the recipient's company, role, or status. `markAsSold()` checks role, but not the caller's assignment/transfer entitlement. The roster RPC is invoked without an explicit application authentication check. Successful misuse depends on the unseen database policies; the missing checks in application code are confirmed.

Repair: resolve and authorize the exact practice ID and recipient server-side before every operation. Include transfer locks and client-lock semantics in shared rules, with matching RLS.

### C. Exclusive allocation is not connected to the active UI

Evidence: [app/PracticesTable.tsx:5](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/PracticesTable.tsx:5>), [app/PracticesTable.tsx:307](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/PracticesTable.tsx:307>), [app/actions.ts:452](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:452>), [app/super-allocate-actions.ts:13](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/super-allocate-actions.ts:13>).

The table calls `allocatePractices()`, whose conflict target is `(practice_id,tenant_id)` and which does not check another company's allocation. `allocatePracticesExclusive()` exists but has no caller. If the database has no additional exclusivity constraint, the UI can allocate the same practice to multiple companies. Even the unused exclusive function uses a read-then-insert check, which needs a database constraint to withstand concurrent requests. It also does not enforce the platform-owned restriction stated in its comment.

Repair: decide whether allocation is exclusive, implement one action, and enforce the rule atomically in Postgres.

### D. Multi-table writes can leave partial or misleading results

Evidence: [app/upload-actions.ts:397](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/upload-actions.ts:397>), [app/actions.ts:643](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:643>), [app/actions.ts:711](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:711>), [app/actions.ts:875](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:875>).

- Import inserts providers, practices, links, signals, and MIPS in separate requests. A later failure leaves earlier inserts. Retry may skip orphaned providers, preventing repair.
- Sale creation inserts a sale before client ownership. If ownership creation fails, the sale is left behind and can inflate dashboard totals on retries.
- Transfer deletes previous transfer rows before inserting the replacement. Failure can lose the previous handoff; later assignment failure leaves an incomplete transfer.
- Hard deletion removes provider child data before deleting practices, then ignores errors from some child/provider deletes. Failure can leave partially erased records.
- Worksheet saving and activity logging are separate browser-dispatched actions. Reminder insertion and some status/activity writes ignore returned errors.

Repair: transactional database functions for each business operation, idempotency for retries, and explicit errors for failed dependent writes.

### E. Hard-delete impact is broader than the selected practices

Evidence: [app/actions.ts:838](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:838>), [app/actions.ts:857](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts:857>), [app/deleted-leads/DeletedLeadsTable.tsx:87](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/deleted-leads/DeletedLeadsTable.tsx:87>).

Deletion expands through `org_pac_id` and adds every matching provider's `PR-<NPI>` practice code. It does not restrict expansion to roster-only records, tenant, or already-soft-deleted records. Another anchor in the same organization may be included. The confirmation count reflects selected leads, not the complete expanded impact. Some cleanup failures are ignored.

Repair: calculate a precise impact preview from database IDs, explicitly define permissible organization expansion, and delete transactionally. Do not silently equate shared organization membership with permission to erase every related record.

## 6. Confirmed workflow and reporting defects

| Issue | Evidence | Effect |
|---|---|---|
| Allocated leads cannot be unassigned | [manage-assignments-actions.ts:136](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/manage-assignments-actions.ts:136>) filters ownership, while [assign-actions.ts:65](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/assign-actions.ts:65>) accepts allocations | A valid assignment of a platform-owned lead cannot be removed through this action |
| Reports exclude allocated leads | [worksheet-reports-actions.ts:81](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-reports-actions.ts:81>) filters only `owner_tenant_id` | A company can work a lead but cannot see its worksheet in its report; global report attributes it to the owning platform |
| Transfer view starts without company selection | [transfers/TransfersClient.tsx:158](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/transfers/TransfersClient.tsx:158>) and `:161` | Server-supplied data bypasses the effect that chooses the first company; the view starts with zero displayed transfers until a company is clicked |
| Callback zone is decorative | [Worksheet.tsx:144](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/Worksheet.tsx:144>), [worksheet-actions.ts:62](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-actions.ts:62>) | A timezone-free `datetime-local` value is parsed in the server timezone; selected Eastern/Central/etc. is stored but not used for conversion |
| Callback shortcuts have incorrect labels | [Worksheet.tsx:66](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/Worksheet.tsx:66>), `:150` | Tomorrow 9:00 adds 24 hours to the current time; Next Monday adds three days |
| Duplicate reminders on saves | [worksheet-actions.ts:83](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-actions.ts:83>) | Every save with a callback inserts another reminder; changing/clearing a callback does not reconcile the old reminder |
| Month picker shifts dates in positive UTC offsets | [dashboard/page.tsx:8](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/page.tsx:8>), [dashboard/DateRangePicker.tsx:15](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/DateRangePicker.tsx:15>) | Local midnight converted with `toISOString()` can become the previous calendar day |
| Dashboard ratios mix populations/time periods | [dashboard/page.tsx:60](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/page.tsx:60>), `DashboardView.tsx:112` | In-range activities/transfers are compared with all-time sales; personal sales are compared with company-wide clients; percentages can exceed 100% |
| Role preview differs from actual views | [role-view-actions.ts:59](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/role-view-actions.ts:59>) versus [app/page.tsx:204](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/page.tsx:204>) | Manager/TL preview gets owned + allocated pool while their home page gets assignments; preview also lacks the same roster/deletion filters |
| MIPS parsing differs between screens | [upload-actions.ts:467](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/upload-actions.ts:467>), [app/page.tsx:311](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/page.tsx:311>), [practice/[code]/page.tsx:34](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/practice/[code]/page.tsx:34>) | Import stores multiple years as one text value; home derives only the leading year, while detail searches for 2026 inside the string |
| Company picker does not refresh after creation | [admin/AdminManageClient.tsx:30](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/AdminManageClient.tsx:30>), `:100`, `:177` | Company creation does not invalidate options or update AddUserForm's local state; `router.refresh()` preserves that state |
| Created user's password disappears immediately | [admin/AdminManageClient.tsx:120](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/AdminManageClient.tsx:120>) | Success tells admin to share the password, but the field immediately contains a newly generated password for the next user |
| User recovery is unfinished | [login/page.tsx:140](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/login/page.tsx:140>), [admin/AdminManageClient.tsx:45](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/AdminManageClient.tsx:45>) | Forgot password has no handler; no forced first-login reset flow supports the temporary-password comment |
| Reminder cache becomes stale and is not user-scoped | [NotificationBell.tsx:8](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/NotificationBell.tsx:8>), [SignOutButton.tsx:17](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/SignOutButton.tsx:17>) | No invalidation on done/save/sign-out; client navigation between accounts can reuse previous account reminder data until a reload or explicit priming |

Reproduced locally without database access:

- Starting Monday 21 September 2026 at 15:30 UTC, the Next Monday shortcut produces Thursday 24 September at 15:30 UTC.
- Under `Asia/Karachi`, `new Date(2026, 8, 1).toISOString().slice(0, 10)` produces `2026-08-31`.
- `2025 - Individual | 2026 - Group` becomes a home-page map with only a `2025` key; a filter reading `mipsByYear[2026]` misses it.

Additional rule inconsistencies:

- Assignment upserts on `(practice_id,assigned_to)`, so assignment to another person retains prior recipients rather than moving the lead. This may support hierarchical access, but the comments describing replacement do not match the implementation. Origin selection is also arbitrary when multiple existing assignments differ.
- Managers/TLs can assign any company-owned/allocated practice accepted by the action, even though the home page only lists practices assigned to them. Decide whether that is intended authority.
- The UI disables individual selection for leads already assigned away, but select-all and range selection still include those leads.
- Worksheet disposition `Sold` can be saved without creating a sale. Conversely, closing a sale does not update `ws_disposition`, so detail status can remain stale. `Sold` and `SOLD` also differ between paths.
- Saving disposition `New` does not log activity, so a saved worksheet can still be absent from the Worked Leads set.
- The closer list includes the caller even when they are an agent, while the sale action permits only closer/company-admin roles. Self-transfer therefore does not give an agent sale-closing capability.
- Company reactivation marks every user active, including those inactive before company suspension. This behavior is acknowledged in source comments, but needs an explicit business decision.
- Soft deletion intentionally hides the platform pool entry while keeping allocated company access, as stated in the confirmation. This is not itself a defect; reporting and deletion semantics should reflect that policy consistently.

## 7. Scale, data accuracy, and reliability

The home page paginates the main practice reads internally, then sends the entire transformed dataset to the client and renders eight rows per UI page. This limits DOM work but does not limit query, memory, serialization, or network cost. Many supporting reads are not paginated: assignments, allocations, activity, sales, reminders, users, clients, transfers, and deleted leads. Where the server's row limit is lower than the result set, these reads silently truncate unless explicitly handled.

Consequences include incomplete lead visibility, missing last-dialed/worked flags, incomplete assignment counts, and understated revenue. Dashboard activity count uses an exact count, while its breakdown is computed from returned rows, so those two figures can disagree. Worksheet reports deliberately stop at 300 and disclose it, but offer no way to retrieve older entries. Activity history stops at 20 without older-history navigation. Practice next/previous navigation fetches an unpaginated broad code list that does not mirror the home filters.

Many query errors are converted into empty arrays or zero metrics. Users cannot distinguish an empty dataset from a failed query. Some mutation failures are ignored. Many UI handlers lack `try/finally`, leaving busy state stuck if a server action throws. Transfer, sale, assignment, and allocation submissions do not all prevent repeat clicks.

Use database aggregation for dashboard sums/counts, stable ordered server pagination, bounded batches, structured error handling, and one shared scope implementation. Confirm indexes with real query plans after obtaining the schema. Candidate access paths include user auth ID, tenant + status, practice code/owner, assignment recipient/status, allocation tenant/status, activity practice/time, and reminder agent/time; existing indexes were not inspected.

Input validation is minimal. Server actions need runtime shape/length/enum checks, finite non-negative monetary validation, proper dates, meaningful NPI validation, and bounded import/bulk-action sizes. The 20 MB Server Action limit is a request limit, not a complete import-validation strategy. CSV parsing handles quotes, commas, and embedded newlines, but does not reject malformed quoting, duplicate headers, or inconsistent row widths.

Imports accept generic name/state/specialty columns but classify a row as an anchor only with `Source=uploaded` or both PECOS and enrollment IDs. A simple NPI/name file can successfully import records that are all hidden as roster entries. Provide an explicit import contract, validation preview, and accurate counts for blank/duplicate rows.

## 8. UI, accessibility, and unfinished features

Positive foundations: responsive grid rules, table overflow containers, light/dark tokens, reduced-motion handling, labeled icon buttons, and keyboard-operated SectionTabs. Tab panels stay mounted, preserving form state when switching tabs.

Source-level gaps:

- The distribution console's target selector, year/enrichment filters, and some distribution/export controls are placeholders. Several are labeled sample, which is helpful but does not make them functional.
- Incentive payments and splits are sample dashboard values. There is no commissions engine in the source.
- The profile contains placeholder opportunity/history/score content despite imported MIPS data elsewhere.
- Expandable table rows are mouse click targets without equivalent keyboard buttons. Many worksheet/admin labels are not connected to inputs by `htmlFor`/IDs.
- The mobile drawer lacks focus trapping, Escape handling, and explicit modal state. The notification dropdown also lacks expanded-state/focus handling.
- Worksheet reports omit `showTransfers` when mounting AppShell, making that sidebar entry disappear on this route.
- The shell is per-page rather than persistent; collapse state can reset across routes. Numerous internal `<a>` links trigger full page loads.
- Core styles are spread across base CSS, override CSS, and extensive inline styles; unused reference CSS duplicates competing visual systems. Source comments about absent brand assets are stale: multiple logo PNGs exist.
- Tailwind utility classes in the root layout have no evident active Tailwind import. Most visible styling is custom CSS.

Actual contrast, mobile overflow, screen-reader behavior, and hydration should be tested in the browser before making visual-quality claims.

## 9. Unused and hazardous legacy paths

- `AppChrome.tsx`, `PageChrome.tsx`, and `get-shell-user.ts` are an unmounted alternative shell. The shell helper always returns Super Admin. Do not connect it to the layout without implementing real profile lookup.
- `verified-user.ts` trusts an incoming `x-user-id` header, but the middleware does not set or overwrite it. It currently has no caller; this is a latent vulnerability, not a demonstrated active authentication bypass.
- `super-allocate-actions.ts` is not called by the active allocation UI.
- `practice/[code]/WorkPanel.tsx` is superseded by `Worksheet.tsx` and has no component caller.
- `admin/WorksheetReportsClient.tsx` is superseded by the report-route component.
- `lib/supabase.ts` and `lib/supabase-client.ts` have no application callers; active auth uses the SSR browser/server factories.
- Large commented-out implementations remain in `actions.ts`, `upload-actions.ts`, and `roster-actions.ts`.
- `.ui-backup` holds prior source copies, static previews, and a preview helper. It is not part of the active route graph and should not be confused with the running product.

## 10. Verification results

| Check | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed with current installed dependencies |
| ESLint over `app`, `lib`, `middleware.ts`, `next.config.ts` | Failed: 295 errors, 10 warnings across 65 checked files |
| Dominant lint rule | 290 `@typescript-eslint/no-explicit-any` findings |
| Other lint findings | Hook rules, internal HTML links, prefer-const, unused declarations/expressions, image optimization, unused suppression |
| `npm run build` | Failed fetching Fraunces, Inter Tight, and JetBrains Mono from Google Fonts in this environment |
| Next build warning | `middleware.ts` convention deprecated; installed docs specify migration to `proxy.ts` |
| `npm ls --depth=0` | Main declared dependencies present; `lucide-react@1.46.0` is extraneous |
| Automated business tests | No test suite/script found |

The build failure is an observed network-dependent font failure, not proof of a source compilation failure. A complete production build still needs to pass. Local/self-hosted fonts would remove this dependency if desired.

`AppChrome.tsx` imports `lucide-react`, which is installed locally but absent from both dependency declarations and lockfile. A clean install can therefore fail type checking even though the current local check passes. Remove the unused import path or declare the dependency deliberately.

The Worksheet purity lint diagnostic points at a callback invoked by an event handler; that warning should be evaluated in context rather than treated as proof that the code invokes Date.now during render.

No vulnerability-advisory audit or deployed infrastructure review was performed. Installed version numbers alone do not establish security status.

## 11. Repair order

1. Obtain/version the actual database schema, RLS policies, RPCs, constraints, and migration history. Confirm practice-code uniqueness and tenant allocation rules.
2. Centralize active-account, tenant, practice, role, and recipient authorization. Verify it against two companies and every role.
3. Make import, transfer, sale, and deletion transactional and retry-safe. Add precise deletion-impact calculation.
4. Unify allocation/assignment/reporting scope; fix allocated-lead unassignment and role preview.
5. Correct timezone conversion, callback shortcuts, reminder reconciliation, and date-range calculations.
6. Aggregate/paginate at the database; show failed reads explicitly; make dashboard denominators consistent.
7. Finish password recovery/onboarding and stale-cache handling; fix initial company selection and form-state refreshes.
8. Remove unused unsafe helpers/duplicate implementations, generate database types, resolve lint, and prove a clean-install build.
9. Add focused integration tests for permissions, cross-company access, retries/rollback, concurrent allocation/sale, bulk data over row limits, and timezone boundaries. Perform authenticated browser QA on all 13 routes.

The main strengths worth preserving are the complete workflow coverage, explicit role hierarchy, use of cookie-authenticated server clients, separation of the service-role key from public variables, transfer locking in worksheet save, useful tab state preservation, and honest labeling of several placeholder metrics.


## 12. Complete application/library file inventory

Line counts include comments and blank lines. Page responsibilities are described in the route map above.

| File | Lines | Responsibility |
|---|---:|---|
| [app/AppChrome.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/AppChrome.tsx>) | 175 | Unused alternative persistent shell; undeclared lucide dependency |
| [app/AppShell.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/AppShell.tsx>) | 194 | Active per-page navigation, identity, theme and reminder shell |
| [app/BrandLogo.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/BrandLogo.tsx>) | 9 | Artwork component referenced by unused AppChrome |
| [app/NotificationBell.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/NotificationBell.tsx>) | 134 | Lazy reminder preview with module-level cache |
| [app/OrgRoster.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/OrgRoster.tsx>) | 101 | On-demand organization roster display |
| [app/PageChrome.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/PageChrome.tsx>) | 48 | Unused context for alternative shell page headings |
| [app/PracticesTable.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/PracticesTable.tsx>) | 745 | Lead filtering, selection, allocation, assignment and client pagination |
| [app/SectionTabs.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/SectionTabs.tsx>) | 30 | Keyboard-operable tabs with mounted panels |
| [app/SignOutButton.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/SignOutButton.tsx>) | 57 | Supabase sign-out and navigation |
| [app/ThemeToggle.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/ThemeToggle.tsx>) | 22 | Local-storage dark/light selection |
| [app/UploadLeadsButton.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/UploadLeadsButton.tsx>) | 96 | Client CSV parser and upload control |
| [app/Worksheet.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/Worksheet.tsx>) | 228 | Active worksheet, callback, transfer and sale form |
| [app/actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/actions.ts>) | 902 | Allocation, activity, reminders, transfers, sales, lead deletion/restoration; includes commented legacy copy |
| [app/admin-manage-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin-manage-actions.ts>) | 269 | Company lifecycle and hierarchical Auth/profile user creation |
| [app/admin/AdminManageClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/AdminManageClient.tsx>) | 182 | Company/user creation forms and option caches |
| [app/admin/AdminUsersByCompanyClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/AdminUsersByCompanyClient.tsx>) | 83 | Company-selection team display |
| [app/admin/CompaniesTable.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/CompaniesTable.tsx>) | 110 | Suspend/reactivate/delete controls and confirmations |
| [app/admin/WorksheetReportsClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/WorksheetReportsClient.tsx>) | 156 | Unused earlier worksheet report table |
| [app/admin/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/page.tsx>) | 247 | Route entry: /admin |
| [app/admin/view/RoleViewClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/view/RoleViewClient.tsx>) | 115 | Role/user selector and simulated lead view |
| [app/admin/view/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/admin/view/page.tsx>) | 44 | Route entry: /admin/view |
| [app/agent-assigned-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/agent-assigned-actions.ts>) | 80 | Management assignment overview |
| [app/agent-assigned/AgentAssignedClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/agent-assigned/AgentAssignedClient.tsx>) | 108 | Per-agent/closer assigned-lead display |
| [app/agent-assigned/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/agent-assigned/page.tsx>) | 47 | Route entry: /agent-assigned |
| [app/assign-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/assign-actions.ts>) | 130 | Company ownership/allocation and junior-role assignment checks |
| [app/assignments/AssignmentsClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/assignments/AssignmentsClient.tsx>) | 134 | Caller assignment listing and removal UI |
| [app/assignments/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/assignments/page.tsx>) | 47 | Route entry: /assignments |
| [app/auth-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/auth-actions.ts>) | 39 | Post-login account/company suspension check |
| [app/clients/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/clients/page.tsx>) | 95 | Route entry: /clients |
| [app/dashboard/Charts.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/Charts.tsx>) | 86 | SVG funnel and disposition donut |
| [app/dashboard/DashboardView.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/DashboardView.tsx>) | 236 | Real KPI display and labeled sample incentive panels |
| [app/dashboard/DateRangePicker.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/DateRangePicker.tsx>) | 46 | URL date filters and current-month reset |
| [app/dashboard/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/dashboard/page.tsx>) | 136 | Route entry: /dashboard |
| [app/deleted-leads/DeletedLeadsTable.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/deleted-leads/DeletedLeadsTable.tsx>) | 252 | Search, restore, permanent-delete selections and confirmations |
| [app/deleted-leads/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/deleted-leads/page.tsx>) | 110 | Route entry: /deleted-leads |
| [app/design-system.css](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/design-system.css>) | 242 | Active visual overrides, login, charts, roster, tabs, responsiveness |
| [app/globals.css](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/globals.css>) | 627 | Active base theme tokens and component layouts |
| [app/layout.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/layout.tsx>) | 47 | Root metadata, fonts, stylesheets, initial theme script |
| [app/login/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/login/page.tsx>) | 160 | Route entry: /login |
| [app/manage-assignments-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/manage-assignments-actions.ts>) | 156 | Assignment summaries, origin codes, removal |
| [app/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/page.tsx>) | 375 | Route entry: / |
| [app/practice/[code]/WorkPanel.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/practice/[code]/WorkPanel.tsx>) | 240 | Unused predecessor to Worksheet |
| [app/practice/[code]/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/practice/[code]/page.tsx>) | 615 | Route entry: /practice/[code] |
| [app/reference.css](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/reference.css>) | 240 | Unused competing visual stylesheet |
| [app/reminders-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/reminders-actions.ts>) | 132 | Scoped reminders and ownership-aware completion |
| [app/reminders/RemindersClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/reminders/RemindersClient.tsx>) | 122 | Overdue/upcoming lists and completion state |
| [app/reminders/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/reminders/page.tsx>) | 56 | Route entry: /reminders |
| [app/role-view-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/role-view-actions.ts>) | 126 | Super Admin simulation of user lead access |
| [app/roster-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/roster-actions.ts>) | 112 | Roster RPC and worksheet-editor enrichment |
| [app/super-allocate-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/super-allocate-actions.ts>) | 104 | Unused exclusive allocation implementation |
| [app/transfers-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/transfers-actions.ts>) | 154 | Scoped transfer listing and worksheet/user/company enrichment |
| [app/transfers/TransfersClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/transfers/TransfersClient.tsx>) | 252 | Company/personal transfer table with expanded worksheet |
| [app/transfers/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/transfers/page.tsx>) | 50 | Route entry: /transfers |
| [app/upload-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/upload-actions.ts>) | 490 | CSV row import through five data stages |
| [app/worksheet-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-actions.ts>) | 94 | Latest worksheet save, transfer lock and callback insertion |
| [app/worksheet-reports-actions.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-reports-actions.ts>) | 158 | Management worksheet report query and enrichment |
| [app/worksheet-reports/WorksheetReportsClient.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-reports/WorksheetReportsClient.tsx>) | 246 | Active grouped/paginated latest-worksheet report UI |
| [app/worksheet-reports/page.tsx](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/app/worksheet-reports/page.tsx>) | 67 | Route entry: /worksheet-reports |
| [lib/get-shell-user.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/get-shell-user.ts>) | 12 | Unused hardcoded Super Admin identity stub |
| [lib/roles.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/roles.ts>) | 31 | Canonical role labels and descriptive permission table |
| [lib/supabase-admin.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/supabase-admin.ts>) | 25 | Service-role Auth administration client |
| [lib/supabase-browser.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/supabase-browser.ts>) | 8 | Active SSR-compatible browser auth client |
| [lib/supabase-client.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/supabase-client.ts>) | 8 | Unused plain browser singleton |
| [lib/supabase-server.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/supabase-server.ts>) | 27 | Cookie-based server client factory |
| [lib/supabase.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/supabase.ts>) | 6 | Unused plain SDK singleton |
| [lib/verified-user.ts](<C:/Users/PC/Music/Sales-Crm-main-restyled (6)/Sales-Crm-main/lib/verified-user.ts>) | 24 | Unused unsafe header-trusting identity helper |

Configuration/support inventory: `package.json` and `package-lock.json` define installation; `tsconfig.json` enables strict TypeScript; `next.config.ts` raises action bodies to 20 MB; `middleware.ts` refreshes sessions; `eslint.config.mjs` supplies Next/TypeScript rules; `postcss.config.mjs` registers Tailwind; `next-env.d.ts` and `tsconfig.tsbuildinfo` are generated tooling state; `AGENTS.md`/`CLAUDE.md` carry local instructions; `.gitignore` excludes dependencies, build output and environment files; `.env.local` supplies the three Supabase variable names described below. README is the scaffold documentation and has an apparent encoding artifact at its end.

Environment names present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Presence does not establish validity or deployed configuration.

Assets: application favicon; `brand-logo.png`, `logo-full.png`, `logo-mark.png`; default Next/Vercel/file/globe/window SVGs. The active AppShell uses a text HB mark, and the login uses a text logotype. Backup previews and old source copies live under `.ui-backup`; generated runtime artifacts and installed third-party packages were inventoried rather than audited line by line.

