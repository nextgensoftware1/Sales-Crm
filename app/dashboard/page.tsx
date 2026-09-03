import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardView from './DashboardView'

export default async function DashboardPage() {
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

  // Helper: apply the right scope to a query on a table that has tenant_id + agent_id
  const scope = (q: any, agentCol = 'agent_id') => {
    if (isSuperAdmin) return q
    if (isAgentOrCloser) return q.eq(agentCol, myUserId)
    return q.eq('tenant_id', myTenantId)
  }

  // --- Activities (dispositions) ---  [REAL]
  let actQ = supabase.from('lead_activity').select('disposition', { count: 'exact' })
  actQ = scope(actQ)
  const { data: activities, count: activityCount } = await actQ

  // Disposition breakdown  [REAL]
  const dispoCounts: Record<string, number> = {}
  for (const a of (activities ?? []) as any[]) {
    const d = a.disposition ?? 'none'
    dispoCounts[d] = (dispoCounts[d] ?? 0) + 1
  }

  // --- Transfers ---  [REAL]
  let transQ = supabase.from('lead_transfers').select('id', { count: 'exact', head: true })
  if (isSuperAdmin) { /* all */ }
  else if (isAgentOrCloser) transQ = transQ.eq('from_user_id', myUserId)
  else transQ = transQ.eq('tenant_id', myTenantId)
  const { count: transferCount } = await transQ

  // --- Sales ---  [REAL]
  let salesQ = supabase.from('sales').select('contract_value, mrr')
  if (isSuperAdmin) { /* all */ }
  else if (isAgentOrCloser) salesQ = salesQ.eq('sold_by', myUserId)
  else salesQ = salesQ.eq('tenant_id', myTenantId)
  const { data: sales } = await salesQ

  const saleCount = sales?.length ?? 0
  const totalValue = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.contract_value) || 0), 0)
  const totalMrr = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.mrr) || 0), 0)

  // --- Active clients ---  [REAL]
  let clientQ = supabase.from('client_ownership').select('id', { count: 'exact', head: true }).eq('active', true)
  if (!isSuperAdmin) clientQ = clientQ.eq('owner_tenant_id', myTenantId)
  const { count: clientCount } = await clientQ

  const scopeLabel = isSuperAdmin
    ? 'Platform-wide · all companies'
    : isAgentOrCloser
    ? `${(me as any)?.full_name} · personal`
    : `${(me as any)?.tenants?.name} · company`

  const companyName = isSuperAdmin
    ? 'Platform'
    : ((me as any)?.tenants?.name ?? 'Company')

  const roleLabel = (me as any)?.roles?.label ?? roleKey

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
      dispoCounts={dispoCounts}
      canManageAssignments={canManageAssignments}
      isSuperAdmin={isSuperAdmin}
    />
  )
}