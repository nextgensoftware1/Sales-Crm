import { createSupabaseServer } from '../../lib/supabase-server'
import { roleLabel as canonicalRoleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
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
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  const canManageAssignments = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id

  const sp = await searchParams
  const defaults = currentMonthRange()
  const fromDate = sp.from || defaults.from
  const toDate = sp.to || defaults.to
  const fromISO = `${fromDate}T00:00:00.000Z`
  const toISO = `${toDate}T23:59:59.999Z`

  // Helper: apply the right scope to a query on a table that has tenant_id + agent_id
  const scope = (q: any, agentCol = 'agent_id') => {
    if (isSuperAdmin) return q
    if (isAgentOrCloser) return q.eq(agentCol, myUserId)
    return q.eq('tenant_id', myTenantId)
  }

  // --- Build all four queries, then run them IN PARALLEL (one latency hit) ---
  // lead_activity and lead_transfers are confirmed to have created_at (both
  // are selected directly elsewhere in this app), so the date range picker
  // can safely filter them here. sales and client_ownership are NOT
  // filtered by date yet — their schema wasn't confirmed to have a
  // comparable date column. DashboardView flags which metrics are
  // date-scoped vs. all-time so nothing is silently inconsistent.
  let actQ = supabase.from('lead_activity').select('disposition', { count: 'exact' })
    .gte('created_at', fromISO).lte('created_at', toISO)
  actQ = scope(actQ)

  let transQ = supabase.from('lead_transfers').select('id', { count: 'exact', head: true })
    .gte('created_at', fromISO).lte('created_at', toISO)
  if (isSuperAdmin) { /* all */ }
  else if (isAgentOrCloser) transQ = transQ.eq('from_user_id', myUserId)
  else transQ = transQ.eq('tenant_id', myTenantId)

  let salesQ = supabase.from('sales').select('contract_value, mrr')
  if (isSuperAdmin) { /* all */ }
  else if (isAgentOrCloser) salesQ = salesQ.eq('sold_by', myUserId)
  else salesQ = salesQ.eq('tenant_id', myTenantId)

  let clientQ = supabase.from('client_ownership').select('id', { count: 'exact', head: true }).eq('active', true)
  if (!isSuperAdmin) clientQ = clientQ.eq('owner_tenant_id', myTenantId)

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

  const scopeLabel = isSuperAdmin
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
    />
  )
}
