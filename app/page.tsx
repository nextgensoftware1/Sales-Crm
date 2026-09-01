import { createSupabaseServer } from '../lib/supabase-server'
import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import { redirect } from 'next/navigation'
import AppShell from './AppShell'

export default async function Home() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Who is this?
  const { data: me } = await supabase
    .from('users')
    .select('id, full_name, tenant_id, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canUpload = roleKey === 'company_admin' || roleKey === 'manager'
  const canAssign = roleKey === 'company_admin' || roleKey === 'manager' || roleKey === 'team_lead'
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  // Direct reports the caller may assign to (one level down in user_hierarchy).
  // Cascade model: each role assigns to whoever is directly below them, whatever
  // their role (Admin→Manager, Manager→Team Lead, Team Lead→Agent).
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

  // For the allocation UI: list of real companies (not Platform)
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
  // Company-owned leads visibility.
  //   • Company roles: see leads their company OWNS (owner_tenant_id = theirs).
  //   • Super Admin: sees leads owned by tenants that granted permission.
  // ------------------------------------------------------------------
  let ownerIdsForSuperAdmin: string[] | null = null
  if (isSuperAdmin) {
    const { data: visibleTenants } = await supabase
      .from('tenants')
      .select('id, super_admin_visible')
      .eq('super_admin_visible', true)
    ownerIdsForSuperAdmin = (visibleTenants ?? []).map((t: any) => t.id)
  }

  const allocatedOn: Record<string, string> = {}
  const leadStatus: Record<string, string> = {}
  let assignedIds: string[] | null = null
  if (roleKey === 'agent' || roleKey === 'closer') {
    const { data: assigns } = await supabase
      .from('lead_assignments')
      .select('practice_id, assigned_at, current_status')
      .eq('assigned_to', myUserId)
      .eq('status', 'active')
    assignedIds = (assigns ?? []).map((a: any) => a.practice_id)
    for (const a of (assigns ?? []) as any[]) {
      allocatedOn[a.practice_id] = a.assigned_at
      leadStatus[a.practice_id] = a.current_status ?? ''
    }
  }

  // Build the scoped query FRESH each time (a Supabase builder can't be reused
  // across multiple .range() calls — each call mutates it).
  const buildQuery = () => {
    let q = supabase
      .from('master_practices')
      .select(`
        id, practice_code, name, state, specialty, owner_tenant_id,
        practice_providers (
          providers (
            provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit ),
            provider_mips ( performance_year, status, reporting_option )
          )
        )
      `)
      .order('name')

    if (isSuperAdmin) {
      if (!ownerIdsForSuperAdmin || ownerIdsForSuperAdmin.length === 0) {
        q = q.in('owner_tenant_id', ['00000000-0000-0000-0000-000000000000'])
      } else {
        q = q.in('owner_tenant_id', ownerIdsForSuperAdmin)
      }
    } else if (roleKey === 'agent' || roleKey === 'closer') {
      q = q
        .eq('owner_tenant_id', myTenantId)
        .in('id', assignedIds && assignedIds.length ? assignedIds : ['00000000-0000-0000-0000-000000000000'])
    } else {
      q = q.eq('owner_tenant_id', myTenantId)
    }
    return q
  }

  // Fetch ALL rows in pages of 1000 (Supabase caps a single request at 1000).
  const PAGE = 1000
  let data: any[] = []
  let error: any = null
  let from = 0
  while (true) {
    const { data: batch, error: batchErr } = await buildQuery().range(from, from + PAGE - 1)
    if (batchErr) { error = batchErr; break }
    if (!batch || batch.length === 0) break
    data = data.concat(batch)
    if (batch.length < PAGE) break
    from += PAGE
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ color: 'red' }}>Error loading practices</h1>
        <pre>{error.message}</pre>
      </div>
    )
  }

  const practices = (data ?? []).map((p: any) => {
    const provider = p.practice_providers?.[0]?.providers
    const s = provider?.provider_signals ?? {}
    const mipsRows = Array.isArray(provider?.provider_mips) ? provider.provider_mips : []

    // MIPS text lives in reporting_option like "2026 - Individual + Group".
    // performance_year is NULL, so parse the year off the front of the text.
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
      />
    </AppShell>
  )
}