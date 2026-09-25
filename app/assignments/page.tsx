import Link from 'next/link'
import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import AssignmentsClient from './AssignmentsClient'
import CompanyAllocationsClient from './CompanyAllocationsClient'

export default async function ManageAssignmentsPage() {

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

  return (
    <AppShell
      title="Assigned Leads"
      subtitle={isSuperAdmin ? 'Review leads successfully allocated to each company.' : 'Review leads assigned to your team.'}
      currentUser={currentUser}
      active="/assignments"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
      headerRight={
        <Link prefetch={false} href="/dashboard" className="btn" style={{ textDecoration: 'none' }}>← Back to dashboard</Link>
      }
    >
      {isSuperAdmin ? <CompanyAllocationsClient /> : <AssignmentsClient />}
    </AppShell>
  )
}
