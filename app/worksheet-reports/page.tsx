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

  const worksheetReports = await getWorksheetReports()

  return (
    <AppShell
      title="Worksheet Reports"
      subtitle={isSuperAdmin
        ? 'Platform-wide — every company'
        : personalScope
          ? 'Your personally saved worksheets'
          : `Scoped to ${me?.tenants?.name ?? 'your company'}`}
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
