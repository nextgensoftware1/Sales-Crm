import Link from 'next/link'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import SoldLeadsSection, { loadSoldLeadCount } from './SoldLeadsSection'

// Clients page with two tabs: Active clients (default) and Sold leads
// (?tab=sold). Only the selected tab's rows are loaded.
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab: 'active' | 'sold' = (await searchParams)?.tab === 'sold' ? 'sold' : 'active'
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const isSuperAdmin = (me as any)?.roles?.key === 'super_admin'
  const showTransfers = true // everyone signed in can view transfers (scoped by role inside the page)
  const canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes((me as any)?.roles?.key ?? '')
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  const roleKey: string = (me as any)?.roles?.key ?? ''
  const soldScope = { userId: (me as any)?.id ?? '', tenantId: (me as any)?.tenant_id ?? null, tenantName: (me as any)?.tenants?.name ?? null, roleKey }

  // Super Admin sees all clients; others see only their company's clients
  let query = supabase
    .from('client_ownership')
    .select('locked_at, active, tenants(name), master_practices(name, practice_code), sales(service_sold, contract_value, mrr, sale_date)')
    .eq('active', true)
    .order('locked_at', { ascending: false })

  if (!isSuperAdmin) {
    query = query.eq('owner_tenant_id', (me as any).tenant_id)
  }

  // Rows for the open tab only; the other tab just needs its count.
  let clientsCountQuery = supabase.from('client_ownership').select('locked_at', { count: 'exact', head: true }).eq('active', true)
  if (!isSuperAdmin) clientsCountQuery = clientsCountQuery.eq('owner_tenant_id', (me as any).tenant_id)
  const [{ data: clients }, { count: clientCount }, soldCount] = await Promise.all([
    tab === 'active' ? query : Promise.resolve({ data: null as any[] | null }),
    clientsCountQuery,
    loadSoldLeadCount(soldScope),
  ])
  const activeCount = clientCount ?? clients?.length ?? 0

  return (
    <AppShell
      title={isSuperAdmin ? 'Global Client Registry' : 'Active Clients'}
      subtitle={`${activeCount} active client${activeCount === 1 ? '' : 's'} · ${soldCount} sold lead${soldCount === 1 ? '' : 's'}`}
      currentUser={currentUser}
      active="/clients"
      contextActive={tab === 'sold' ? '/clients?tab=sold' : '/clients'}
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
    >
      <nav className="page-tabs" aria-label="Clients views">
        <Link prefetch={false} href="/clients" className={'page-tab' + (tab === 'active' ? ' is-active' : '')} aria-current={tab === 'active' ? 'page' : undefined}>
          Active clients <span className="page-tab-count">{activeCount}</span>
        </Link>
        <Link prefetch={false} href="/clients?tab=sold" className={'page-tab' + (tab === 'sold' ? ' is-active' : '')} aria-current={tab === 'sold' ? 'page' : undefined}>
          Sold leads <span className="page-tab-count">{soldCount}</span>
        </Link>
      </nav>
      {tab === 'sold' ? <SoldLeadsSection scope={soldScope} /> : (
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
                      {c.master_practices ? (
                        <Link prefetch={false} href={`/practice/${c.master_practices.practice_code}`}>
                          {c.master_practices.name}
                        </Link>
                      ) : (
                        <span className="subtle" title="This practice was permanently deleted">— (deleted)</span>
                      )}
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
      )}
    </AppShell>
  )
}
