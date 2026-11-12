// Builds the Leads page data (moved unchanged from app/page.tsx) so both the
// page and the server-paged lead action (app/leads-page-actions.ts) use the
// exact same rules. Imports use '../lib/...' paths on purpose: they resolve
// to the same files from here and match the test harness mocks.
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { roleLabel } from '../lib/roles'
import { redirect } from 'next/navigation'
import { mapConcurrent, readAllPages, rowsViaRpc } from '../lib/query-utils'
import { decodeFlatLead } from '../lib/lead-pack'
import { allRows } from '../lib/practice-navigation'
import { mapLeadRow, type LeadRowMapContext } from './lead-row-map' // ← ADDED

export async function loadLeadsData() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  // ← CHANGED: Manager can no longer upload lead CSVs (Company Admin / Super Admin only).
  const canUpload = ['company_admin', 'super_admin'].includes(roleKey)
  const canAssign = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const showTransfers = true
  const canManageUsers = isSuperAdmin || canAssign
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  const SELECT = `
    id, practice_code, name, state, specialty, owner_tenant_id, created_at, lead_activity(created_at),
    ${canAssign ? 'assigned_away:lead_assignments(assigned_at, users!lead_assignments_assigned_to_fkey(full_name, roles(key, label))),' : ''}
    practice_providers (
      providers (
        npi, org_name, nppes_sex, nppes_last_updated, payment_adj_pct, at_risk, record_source, entity_type, enumeration_date,
        provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit ),
        provider_mips ( performance_year, status, reporting_option )
      )
    )
  `
  const PAGE = 1000
  const CHUNK_IDS = 300

  // Page 0 also asks for an exact row count, so every remaining page can be
  // requested at once instead of ramping up 1 -> 1 -> 4 pages per round trip.
  const fetchPagedRows = async <T,>(
    readPage: (from: number, to: number, withCount: boolean) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>
  ): Promise<T[]> => readAllPages<T>(readPage, { pageSize: PAGE, concurrency: 6 })

  // `id` is the final sort key so concurrent page ranges never overlap or skip
  // rows (sorting by name alone is not unique).
  const leadQuery = (withCount: boolean) =>
    supabase.from('master_practices').select(SELECT, withCount ? { count: 'exact' } : undefined)
  const fetchAllPaged = async (makeQuery: (withCount: boolean) => any) => {
    return fetchPagedRows((from, to, withCount) => {
      let query = makeQuery(withCount)
      if (canAssign) query = query.eq('assigned_away.assigned_by', myUserId).eq('assigned_away.status', 'active')
      return query.order('created_at', { referencedTable: 'lead_activity', ascending: false })
        .limit(1, { referencedTable: 'lead_activity' }).range(from, to)
    })
  }

  // One database round trip per lead read (crm_lead_rows in
  // database/performance-rpc.sql). Same row shape as the nested select above.
  // If the function is not installed or fails, the original paged queries run.
  const assignedBy = canAssign ? (myUserId ?? null) : null
  // Default: crm_lead_rows_flat (database/performance-rpc-v4.sql; compact
  // rows, ~36% less to download and less database memory), decoded back into
  // the same nested shape. If it is missing or fails: crm_lead_rows (v3), then
  // the original queries. Set CRM_COMPACT_LEAD_RPC=0 to skip it entirely.
  const compactLeadRpc = process.env.CRM_COMPACT_LEAD_RPC !== '0'
  const leadRpc = async (args: Record<string, unknown>, fallback: () => Promise<any[]>) => {
    const params = { p_assigned_by: assignedBy, ...args }
    if (!compactLeadRpc) return rowsViaRpc<any>(supabase, 'crm_lead_rows', params, fallback)
    let compact = true
    const rows = await rowsViaRpc<any>(supabase, 'crm_lead_rows_flat', params, () => {
      compact = false
      return rowsViaRpc<any>(supabase, 'crm_lead_rows', params, fallback)
    })
    return compact ? rows.map(decodeFlatLead) : rows
  }

  const fetchByIds = async (idsIn: string[]) => {
    const ids = Array.from(new Set((idsIn ?? []).filter((id) => typeof id === 'string' && id.length > 0)))
    if (ids.length === 0) return []
    return leadRpc({ p_mode: 'ids', p_ids: ids }, () => fetchByIdsPaged(ids))
  }
  const fetchByIdsPaged = async (ids: string[]) => {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += CHUNK_IDS) chunks.push(ids.slice(i, i + CHUNK_IDS))
    const results = await mapConcurrent(chunks, 4, (chunk) =>
        fetchAllPaged((withCount: boolean) =>
          leadQuery(withCount).in('id', chunk).eq('is_roster', false).order('name').order('id')
        )
    )
    return results.flat()
  }

  // Start the independent lead scan while dropdown/allocation metadata loads.
  // Capture errors immediately so an early rejection cannot go unhandled.
  const earlyLeadRead = isSuperAdmin || roleKey === 'company_admin'
    ? leadRpc(isSuperAdmin ? { p_mode: 'all' } : { p_mode: 'owner', p_tenant: myTenantId ?? null },
        () => fetchAllPaged((withCount) => {
          let query = leadQuery(withCount).eq('is_roster', false).order('name').order('id')
          query = isSuperAdmin ? query.is('deleted_at', null) : query.eq('owner_tenant_id', myTenantId)
          return query
        })).then(data => ({ data, error: null }), error => ({ data: [], error }))
    : null
  // These reads depend only on the verified profile, not on each other.
  // Reuse assignment/allocation results instead of fetching the same rows twice.
  const assignmentScoped = ['agent', 'closer', 'manager', 'team_lead'].includes(roleKey)
  const empty = { data: [] }
  const assignmentsRead = Promise.resolve(assignmentScoped || canAssign
    ? allRows<any>(() => supabase.from('lead_assignments')
        .select('practice_id, assigned_at, current_status, master_practices(practice_code)')
        .eq('assigned_to', myUserId).eq('status', 'active').order('practice_id'))
        .then(data => ({ data }))
    : empty)
  const transfersRead = Promise.resolve(roleKey === 'closer'
    ? allRows<{ practice_id: string; created_at: string }>(() => supabase.from('lead_transfers')
        .select('practice_id, created_at').eq('to_user_id', myUserId).order('practice_id').order('id'))
        .then(data => ({ data }))
    : empty)
  const scopeIdsRead = Promise.all([assignmentsRead, transfersRead]).then(results =>
    Array.from(new Set(results.flatMap(result => (result.data ?? []).map(row => row.practice_id)).filter(Boolean)))
  )
  // Start as soon as permissions resolve; dropdowns and unrelated metadata
  // must not hold up the main data request for agents/managers/closers.
  const scopedLeadRead = assignmentScoped
    ? scopeIdsRead.then(fetchByIds).then(data => ({ data, error: null }), error => ({ data: [], error }))
    : null
  const readAllocations = async () => {
    const tenantScope = !isSuperAdmin && myTenantId ? myTenantId : null
    const rows = await rowsViaRpc<any>(supabase, 'crm_active_allocations', { p_tenant: tenantScope }, () => fetchPagedRows((from, to, withCount) => {
      let query = supabase.from('lead_allocations')
        .select('practice_id, tenant_id, allocated_at, master_practices(practice_code), tenants(name)', withCount ? { count: 'exact' } : undefined)
        .eq('status', 'active')
      if (!isSuperAdmin && myTenantId) query = query.eq('tenant_id', myTenantId)
      return query.order('practice_id').order('tenant_id').range(from, to)
    }))
    // Missing allocation data must not make assigned leads appear unassigned.
    return { data: rows }
  }

  // Read every page: a single request is capped at 1,000 rows by Supabase, which
  // silently dropped claims/worksheets beyond the first 1,000.
  const claimsRead = !isSuperAdmin && myTenantId
    ? allRows<any>(() => supabase.from('lead_company_claims').select('practice_id, tenant_id')
        .eq('status', 'active').order('practice_id').order('id')).then(data => ({ data }))
    : Promise.resolve(empty)
  const worksheetsRead = !isSuperAdmin && myTenantId
    ? allRows<any>(() => supabase.from('lead_worksheets').select('practice_id, updated_by, disposition, updated_at')
        .eq('tenant_id', myTenantId).order('practice_id').order('id')).then(data => ({ data }))
    : Promise.resolve(empty)

  // ← ADDED: which leads are Email leads (Lead_Category = Email), and — for
  // an Agent/Closer — which Email leads they already saved an email worksheet
  // for (those leave their queue, like a saved call worksheet). Missing
  // tables/columns (SQL not run yet) simply mean "none".
  const emailLeadsRead = allRows<{ id: string }>(() => supabase.from('master_practices').select('id')
    .eq('lead_category', 'Email').order('id')).catch(() => [] as { id: string }[])
  const myEmailWorksheetsRead = (roleKey === 'agent' || roleKey === 'closer') && myTenantId && myUserId
    ? allRows<{ practice_id: string }>(() => supabase.from('lead_email_worksheets').select('practice_id')
        .eq('tenant_id', myTenantId).eq('updated_by', myUserId).order('practice_id')).catch(() => [] as { practice_id: string }[])
    : Promise.resolve([] as { practice_id: string }[])

  const [assignmentsResult, transfersResult, allocationsResult, claimsResult, worksheetsResult, emailLeadRows, myEmailWorksheetRows] = await Promise.all([
    assignmentsRead, transfersRead, readAllocations(), claimsRead, worksheetsRead, emailLeadsRead, myEmailWorksheetsRead, // ← CHANGED
  ])
  const emailLeadIds = new Set(emailLeadRows.map((row) => row.id)) // ← ADDED
  const myEmailSavedIds = new Set(myEmailWorksheetRows.map((row) => row.practice_id)) // ← ADDED
  const currentUser = me ? {
    full_name: me.full_name,
    role: roleLabel(me.roles?.key),
    company: me.tenants?.name ?? 'Unknown',
  } : null

  const allocatedOn: Record<string, string> = {}
  const allocationDatesByPractice: Record<string, { tenantId: string; allocatedAt: string | null }[]> = {}
  const leadStatus: Record<string, string> = {}
  for (const a of (assignmentsResult.data ?? []) as any[]) {
    if (a.practice_id && assignmentScoped) {
      allocatedOn[a.practice_id] = a.assigned_at
      leadStatus[a.practice_id] = a.current_status ?? ''
    }
  }
  for (const t of (transfersResult.data ?? []) as any[]) {
    if (t.practice_id) {
      if (!allocatedOn[t.practice_id]) allocatedOn[t.practice_id] = t.created_at
      if (!leadStatus[t.practice_id]) leadStatus[t.practice_id] = 'Transferred'
    }
  }
  for (const allocation of (allocationsResult.data ?? []) as any[]) {
    if (allocation.practice_id && allocation.tenant_id) {
      const dates = allocationDatesByPractice[allocation.practice_id] ??= []
      dates.push({ tenantId: allocation.tenant_id, allocatedAt: allocation.allocated_at ?? null })
    }
  }
  const myAssignedCodes = canAssign ? (assignmentsResult.data ?? [])
    .map((r: any) => r.master_practices?.practice_code).filter(Boolean) : []
  const myAllocatedIds = !isSuperAdmin && myTenantId ? (allocationsResult.data ?? [])
    .map((a: any) => a.practice_id).filter((id: unknown) => typeof id === 'string' && id.length > 0) : []
  const allocatedCodeSet = new Set<string>()
  const allocatedCompanyByCode: Record<string, { id: string; name: string }[]> = {}
  for (const a of (allocationsResult.data ?? []) as any[]) {
    const code = a.master_practices?.practice_code
    if (code) {
      allocatedCodeSet.add(code)
      if (isSuperAdmin && a.tenant_id) {
        const companies = allocatedCompanyByCode[code] ??= []
        if (!companies.some(company => company.id === a.tenant_id)) {
          companies.push({ id: a.tenant_id, name: a.tenants?.name ?? 'Unknown company' })
        }
      }
    }
  }
  const claimedByOtherCompany = new Set<string>()
  for (const claim of (claimsResult.data ?? []) as any[]) {
    if (claim.tenant_id !== myTenantId) claimedByOtherCompany.add(claim.practice_id)
  }
  const myWorksheetByPractice = new Map<string, any>()
  for (const worksheet of (worksheetsResult.data ?? []) as any[]) {
    myWorksheetByPractice.set(worksheet.practice_id, worksheet)
  }

  let data: any[] = []
  let error: any = null
  try {
    if (isSuperAdmin) {
      // All ANCHOR practices EXCEPT soft-deleted (roster members hidden).
      const result = await earlyLeadRead!
      if (result.error) throw result.error
      data = result.data
    } else if (roleKey === 'agent' || roleKey === 'closer' || roleKey === 'manager' || roleKey === 'team_lead') {
      const result = await scopedLeadRead!
      if (result.error) throw result.error
      data = result.data
    } else {
      // Company Admin only: OWNED + ALLOCATED — anchors only, roster hidden.
      const [owned, allocated] = await Promise.all([
        earlyLeadRead ? earlyLeadRead.then(result => {
          if (result.error) throw result.error
          return result.data
        }) : leadRpc({ p_mode: 'owner', p_tenant: myTenantId ?? null }, () => fetchAllPaged((withCount) =>
          leadQuery(withCount).eq('owner_tenant_id', myTenantId).eq('is_roster', false).order('name').order('id')
        )),
        fetchByIds(myAllocatedIds),
      ])
      data = [...owned, ...allocated]
    }
  } catch (e: any) {
    error = e
  }

  if (error) return { kind: 'error' as const, error }

  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  if (!isSuperAdmin && claimedByOtherCompany.size) {
    data = data.filter((p: any) => !claimedByOtherCompany.has(p.id))
  }
  // Count completed worksheets before removing them from the personal active
  // queue. Otherwise the Worked card always drops back to zero after save.
  const completedWorksheetCount = isAgentOrCloser
    ? new Set(data.filter(p => myWorksheetByPractice.get(p.id)?.updated_by === myUserId || myEmailSavedIds.has(p.id)).map(p => p.practice_code)).size // ← CHANGED: + email worksheets
    : undefined
  // Saving a worksheet completes the lead for that Agent/Closer. Keep it in
  // management views and Worksheet Reports, but remove it from the saver’s
  // active queue. A later assignee can still work the lead because the saved
  // user id is compared with the current viewer rather than treated globally.
  if (isAgentOrCloser) {
    data = data.filter(p => myWorksheetByPractice.get(p.id)?.updated_by !== myUserId && !myEmailSavedIds.has(p.id)) // ← CHANGED: saved email worksheet also completes it
  }
  const seen = new Set<string>()
  data = data.filter((p: any) => {
    if (seen.has(p.practice_code)) return false
    seen.add(p.practice_code)
    return true
  })

  const lastDialed: Record<string, string> = {}
  const workedPracticeIds = new Set<string>()
  for (const practice of data) {
    const latest = practice.lead_activity?.[0]?.created_at
    if (latest) {
      workedPracticeIds.add(practice.id)
      lastDialed[practice.id] = latest
    }
  }
  const newLeadCodes = new Set<string>()
  const workedLeadCodes = new Set<string>()
  {
    const timestamps = data
      .map((p: any) => p.created_at)
      .filter(Boolean)
      .map((s: string) => new Date(s).getTime())
    if (timestamps.length) {
      const maxT = timestamps.reduce((max: number, value: number) => Math.max(max, value), -Infinity)
      const windowMs = 5 * 60 * 1000
      for (const p of data) {
        if (p.created_at) {
          const t = new Date(p.created_at).getTime()
          if (maxT - t <= windowMs) newLeadCodes.add(p.practice_code)
        }
        if (workedPracticeIds.has(p.id)) workedLeadCodes.add(p.practice_code)
      }
    } else {
      for (const p of data) {
        if (workedPracticeIds.has(p.id)) workedLeadCodes.add(p.practice_code)
      }
    }
  }

  // ← CHANGED: the row building moved, unchanged, to lib/lead-row-map.ts so the
  // database-paged Lead Pool builds rows with exactly the same code.
  const rowMapContext: LeadRowMapContext = {
    canAssign, allocatedOn, leadStatus, lastDialed, allocatedCodeSet, allocatedCompanyByCode, emailLeadIds,
  }
  const practices = data.map((p: any) => mapLeadRow(p, rowMapContext))


  return {
    kind: 'ok' as const,
    authUserId: user.id as string,
    tenantId: (myTenantId ?? null) as string | null,
    currentUser, roleKey, isSuperAdmin, canUpload, canAssign, showTransfers, canManageUsers,
    myUserId: myUserId as string | undefined,
    practices,
    myAssignedCodes: myAssignedCodes as string[],
    newLeadCodes: Array.from(newLeadCodes),
    workedLeadCodes: Array.from(workedLeadCodes),
    completedWorksheetCount,
  }
}

export type LeadsData = Extract<Awaited<ReturnType<typeof loadLeadsData>>, { kind: 'ok' }>
