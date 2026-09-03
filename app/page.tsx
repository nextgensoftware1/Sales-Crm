import { createSupabaseServer } from '../lib/supabase-server'
import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import { redirect } from 'next/navigation'
import AppShell from './AppShell'

export default async function Home() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('id, full_name, tenant_id, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  // Super Admin can now upload too (leads owned by Platform).
  const canUpload = ['company_admin', 'manager', 'super_admin'].includes(roleKey)
  const canAssign = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  // Direct reports the caller may assign to (cascade model).
  let myAgents: { id: string; full_name: string; role: string }[] = []
  if (canAssign) {
    const { data: edges } = await supabase
      .from('user_hierarchy')
      .select('user_id')
      .eq('manages_user_id', myUserId)
    const reportIds = (edges ?? []).map((e: any) => e.user_id)
    if (reportIds.length) {
      const { data: agentRows } = await supabase
        .from('users')
        .select('id, full_name, roles(key, label)')
        .in('id', reportIds)
        .order('full_name')
      myAgents = (agentRows ?? [])
        .map((u: any) => ({ id: u.id, full_name: u.full_name, role: u.roles?.label ?? u.roles?.key }))
    }
  }

  // Companies for the allocation UI (non-platform).
  let companies: { slug: string; name: string }[] = []
  if (isSuperAdmin) {
    const { data: tenantRows } = await supabase
      .from('tenants')
      .select('slug, name, is_platform')
      .eq('is_platform', false)
      .order('name')
    companies = (tenantRows ?? []).map((t: any) => ({ slug: t.slug, name: t.name }))
  }

  const currentUser = me
    ? {
        full_name: me.full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? 'Unknown',
      }
    : null

  // ------------------------------------------------------------------
  // Per-agent assignment context (unchanged).
  // ------------------------------------------------------------------
  const allocatedOn: Record<string, string> = {}
  const leadStatus: Record<string, string> = {}
  let assignedIds: string[] | null = null
  if (roleKey === 'agent' || roleKey === 'closer') {
    const idSet = new Set<string>()

    // Leads directly assigned to me.
    const { data: assigns } = await supabase
      .from('lead_assignments')
      .select('practice_id, assigned_at, current_status')
      .eq('assigned_to', myUserId)
      .eq('status', 'active')
    for (const a of (assigns ?? []) as any[]) {
      if (a.practice_id) {
        idSet.add(a.practice_id)
        allocatedOn[a.practice_id] = a.assigned_at
        leadStatus[a.practice_id] = a.current_status ?? ''
      }
    }

    // Closers also receive leads via TRANSFER (agent → closer).
    if (roleKey === 'closer') {
      const { data: transfers } = await supabase
        .from('lead_transfers')
        .select('practice_id, created_at')
        .eq('to_user_id', myUserId)
      for (const t of (transfers ?? []) as any[]) {
        if (t.practice_id) {
          idSet.add(t.practice_id)
          if (!allocatedOn[t.practice_id]) allocatedOn[t.practice_id] = t.created_at
          if (!leadStatus[t.practice_id]) leadStatus[t.practice_id] = 'Transferred'
        }
      }
    }

    assignedIds = Array.from(idSet)
  }

  // Priority (assigned to me) + handed-away (assigned by me) for upper roles.
  let myAssignedCodes: string[] = []
  let assignedAwayIds: string[] = []
  if (canAssign) {
    const { data: mine } = await supabase
      .from('lead_assignments')
      .select('practice_id, master_practices(practice_code)')
      .eq('assigned_to', myUserId)
      .eq('status', 'active')
    myAssignedCodes = (mine ?? [])
      .map((r: any) => r.master_practices?.practice_code)
      .filter(Boolean)

    const { data: away } = await supabase
      .from('lead_assignments')
      .select('practice_id')
      .eq('assigned_by', myUserId)
      .eq('status', 'active')
    assignedAwayIds = (away ?? []).map((r: any) => r.practice_id)
  }

  // ------------------------------------------------------------------
  // VISIBILITY — which practice IDs may this person see?
  //   • Super Admin: everything (no filter).
  //   • Agent/Closer: only assigned to them.
  //   • Company roles: leads they OWN (upload) OR that are ALLOCATED to them,
  //     minus leads engaged to another company.
  // We compute an allow-list of practice IDs (null = no restriction).
  // ------------------------------------------------------------------
  // Leads allocated to my company (Super Admin gave them to us).
  let myAllocatedIds: string[] = []
  if (!isSuperAdmin && myTenantId) {
    const { data: allocs } = await supabase
      .from('lead_allocations')
      .select('practice_id')
      .eq('tenant_id', myTenantId)
      .eq('status', 'active')
    myAllocatedIds = (allocs ?? [])
      .map((a: any) => a.practice_id)
      .filter((id: any) => typeof id === 'string' && id.length > 0)
  }

  // Set of practice IDs that are ALLOCATED (from Super Admin). For a company,
  // that's their own allocations; for Super Admin, all active allocations.
  const allocatedIdSet = new Set<string>()
  const allocatedCompanyById: Record<string, string> = {} // practice_id -> company name (Super Admin only)
  {
    let aq = supabase
      .from('lead_allocations')
      .select('practice_id, tenants(name)')
      .eq('status', 'active')
    if (!isSuperAdmin && myTenantId) aq = aq.eq('tenant_id', myTenantId)
    const { data: allocAll } = await aq
    for (const a of (allocAll ?? []) as any[]) {
      if (a.practice_id) {
        allocatedIdSet.add(a.practice_id)
        if (isSuperAdmin && a.tenants?.name) allocatedCompanyById[a.practice_id] = a.tenants.name
      }
    }
  }

  // "Engaged" lock: practices assigned to an agent/closer under ANOTHER company.
  let engagedElsewhere = new Set<string>()
  if (!isSuperAdmin && myTenantId) {
    const { data: engaged } = await supabase
      .from('lead_assignments')
      .select('practice_id, tenant_id')
      .eq('status', 'active')
    for (const a of (engaged ?? []) as any[]) {
      if (a.tenant_id && a.tenant_id !== myTenantId) engagedElsewhere.add(a.practice_id)
    }
  }

  const SELECT = `
    id, practice_code, name, state, specialty, owner_tenant_id,
    practice_providers (
      providers (
        provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit ),
        provider_mips ( performance_year, status, reporting_option )
      )
    )
  `
  const PAGE = 1000
  const CHUNK_IDS = 300  // keep .in() lists small to avoid Bad Request (URL length)

  // Fetch all rows for a query builder factory, paging through 1000s.
  const fetchAllPaged = async (makeQuery: () => any) => {
    const out: any[] = []
    let from = 0
    while (true) {
      const { data: batch, error: err } = await makeQuery().range(from, from + PAGE - 1)
      if (err) throw err
      if (!batch || batch.length === 0) break
      out.push(...batch)
      if (batch.length < PAGE) break
      from += PAGE
    }
    return out
  }

  // Fetch rows whose id is in a (possibly large) list, chunked.
  const fetchByIds = async (idsIn: string[]) => {
    const ids = (idsIn ?? []).filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return []
    const out: any[] = []
    for (let i = 0; i < ids.length; i += CHUNK_IDS) {
      const chunk = ids.slice(i, i + CHUNK_IDS)
      const rows = await fetchAllPaged(() =>
        supabase.from('master_practices').select(SELECT).in('id', chunk).order('name')
      )
      out.push(...rows)
    }
    return out
  }

  let data: any[] = []
  let error: any = null
  try {
    if (isSuperAdmin) {
      // All practices.
      data = await fetchAllPaged(() =>
        supabase.from('master_practices').select(SELECT).order('name')
      )
    } else if (roleKey === 'agent' || roleKey === 'closer') {
      data = await fetchByIds(assignedIds ?? [])
    } else {
      // company roles: OWNED (single equality, scalable) + ALLOCATED (chunked ids)
      const owned = await fetchAllPaged(() =>
        supabase.from('master_practices').select(SELECT).eq('owner_tenant_id', myTenantId).order('name')
      )
      const allocated = await fetchByIds(myAllocatedIds)
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

  // Post-filters (JS side). These apply ONLY to company-level roles browsing
  // the pool — never to an agent/closer, who see exactly their assigned leads.
  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  if (!isSuperAdmin && !isAgentOrCloser) {
    if (assignedAwayIds.length) {
      const awaySet = new Set(assignedAwayIds)
      data = data.filter((p: any) => !awaySet.has(p.id))
    }
    if (engagedElsewhere.size) {
      data = data.filter((p: any) => !engagedElsewhere.has(p.id))
    }
  }

  // Dedup by practice_code — keep the first occurrence.
  const seen = new Set<string>()
  data = data.filter((p: any) => {
    if (seen.has(p.practice_code)) return false
    seen.add(p.practice_code)
    return true
  })

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
      source: allocatedIdSet.has(p.id) ? 'Allocated' : 'Uploaded',
      allocatedTo: allocatedCompanyById[p.id] ?? null,
      name: p.name,
      state: p.state,
      specialty: p.specialty,
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
      headerRight={canUpload ? <UploadLeadsButton /> : null}
    >
      <PracticesTable
        practices={practices}
        currentUser={currentUser}
        isSuperAdmin={isSuperAdmin}
        companies={companies}
        canAssign={canAssign}
        myAgents={myAgents}
        myAssignedCodes={myAssignedCodes}
      />
    </AppShell>
  )
}