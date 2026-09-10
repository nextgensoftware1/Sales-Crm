import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'

export default async function ClientsPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('full_name, tenant_id, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const isSuperAdmin = (me as any)?.roles?.key === 'super_admin'
  const showTransfers = true // everyone signed in can view transfers (scoped by role inside the page)
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? '',
      }
    : null

  // Super Admin sees all clients; others see only their company's clients
  let query = supabase
    .from('client_ownership')
    .select('locked_at, active, tenants(name), master_practices(name, practice_code), sales(service_sold, contract_value, mrr, sale_date)')
    .eq('active', true)
    .order('locked_at', { ascending: false })

  if (!isSuperAdmin) {
    query = query.eq('owner_tenant_id', (me as any).tenant_id)
  }

  const { data: clients } = await query

  return (
    <AppShell
      title={isSuperAdmin ? 'Global Client Registry' : 'Active Clients'}
      subtitle={`${clients?.length ?? 0} active client${(clients?.length ?? 0) === 1 ? '' : 's'}`}
      currentUser={currentUser}
      active="/clients"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
    >
      <div className="card">
        {(!clients || clients.length === 0) ? (
          <p className="subtle">No clients yet.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Practice</th>
                  {isSuperAdmin && <th>Owner Company</th>}
                  <th>Service</th>
                  <th>Contract Value</th>
                  <th>MRR</th>
                  <th>Sale Date</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c: any, i) => (
                  <tr key={i}>
                    <td>
                      <a href={`/practice/${c.master_practices?.practice_code}`}>
                        {c.master_practices?.name ?? '—'}
                      </a>
                    </td>
                    {isSuperAdmin && <td>{c.tenants?.name ?? '—'}</td>}
                    <td>{c.sales?.service_sold ?? '—'}</td>
                    <td>{c.sales?.contract_value != null ? '$' + c.sales.contract_value : '—'}</td>
                    <td>{c.sales?.mrr != null ? '$' + c.sales.mrr : '—'}</td>
                    <td>{c.sales?.sale_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
