import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import WorksheetReportsClient from './WorksheetReportsClient'
import { getWorksheetReports } from '../worksheet-reports-actions'
import UploadWorksheetCsvButton from './UploadWorksheetCsvButton'
import WorksheetCompanyFilter, { type WorksheetCompanyOption } from './WorksheetCompanyFilter'

export default async function WorksheetReportsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const currentUser = me
    ? {
        full_name: me.full_name,
        role: roleLabel(me.roles?.key),
        company: me.tenants?.name ?? '',
      }
    : null

  const roleKey = me?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const canViewWorksheetReports = ['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)
  const personalScope = roleKey === 'agent' || roleKey === 'closer'

  if (!canViewWorksheetReports) {
    return (
      <AppShell title="Worksheet Reports" currentUser={currentUser} active="/worksheet-reports" showAdmin={isSuperAdmin} canManageUsers={canManageUsers}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 20, margin: '0 0 8px' }}>Access denied</h1>
          <p className="subtle">You do not have permission to view worksheet reports.</p>
        </div>
      </AppShell>
    )
  }

  // The tenants lookup only needs isSuperAdmin (already known) — it doesn't
  // actually depend on worksheetReports' result, so run them together
  // instead of tenants waiting for the whole worksheet report to finish first.
  const [worksheetReports, tenantRowsResult] = await Promise.all([
    getWorksheetReports(),
    isSuperAdmin
      ? createSupabaseServer().then(supabase => supabase.from('tenants').select('id, name').eq('status', 'active').order('name'))
      : Promise.resolve({ data: null }),
  ])
  const requestedCompany = (await searchParams).company ?? '__all__'
  let companies: WorksheetCompanyOption[] = []
  if (worksheetReports.ok) {
    const countByTenant = new Map<string, number>()
    for (const row of worksheetReports.rows) countByTenant.set(row.tenantId, (countByTenant.get(row.tenantId) ?? 0) + 1)
    if (isSuperAdmin) {
      companies = (tenantRowsResult.data ?? []).map(tenant => ({ id: tenant.id, name: tenant.name, count: countByTenant.get(tenant.id) ?? 0 }))
    } else if (me?.tenant_id) {
      companies = [{ id: me.tenant_id, name: me.tenants?.name ?? 'Your company', count: countByTenant.get(me.tenant_id) ?? worksheetReports.rows.length }]
    }
  }
  const selectedCompany = companies.some(company => company.id === requestedCompany) ? requestedCompany : '__all__'
  const visibleReports = worksheetReports.ok && selectedCompany !== '__all__'
    ? { ...worksheetReports, rows: worksheetReports.rows.filter(row => row.tenantId === selectedCompany) }
    : worksheetReports
  const selectedCompanyName = companies.find(company => company.id === selectedCompany)?.name

  return (
    <AppShell
      title="Worksheet Reports"
      subtitle={isSuperAdmin
        ? selectedCompanyName ? `Company — ${selectedCompanyName}` : 'Platform-wide — every company'
        : personalScope
          ? 'Your personally saved worksheets'
          : `Scoped to ${me?.tenants?.name ?? 'your company'}`}
      currentUser={currentUser}
      active="/worksheet-reports"
      showAdmin={isSuperAdmin}
      canManageUsers={canManageUsers}
      headerRight={isSuperAdmin ? <UploadWorksheetCsvButton /> : null}
      contextExtra={worksheetReports.ok ? <WorksheetCompanyFilter companies={companies} selected={selectedCompany} showAll={isSuperAdmin} /> : null}
      contextItemsHidden
      contextHelpText="Choose a company to filter both Report View and Spreadsheet View. Row-count controls are available inside each view."
    >
      <div className="card">
        {visibleReports.ok ? (
          <WorksheetReportsClient rows={visibleReports.rows} scope={visibleReports.scope} companyName={selectedCompanyName ?? visibleReports.companyName} truncated={visibleReports.truncated} viewerTenantId={me?.tenant_id ?? null} />
        ) : (
          <p className="subtle">{visibleReports.message}</p>
        )}
      </div>
    </AppShell>
  )
}
