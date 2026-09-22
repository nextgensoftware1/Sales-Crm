import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import WorksheetReportsClient from './WorksheetReportsClient'
import { getWorksheetReports } from '../worksheet-reports-actions'

export default async function WorksheetReportsPage() {

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)

  // Same permission gate as the Admin page — Agents and Closers can't reach
  // this even by URL. Enforced again inside getWorksheetReports() itself,
  // independent of this page.
  if (!canManageUsers) {
    return (
      <AppShell title="Worksheet Reports" currentUser={currentUser} active="/worksheet-reports" showAdmin={isSuperAdmin} canManageUsers={canManageUsers}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 20, margin: '0 0 8px' }}>Access denied</h1>
          <p className="subtle">Only Team Lead, Manager, Company Admin, and Super Admin can view worksheet reports.</p>
        </div>
      </AppShell>
    )
  }

  const worksheetReports = await getWorksheetReports()

  return (
    <AppShell
      title="Worksheet Reports"
      subtitle={isSuperAdmin ? 'Platform-wide — every company' : `Scoped to ${(me as any)?.tenants?.name ?? 'your company'}`}
      currentUser={currentUser}
      active="/worksheet-reports"
      showAdmin={isSuperAdmin}
      canManageUsers={canManageUsers}
    >
      <div className="card">
        {worksheetReports.ok ? (
          <WorksheetReportsClient rows={worksheetReports.rows} scope={worksheetReports.scope} companyName={worksheetReports.companyName} truncated={worksheetReports.truncated} />
        ) : (
          <p className="subtle">{worksheetReports.message}</p>
        )}
      </div>
    </AppShell>
  )
}
