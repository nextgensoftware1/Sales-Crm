// import { createSupabaseServer } from '../../lib/supabase-server'
// import { redirect } from 'next/navigation'

// export default async function DashboardPage() {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) redirect('/login')

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id, full_name, roles(key, label), tenants(name)')
//     .eq('auth_id', user.id)
//     .single()

//   const roleKey = (me as any)?.roles?.key ?? ''
//   const isSuperAdmin = roleKey === 'super_admin'
//   const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
//   const myTenantId = (me as any)?.tenant_id
//   const myUserId = (me as any)?.id

//   // Helper: apply the right scope to a query on a table that has tenant_id + agent_id
//   const scope = (q: any, agentCol = 'agent_id') => {
//     if (isSuperAdmin) return q
//     if (isAgentOrCloser) return q.eq(agentCol, myUserId)
//     return q.eq('tenant_id', myTenantId)
//   }

//   // --- Activities (dispositions) ---
//   let actQ = supabase.from('lead_activity').select('disposition', { count: 'exact' })
//   actQ = scope(actQ)
//   const { data: activities, count: activityCount } = await actQ

//   // Disposition breakdown
//   const dispoCounts: Record<string, number> = {}
//   for (const a of (activities ?? []) as any[]) {
//     const d = a.disposition ?? 'none'
//     dispoCounts[d] = (dispoCounts[d] ?? 0) + 1
//   }

//   // --- Transfers ---
//   let transQ = supabase.from('lead_transfers').select('id', { count: 'exact', head: true })
//   if (isSuperAdmin) { /* all */ }
//   else if (isAgentOrCloser) transQ = transQ.eq('from_user_id', myUserId)
//   else transQ = transQ.eq('tenant_id', myTenantId)
//   const { count: transferCount } = await transQ

//   // --- Sales ---
//   let salesQ = supabase.from('sales').select('contract_value, mrr')
//   if (isSuperAdmin) { /* all */ }
//   else if (isAgentOrCloser) salesQ = salesQ.eq('sold_by', myUserId)
//   else salesQ = salesQ.eq('tenant_id', myTenantId)
//   const { data: sales } = await salesQ

//   const saleCount = sales?.length ?? 0
//   const totalValue = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.contract_value) || 0), 0)
//   const totalMrr = (sales ?? []).reduce((s: number, r: any) => s + (Number(r.mrr) || 0), 0)

//   // --- Active clients ---
//   let clientQ = supabase.from('client_ownership').select('id', { count: 'exact', head: true }).eq('active', true)
//   if (!isSuperAdmin && !isAgentOrCloser) clientQ = clientQ.eq('owner_tenant_id', myTenantId)
//   else if (isAgentOrCloser) clientQ = clientQ.eq('owner_tenant_id', myTenantId)
//   const { count: clientCount } = await clientQ

//   const scopeLabel = isSuperAdmin
//     ? 'Platform-wide (all companies)'
//     : isAgentOrCloser
//     ? `${(me as any)?.full_name} (personal)`
//     : `${(me as any)?.tenants?.name} (company)`

//   const card = {
//     border: '1px solid #ddd', borderRadius: 10, padding: 24, minWidth: 180,
//     background: '#fafafa',
//   }
//   const num = { fontSize: 34, fontWeight: 700, color: '#111', margin: '4px 0' }
//   const lbl = { fontSize: 13, color: '#666' }

//   return (
//     <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
//       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
//         <h1 style={{ fontSize: 28 }}>Dashboard</h1>
//         <a href="/" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>← Back to practices</a>
//       </div>
//       <p style={{ color: '#666', marginBottom: 28 }}>Scope: {scopeLabel}</p>

//       {/* KPI cards */}
//       <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 36 }}>
//         <div style={card}>
//           <div style={lbl}>Activities logged</div>
//           <div style={num}>{activityCount ?? 0}</div>
//         </div>
//         <div style={card}>
//           <div style={lbl}>Transfers</div>
//           <div style={num}>{transferCount ?? 0}</div>
//         </div>
//         <div style={card}>
//           <div style={lbl}>Sales</div>
//           <div style={num}>{saleCount}</div>
//         </div>
//         <div style={card}>
//           <div style={lbl}>Total contract value</div>
//           <div style={num}>${totalValue.toLocaleString()}</div>
//         </div>
//         <div style={card}>
//           <div style={lbl}>Total MRR</div>
//           <div style={num}>${totalMrr.toLocaleString()}</div>
//         </div>
//         <div style={card}>
//           <div style={lbl}>Active clients</div>
//           <div style={num}>{clientCount ?? 0}</div>
//         </div>
//       </div>

//       {/* Disposition breakdown */}
//       <h2 style={{ fontSize: 18, marginBottom: 12 }}>Disposition breakdown</h2>
//       {Object.keys(dispoCounts).length === 0 ? (
//         <p style={{ color: '#888' }}>No activity yet.</p>
//       ) : (
//         <table style={{ borderCollapse: 'collapse', maxWidth: 400 }}>
//           <tbody>
//             {Object.entries(dispoCounts)
//               .sort((a, b) => b[1] - a[1])
//               .map(([d, n]) => (
//                 <tr key={d}>
//                   <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 14 }}>{d}</td>
//                   <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{n}</td>
//                 </tr>
//               ))}
//           </tbody>
//         </table>
//       )}
//     </div>
//   )
// }
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
    />
  )
}