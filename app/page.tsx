import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { roleLabel } from '../lib/roles'
import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import { redirect } from 'next/navigation'
import AppShell from './AppShell'
import { mapConcurrent, readAllPages, rowsViaRpc, compactRow } from '../lib/query-utils'
import { allRows } from '../lib/practice-navigation'

export default async function Home() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canUpload = ['company_admin', 'manager', 'super_admin'].includes(roleKey)
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
  const leadRpc = (args: Record<string, unknown>, fallback: () => Promise<any[]>) =>
    rowsViaRpc<any>(supabase, 'crm_lead_rows', { p_assigned_by: assignedBy, ...args }, fallback)

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
        .select('practice_id, created_at').eq('to_user_id', myUserId).order('practice_id'))
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

  const [assignmentsResult, transfersResult, allocationsResult, claimsResult, worksheetsResult] = await Promise.all([
    assignmentsRead, transfersRead, readAllocations(), claimsRead, worksheetsRead,
  ])
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

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ color: 'red' }}>Error loading practices</h1>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#f66' }}>{JSON.stringify({
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
        }, null, 2)}</pre>
      </div>
    )
  }

  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  if (!isSuperAdmin && claimedByOtherCompany.size) {
    data = data.filter((p: any) => !claimedByOtherCompany.has(p.id))
  }
  // Count completed worksheets before removing them from the personal active
  // queue. Otherwise the Worked card always drops back to zero after save.
  const completedWorksheetCount = isAgentOrCloser
    ? new Set(data.filter(p => myWorksheetByPractice.get(p.id)?.updated_by === myUserId).map(p => p.practice_code)).size
    : undefined
  // Saving a worksheet completes the lead for that Agent/Closer. Keep it in
  // management views and Worksheet Reports, but remove it from the saver’s
  // active queue. A later assignee can still work the lead because the saved
  // user id is compared with the current viewer rather than treated globally.
  if (isAgentOrCloser) {
    data = data.filter(p => myWorksheetByPractice.get(p.id)?.updated_by !== myUserId)
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

  const practices = data.map((p: any) => {
    const provider = p.practice_providers?.[0]?.providers
    const s = provider?.provider_signals ?? {}
    const assignedAwayRows: {
      assigned_at?: string | null
      users?: { full_name: string | null; roles?: { key: string | null } | null } | null
    }[] = Array.isArray(p.assigned_away) ? p.assigned_away : []
    const latestAssignedAway = assignedAwayRows.reduce<(typeof assignedAwayRows)[number] | null>((latest, assignment) =>
      !latest || String(assignment.assigned_at ?? '') > String(latest.assigned_at ?? '') ? assignment : latest, null)
    const mipsRows = Array.isArray(provider?.provider_mips) ? provider.provider_mips : []
    // Both "NPPES - Found" and "NPPES - Not Found" count as having
    // credentialing data — only a genuinely blank Record_Source (no NPPES
    // lookup attempted at all) is excluded from the Credentialing filter.
    // Only a confirmed NPPES match counts as Credentialing — "Not Found"
    // (and blank) are excluded. "NPPES - Not Found" contains the substring
    // "found" too, so it must be checked for explicitly rather than a
    // plain .includes('found').
    const recordSourceLower = (provider?.record_source ?? '').toString().trim().toLowerCase()
    const npiFound = recordSourceLower.includes('found') && !recordSourceLower.includes('not found')
    const mipsByYear: Record<number, string> = {}
    for (const m of mipsRows) {
      const raw = (m.reporting_option ?? m.status ?? '').toString().trim()
      let year = m.performance_year
      if (!year) {
        const match = raw.match(/^(\d{4})/)
        if (match) year = parseInt(match[1], 10)
      }
      if (year) {
        const statusText = raw.replace(/^\d{4}\s*-\s*/, '')
        mipsByYear[year] = statusText || raw
      }
    }

    return {
      practiceCode: p.practice_code,
      allocatedOn: (canAssign ? latestAssignedAway?.assigned_at : null) ?? allocatedOn[p.id] ?? null,
      allocationDates: allocationDatesByPractice[p.id] ?? [],
      status: leadStatus[p.id] ?? null,
      assignedAwayTo: canAssign && latestAssignedAway?.users
        ? { name: latestAssignedAway.users.full_name ?? '', role: roleLabel(latestAssignedAway.users.roles?.key) }
        : null,
      source: allocatedCodeSet.has(p.practice_code) ? 'Allocated' : 'Uploaded',
      allocatedTo: allocatedCompanyByCode[p.practice_code]?.map(company => company.name).join(', ') ?? null,
      allocatedCompanies: allocatedCompanyByCode[p.practice_code] ?? [],
      name: p.name,
      state: p.state,
      specialty: p.specialty,
      sex: provider?.nppes_sex ?? null,
      orgName: provider?.org_name ?? null,
      risk: provider?.at_risk ?? null,
      npiFound,
      entityType: provider?.entity_type ?? null,
      enumerationDate: provider?.enumeration_date ?? null,
      lastUpdated: provider?.nppes_last_updated ?? null,
      paymentAdj: provider?.payment_adj_pct ?? null,
      lastDialed: lastDialed[p.id] ?? null,
      ccm: s.ccm ?? false,
      pcm: s.pcm ?? false,
      awv: s.awv ?? false,
      tcm: s.tcm ?? false,
      bhi: s.bhi ?? false,
      rpm: s.rpm ?? false,
      rcmFit: s.rcm_fit ?? false,
      mipsByYear,
    }
  })

  // Smaller browser payload: drop empty/false/null fields (read with ?? / ?. /
  // truthiness in PracticesTable). name and practiceCode are always kept.
  const compactPractices = practices.map(row => ({
    ...compactRow(row), practiceCode: row.practiceCode, name: row.name,
  })) as unknown as typeof practices

  return (
    <AppShell
      title="Leads Management Engine"
      subtitle="Import, deduplicate, and assign practice-first leads to employees"
      currentUser={currentUser}
      active="/"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
      headerRight={canUpload ? <UploadLeadsButton /> : null}
    >
      <PracticesTable
        practices={compactPractices}
        currentUser={currentUser}
        viewerUserId={myUserId}
        isSuperAdmin={isSuperAdmin}
        lazyOptions
        canAssign={canAssign}

        myAssignedCodes={myAssignedCodes}
        newLeadCodes={Array.from(newLeadCodes)}
        workedLeadCodes={Array.from(workedLeadCodes)}
        viewerRole={roleKey}
        completedWorksheetCount={completedWorksheetCount}
      />
    </AppShell>
  )
}
