import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer, getCurrentProfile, getCurrentUser } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import AppShell from '../AppShell'

type SaleRow = {
  id: string
  practice_id: string
  tenant_id: string | null
  sold_by: string | null
  service_sold: string | null
  contract_value: number | string | null
  mrr: number | string | null
  note: string | null
  sale_date: string | null
}

type PracticeRow = { id: string; practice_code: string; name: string }
type UserRow = { id: string; full_name: string }
type TenantRow = { id: string; name: string }

function money(value: number | string | null): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount)
}

function displayDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function SoldLeadsPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) redirect('/login')

  const roleKey = me.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const isPersonal = roleKey === 'agent' || roleKey === 'closer'
  const canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)

  let salesQuery = supabase
    .from('sales')
    .select('id, practice_id, tenant_id, sold_by, service_sold, contract_value, mrr, note, sale_date')
    .order('sale_date', { ascending: false })
    .limit(500)

  if (isPersonal) salesQuery = salesQuery.eq('sold_by', me.id)
  else if (!isSuperAdmin) salesQuery = salesQuery.eq('tenant_id', me.tenant_id)

  const { data: salesData, error } = await salesQuery
  const sales = (salesData ?? []) as unknown as SaleRow[]

  const practiceIds = [...new Set(sales.map((sale) => sale.practice_id).filter(Boolean))]
  const userIds = [...new Set(sales.map((sale) => sale.sold_by).filter((id): id is string => Boolean(id)))]
  const tenantIds = [...new Set(sales.map((sale) => sale.tenant_id).filter((id): id is string => Boolean(id)))]

  const [practicesResult, usersResult, tenantsResult] = await Promise.all([
    practiceIds.length
      ? supabase.from('master_practices').select('id, practice_code, name').in('id', practiceIds)
      : Promise.resolve({ data: [] as PracticeRow[] }),
    userIds.length
      ? supabase.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as UserRow[] }),
    isSuperAdmin && tenantIds.length
      ? supabase.from('tenants').select('id, name').in('id', tenantIds)
      : Promise.resolve({ data: [] as TenantRow[] }),
  ])

  const practices = (practicesResult.data ?? []) as PracticeRow[]
  const sellers = (usersResult.data ?? []) as UserRow[]
  const tenants = (tenantsResult.data ?? []) as TenantRow[]
  const practiceById = new Map(practices.map((practice) => [practice.id, practice]))
  const sellerById = new Map(sellers.map((seller) => [seller.id, seller.full_name]))
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]))

  const currentUser = {
    full_name: me.full_name,
    role: roleLabel(roleKey),
    company: me.tenants?.name ?? '',
  }

  const scopeText = isSuperAdmin
    ? 'All companies'
    : isPersonal
      ? 'Sales completed by you'
      : me.tenants?.name ?? 'Your company'

  return (
    <AppShell
      title="Sold Leads"
      subtitle={`${sales.length} completed sale${sales.length === 1 ? '' : 's'} · ${scopeText}`}
      currentUser={currentUser}
      active="/sold-leads"
      showAdmin={isSuperAdmin}
      showTransfers
      canManageUsers={canManageUsers}
    >
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <h2 className="h-section" style={{ margin: 0 }}>Completed Sales</h2>
            <p className="subtle" style={{ margin: '4px 0 0' }}>Leads marked as SOLD, with their contract and ownership details.</p>
          </div>
          <span className="badge badge-green">{sales.length} sold</span>
        </div>

        {error ? (
          <p style={{ color: 'var(--danger)' }}>Could not load sold leads: {error.message}</p>
        ) : sales.length === 0 ? (
          <p className="subtle">No sold leads are available in your scope yet.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Practice</th>
                  {isSuperAdmin && <th>Company</th>}
                  <th>Sold By</th>
                  <th>Service</th>
                  <th>Contract Value</th>
                  <th>MRR</th>
                  <th>Sale Date</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const practice = practiceById.get(sale.practice_id)
                  return (
                    <tr key={sale.id}>
                      <td>
                        {practice ? (
                          <Link prefetch={false} href={`/practice/${practice.practice_code}`}>
                            <strong>{practice.name}</strong>
                            <span className="subtle mono" style={{ display: 'block', fontSize: 10.5 }}>{practice.practice_code}</span>
                          </Link>
                        ) : (
                          <span className="subtle">Deleted or unavailable lead</span>
                        )}
                      </td>
                      {isSuperAdmin && <td>{sale.tenant_id ? tenantById.get(sale.tenant_id) ?? 'Unknown company' : 'Unknown company'}</td>}
                      <td>{sale.sold_by ? sellerById.get(sale.sold_by) ?? 'Unknown user' : '—'}</td>
                      <td><span className="badge badge-green">{sale.service_sold || 'Sold'}</span></td>
                      <td><strong>{money(sale.contract_value)}</strong></td>
                      <td>{money(sale.mrr)}</td>
                      <td>{displayDate(sale.sale_date)}</td>
                      <td style={{ minWidth: 180, maxWidth: 320, whiteSpace: 'normal' }}>{sale.note || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
