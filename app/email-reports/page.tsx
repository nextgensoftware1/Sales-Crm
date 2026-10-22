// ← ADDED (new file) — Email Sheet Report: the latest saved email worksheet
// per Email lead. Same visibility as Worksheet Reports.
import { redirect } from 'next/navigation'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server' // ← CHANGED: + createSupabaseServer
import { roleLabel } from '../../lib/roles'
import AppShell from '../AppShell'
import EmailReportsClient from './EmailReportsClient'
import { getEmailReports } from '../email-worksheet-actions'
import WorksheetCompanyFilter, { type WorksheetCompanyOption } from '../worksheet-reports/WorksheetCompanyFilter' // ← ADDED

// ← CHANGED: company list in the side panel, exactly like Active Call.
// Super Admin: "All companies" + every active company with its email-lead
// count; picking one (?company=<id>) shows only that company's leads, and the
// Agent dropdown then lists only that company's agents.
// Everyone else: their own company only.
export default async function EmailReportsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = me?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me ? { full_name: me.full_name, role: roleLabel(me.roles?.key), company: me.tenants?.name ?? '' } : null

  // ← CHANGED: the company list loads alongside the report (not after it).
  const [result, tenantRowsResult] = await Promise.all([
    getEmailReports(),
    isSuperAdmin
      ? createSupabaseServer().then(supabase => supabase.from('tenants').select('id, name').eq('status', 'active').order('name'))
      : Promise.resolve({ data: null }),
  ])

  // ← ADDED: companies + counts, selected company, rows for that company.
  const requestedCompany = (await searchParams).company ?? '__all__'
  let companies: WorksheetCompanyOption[] = []
  if (result.ok) {
    const countByTenant = new Map<string, number>()
    for (const row of result.rows) countByTenant.set(row.tenantId, (countByTenant.get(row.tenantId) ?? 0) + 1)
    if (isSuperAdmin) {
      companies = (tenantRowsResult.data ?? []).map(tenant => ({ id: tenant.id, name: tenant.name, count: countByTenant.get(tenant.id) ?? 0 }))
      // A company that is no longer active but still has saved email work
      // stays reachable, so no lead disappears from the list.
      const listed = new Set(companies.map(company => company.id))
      for (const row of result.rows) {
        if (!listed.has(row.tenantId)) {
          listed.add(row.tenantId)
          companies.push({ id: row.tenantId, name: row.companyName ?? 'Unknown company', count: countByTenant.get(row.tenantId) ?? 0 })
        }
      }
    } else if (me?.tenant_id) {
      companies = [{ id: me.tenant_id, name: me.tenants?.name ?? 'Your company', count: countByTenant.get(me.tenant_id) ?? result.rows.length }]
    }
  }
  const selectedCompany = companies.some(company => company.id === requestedCompany) ? requestedCompany : '__all__'
  const selectedCompanyName = companies.find(company => company.id === selectedCompany)?.name
  const visibleRows = result.ok
    ? (selectedCompany !== '__all__' ? result.rows.filter(row => row.tenantId === selectedCompany) : result.rows)
    : []

  const subtitle = !result.ok ? ''
    : isSuperAdmin
      ? selectedCompanyName ? `Company — ${selectedCompanyName}` : 'Platform-wide — every company' // ← CHANGED
      : result.scope === 'company' ? `Scoped to ${me?.tenants?.name ?? 'your company'}` : 'Email work you saved'

  return (
    <AppShell title="Active Email" subtitle={subtitle} currentUser={currentUser} active="/email-reports"
      showAdmin={isSuperAdmin} showTransfers canManageUsers={canManageUsers}
      // ← ADDED: same side panel as Active Call
      contextExtra={result.ok ? <WorksheetCompanyFilter companies={companies} selected={selectedCompany} showAll={isSuperAdmin} basePath="/email-reports" ariaLabel="Filter email leads by company" /> : null}
      contextItemsHidden
      contextHelpText="Choose a company to see only its email leads. The Agent filter then lists that company's agents.">
      {result.ok ? (
        // ← CHANGED: key resets the filters (agent, response, page) when the
        // company changes, so an agent from the previous company never stays selected.
        // Company column only when several companies are shown together.
        <EmailReportsClient key={selectedCompany} rows={visibleRows} truncated={result.truncated}
          showCompany={isSuperAdmin && selectedCompany === '__all__'} />
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 18, margin: '0 0 8px' }}>Can&apos;t show Active Email</h1>
          <p className="subtle">{result.message}</p>
        </div>
      )}
    </AppShell>
  )
}
