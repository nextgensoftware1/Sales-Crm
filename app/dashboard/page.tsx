import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel as canonicalRoleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import { readAllPages } from '../../lib/query-utils'
import { rangeBounds } from '../../lib/date-range'
import DashboardView from './DashboardView'

// First/last day of the current month, as YYYY-MM-DD — the picker's
// default range when no ?from=&to= is in the URL yet.
function currentMonthRange(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; company?: string; agent?: string }>
}) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  const canManageAssignments = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  const sp = await searchParams
  // from/to are plain dates (older links, the default month) or exact moments
  // chosen with the date + time picker. Anything invalid falls back to this month.
  const defaults = currentMonthRange()
  const requested = rangeBounds(sp.from, sp.to)
  const fromDate = requested ? (sp.from as string) : defaults.from
  const toDate = requested ? (sp.to as string) : defaults.to
  const { fromISO, toISO } = requested ?? rangeBounds(defaults.from, defaults.to)!

  // ---- Dashboard-wide Company / Agent filters (apply to every number) ----
  // Company: Super Admin only. Agent: Super Admin (within the chosen company)
  // and company admins / managers / team leads (own company only). Agents and
  // closers always see just their own work.
  const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
  const { data: companyRows } = isSuperAdmin
    ? await supabase.from('tenants').select('id, name').eq('is_platform', false).order('name')
    : { data: null }
  const companies = ((companyRows ?? []) as { id: string; name: string }[])
  const companyFilter = isSuperAdmin && isUuid(sp.company) && companies.some((c) => c.id === sp.company) ? sp.company : ''
  const peopleTenant = isSuperAdmin ? companyFilter || null : isAgentOrCloser ? null : myTenantId
  const { data: peopleRows } = peopleTenant
    ? await supabase.from('users').select('id, full_name').eq('tenant_id', peopleTenant).order('full_name')
    : { data: null }
  const people = ((peopleRows ?? []) as { id: string; full_name: string | null }[]).map((u) => ({ id: u.id, name: u.full_name ?? 'Unknown' }))
  const agentFilter = isUuid(sp.agent) && people.some((p) => p.id === sp.agent) ? sp.agent : ''

  // Helper: apply the right scope + filters to a query on a table with a
  // tenant column and a person column (agent_id, from_user_id, sold_by, ...).
  const scope = (q: any, agentCol = 'agent_id', tenantCol = 'tenant_id') => {
    if (isAgentOrCloser) return q.eq(agentCol, myUserId)
    if (!isSuperAdmin) q = q.eq(tenantCol, myTenantId)
    if (companyFilter) q = q.eq(tenantCol, companyFilter)
    if (agentFilter) q = q.eq(agentCol, agentFilter)
    return q
  }

  // --- Build all four queries, then run them IN PARALLEL (one latency hit) ---
  // lead_activity and lead_transfers are confirmed to have created_at (both
  // are selected directly elsewhere in this app), so the date range picker
  // can safely filter them here. sales and client_ownership are NOT
  // filtered by date yet — their schema wasn't confirmed to have a
  // comparable date column. DashboardView flags which metrics are
  // date-scoped vs. all-time so nothing is silently inconsistent.
  // Every page of activities in the range (a single request is capped at
  // 1,000 rows, which used to undercount the disposition breakdown).
  const actQ = readAllPages<{ disposition: string | null }>((from, to, withCount) => {
    let q = supabase.from('lead_activity').select('disposition', withCount ? { count: 'exact' } : undefined)
      .gte('created_at', fromISO).lte('created_at', toISO)
    q = scope(q)
    return q.order('created_at').order('practice_id').order('agent_id').range(from, to)
  }).then((data) => ({ data, count: data.length }))

  const transQ = scope(supabase.from('lead_transfers').select('id', { count: 'exact', head: true })
    .gte('created_at', fromISO).lte('created_at', toISO), 'from_user_id')

  const salesQ = scope(supabase.from('sales').select('contract_value, mrr'), 'sold_by')

  // Active clients: company via owner_tenant_id; agent = who sold it.
  let clientQ = supabase.from('client_ownership')
    .select(agentFilter ? 'id, sales!inner(sold_by)' : 'id', { count: 'exact', head: true }).eq('active', true)
  if (!isSuperAdmin) clientQ = clientQ.eq('owner_tenant_id', myTenantId)
  if (companyFilter) clientQ = clientQ.eq('owner_tenant_id', companyFilter)
  if (agentFilter) clientQ = clientQ.eq('sales.sold_by', agentFilter)

  const [actRes, transRes, salesRes, clientRes] = await Promise.all([actQ, transQ, salesQ, clientQ])

  const activities = actRes.data
  const activityCount = actRes.count
  const transferCount = transRes.count
  const sales = salesRes.data
  const clientCount = clientRes.count

  // Disposition breakdown  [REAL]
  const dispoCounts: Record<string, number> = {}
  for (const a of (activities ?? []) as any[]) {
    const d = a.disposition ?? 'none'
    dispoCounts[d] = (dispoCounts[d] ?? 0) + 1
  }

  const saleCount = sales?.length ?? 0
  const totalValue = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.contract_value) || 0), 0)
  const totalMrr = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.mrr) || 0), 0)

  // Proposals Shared / Contracts Signed are real counts of logged dispositions
  // (agents can log "Proposal" / "Contract" as a Call Disposition on the Worksheet).
  const proposalsCount = dispoCounts['Proposal'] ?? 0
  const contractsCount = dispoCounts['Contract'] ?? 0

  const companyLabel = companies.find((c) => c.id === companyFilter)?.name
  const agentLabel = people.find((p) => p.id === agentFilter)?.name
  const scopeLabel = (isSuperAdmin || agentFilter) && (companyLabel || agentLabel)
    ? [isSuperAdmin ? 'Platform-wide' : (me as any)?.tenants?.name, companyLabel, agentLabel].filter(Boolean).join(' · ')
    : isSuperAdmin
    ? 'Platform-wide · all companies'
    : isAgentOrCloser
    ? `${(me as any)?.full_name} · personal`
    : `${(me as any)?.tenants?.name} · company`

  const companyName = isSuperAdmin
    ? 'Platform'
    : ((me as any)?.tenants?.name ?? 'Company')

  const roleLabel = canonicalRoleLabel(roleKey)

  // Everything real is passed down; placeholder metrics are flagged in the view.
  return (
    <DashboardView
      scopeLabel={scopeLabel}
      companyName={companyName}
      userName={(me as any)?.full_name ?? 'User'}
      roleLabel={roleLabel}
      activityCount={activityCount ?? 0}
      transferCount={transferCount ?? 0}
      saleCount={saleCount}
      totalValue={totalValue}
      totalMrr={totalMrr}
      clientCount={clientCount ?? 0}
      proposalsCount={proposalsCount}
      contractsCount={contractsCount}
      dispoCounts={dispoCounts}
      canManageAssignments={canManageAssignments}
      isSuperAdmin={isSuperAdmin}
      fromDate={fromDate}
      toDate={toDate}
      filters={{ company: companyFilter, agent: agentFilter, companies, people, canPickAgent: !isAgentOrCloser }}
    />
  )
}
