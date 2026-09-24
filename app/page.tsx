import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { roleLabel } from '../lib/roles'
import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import { redirect } from 'next/navigation'
import AppShell from './AppShell'
import { chunks, mapConcurrent } from '../lib/query-utils'

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
    id, practice_code, name, state, specialty, owner_tenant_id, created_at, ws_updated_by, lead_activity(created_at),
    ${canAssign ? 'assigned_away:lead_assignments(users!lead_assignments_assigned_to_fkey(full_name, roles(key, label))),' : ''}
    practice_providers (
      providers (
        npi, org_name, nppes_sex, nppes_last_updated, payment_adj_pct, at_risk,
        provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit ),
        provider_mips ( performance_year, status, reporting_option )
      )
    )
  `
  const PAGE = 1000
  const CHUNK_IDS = 300

  const fetchAllPaged = async (makeQuery: () => any) => {
    const out: any[] = []
    let from = 0
    while (true) {
      let query = makeQuery()
      if (canAssign) query = query.eq('assigned_away.assigned_by', myUserId).eq('assigned_away.status', 'active')
      const { data: batch, error: err } = await query.order('created_at', { referencedTable: 'lead_activity', ascending: false }).limit(1, { referencedTable: 'lead_activity' }).range(from, from + PAGE - 1)
      if (err) throw err
      if (!batch || batch.length === 0) break
      out.push(...batch)
      if (batch.length < PAGE) break
      from += PAGE
    }
    return out
  }

  const fetchByIds = async (idsIn: string[]) => {
    const ids = (idsIn ?? []).filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return []
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += CHUNK_IDS) chunks.push(ids.slice(i, i + CHUNK_IDS))
    const results = await mapConcurrent(chunks, 4, (chunk) =>
        fetchAllPaged(() =>
          supabase.from('master_practices').select(SELECT).in('id', chunk).eq('is_roster', false).order('name')
        )
    )
    return results.flat()
  }

  // Start the independent lead scan while dropdown/allocation metadata loads.
  // Capture errors immediately so an early rejection cannot go unhandled.
  const earlyLeadRead = isSuperAdmin || roleKey === 'company_admin'
    ? fetchAllPaged(() => {
        let query = supabase.from('master_practices').select(SELECT).eq('is_roster', false).order('name')
        query = isSuperAdmin ? query.is('deleted_at', null) : query.eq('owner_tenant_id', myTenantId)
        return query
      }).then(data => ({ data, error: null }), error => ({ data: [], error }))
    : null
  // These reads depend only on the verified profile, not on each other.
  // Reuse assignment/allocation results instead of fetching the same rows twice.
  const assignmentScoped = ['agent', 'closer', 'manager', 'team_lead'].includes(roleKey)
  const excludeEngagedElsewhere = ['manager', 'team_lead'].includes(roleKey)
  const empty = { data: [] }
  const assignmentsRead = Promise.resolve(assignmentScoped || canAssign ? supabase.from('lead_assignments')
    .select('practice_id, assigned_at, current_status, master_practices(practice_code)')
    .eq('assigned_to', myUserId).eq('status', 'active') : empty)
  const transfersRead = Promise.resolve(roleKey === 'closer'
    ? supabase.from('lead_transfers').select('practice_id, created_at').eq('to_user_id', myUserId) : empty)
  const scopeIdsRead = Promise.all([assignmentsRead, transfersRead]).then(results =>
    Array.from(new Set(results.flatMap(result => (result.data ?? []).map(row => row.practice_id)).filter(Boolean)))
  )
  // Start as soon as permissions resolve; dropdowns and unrelated metadata
  // must not hold up the main data request for agents/managers/closers.
  const scopedLeadRead = assignmentScoped
    ? scopeIdsRead.then(fetchByIds).then(data => ({ data, error: null }), error => ({ data: [], error }))
    : null
  // Only these assigned practices can appear on this page. Avoid scanning
  // every active assignment in every company to exclude engaged leads.
  const engagedRead = excludeEngagedElsewhere && myTenantId
    ? scopeIdsRead.then(async ids => {
        const results = await mapConcurrent(chunks(ids, CHUNK_IDS), 4, part =>
          supabase.from('lead_assignments').select('practice_id, tenant_id')
            .eq('status', 'active').neq('tenant_id', myTenantId).in('practice_id', part)
        )
        return { data: results.flatMap(result => result.data ?? []) }
      }) : Promise.resolve(empty)
  const readAllocations = async () => {
    const rows = []
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from('lead_allocations')
        .select('practice_id, tenant_id, master_practices(practice_code), tenants(name)')
        .eq('status', 'active')
      if (!isSuperAdmin && myTenantId) query = query.eq('tenant_id', myTenantId)
      const { data, error } = await query.order('practice_id').order('tenant_id').range(offset, offset + PAGE - 1)
      // Missing allocation data must not make assigned leads appear unassigned.
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) return { data: rows }
    }
  }

  const [assignmentsResult, transfersResult, allocationsResult, engagedResult] = await Promise.all([
    assignmentsRead, transfersRead, readAllocations(), engagedRead,
  ])
  const currentUser = me ? {
    full_name: me.full_name,
    role: roleLabel(me.roles?.key),
    company: me.tenants?.name ?? 'Unknown',
  } : null

  const allocatedOn: Record<string, string> = {}
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
  const engagedElsewhere = new Set<string>()
  for (const a of (engagedResult.data ?? []) as any[]) {
    if (a.tenant_id && a.tenant_id !== myTenantId) engagedElsewhere.add(a.practice_id)
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
        }) : fetchAllPaged(() =>
          supabase.from('master_practices').select(SELECT).eq('owner_tenant_id', myTenantId).eq('is_roster', false).order('name')
        ),
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
  const isCompanyAdmin = roleKey === 'company_admin'
  // Saving a worksheet completes the lead for that Agent/Closer. Keep it in
  // management views and Worksheet Reports, but remove it from the saver’s
  // active queue. A later assignee can still work the lead because the saved
  // user id is compared with the current viewer rather than treated globally.
  if (isAgentOrCloser) {
    data = data.filter(p => p.ws_updated_by !== myUserId)
  }
  if (!isSuperAdmin && !isAgentOrCloser && !isCompanyAdmin) {
    if (engagedElsewhere.size) {
      data = data.filter((p: any) => !engagedElsewhere.has(p.id))
    }
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
    const mipsRows = Array.isArray(provider?.provider_mips) ? provider.provider_mips : []
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
      allocatedOn: allocatedOn[p.id] ?? null,
      status: leadStatus[p.id] ?? null,
      assignedAwayTo: canAssign && p.assigned_away?.length
        ? (() => {
            const person = p.assigned_away.filter((a: any) => a.users).at(-1)?.users
            return person ? { name: person.full_name, role: roleLabel(person.roles?.key) } : null
          })() : null,
      source: allocatedCodeSet.has(p.practice_code) ? 'Allocated' : 'Uploaded',
      allocatedTo: allocatedCompanyByCode[p.practice_code]?.map(company => company.name).join(', ') ?? null,
      allocatedCompanies: allocatedCompanyByCode[p.practice_code] ?? [],
      name: p.name,
      state: p.state,
      specialty: p.specialty,
      sex: provider?.nppes_sex ?? null,
      orgName: provider?.org_name ?? null,
      risk: provider?.at_risk ?? null,
      paymentAdj: provider?.payment_adj_pct ?? null,
      lastDialed: lastDialed[p.id] ?? null,
      ccm: s.ccm ?? false,
      pcm: s.pcm ?? false,
      awv: s.awv ?? false,
      tcm: s.tcm ?? false,
      bhi: s.bhi ?? false,
      rpm: s.rpm ?? false,
      rcmFit: s.rcm_fit ?? false,
      mips: mipsByYear,
      mipsByYear,
    }
  })

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
        practices={practices}
        currentUser={currentUser}
        isSuperAdmin={isSuperAdmin}
        lazyOptions
        canAssign={canAssign}

        myAssignedCodes={myAssignedCodes}
        newLeadCodes={Array.from(newLeadCodes)}
        workedLeadCodes={Array.from(workedLeadCodes)}
      />
    </AppShell>
  )
}



