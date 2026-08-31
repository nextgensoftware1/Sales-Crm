import { createSupabaseServer } from '../lib/supabase-server'
import PracticesTable from './PracticesTable'
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
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  const currentUser = me
    ? {
        full_name: me.full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? 'Unknown',
      }
    : null

  // Decide which practice IDs this person may see, based on role.
  // null = no restriction (Super Admin sees all).
  let allowedIds: string[] | null = null
  const allocatedOn: Record<string, string> = {} 
  const leadStatus: Record<string, string> = {}
  // practice_id => allocated_at

  if (roleKey === 'super_admin') {
    allowedIds = null // sees everything
  } else if (roleKey === 'company_admin' || roleKey === 'manager' || roleKey === 'team_lead') {
    // Company-level roles: see the whole company's ALLOCATED pool.
    // (Manager/TL narrowing comes when we add their own assignment views.)
    const { data: allocs } = await supabase
      .from('lead_allocations')
      .select('practice_id, allocated_at')
      .eq('tenant_id', myTenantId)
      .eq('status', 'active')
    allowedIds = (allocs ?? []).map((a: any) => a.practice_id)
    for (const a of (allocs ?? []) as any[]) {
      allocatedOn[a.practice_id] = a.allocated_at
    }
  } else {
    // Agent / Closer: see only practices ASSIGNED to them personally.
    const { data: assigns } = await supabase
      .from('lead_assignments')
      .select('practice_id, assigned_at, current_status')
      .eq('assigned_to', myUserId)
      .eq('status', 'active')
    allowedIds = (assigns ?? []).map((a: any) => a.practice_id)
    for (const a of (assigns ?? []) as any[]) {
      allocatedOn[a.practice_id] = a.assigned_at
      leadStatus[a.practice_id] = a.current_status ?? ''
    }
  }

  let query = supabase
    .from('master_practices')
    .select(`
      id, practice_code, name, state, specialty,
      practice_providers (
        providers (
          provider_signals ( ccm, pcm, awv, tcm, bhi, rpm, rcm_fit ),
          provider_mips ( performance_year, status )
        )
      )
    `)
    .order('name')

  if (allowedIds !== null) {
    query = query.in('id', allowedIds.length ? allowedIds : ['00000000-0000-0000-0000-000000000000'])
  }

  const { data, error } = await query

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
    const mipsByYear: Record<number, string> = {}
    for (const m of mipsRows) mipsByYear[m.performance_year] = m.status

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
    <AppShell title="Leads Management Engine" 
    subtitle="Import, deduplicate, and assign practice-first leads to employees"
    currentUser={currentUser} active="/" showAdmin={isSuperAdmin}>
      <PracticesTable practices={practices} currentUser={currentUser} isSuperAdmin={isSuperAdmin} companies={companies} />
    </AppShell>
  )


}