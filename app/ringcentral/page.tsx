import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import RingCentralClient from './RingCentralClient'

export default async function RingCentralPage() {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = me?.roles?.key ?? ''
  const allowed = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me ? {
    full_name: me.full_name,
    role: roleLabel(me.roles?.key),
    company: me.tenants?.name ?? '',
  } : null

  if (!allowed) {
    return (
      <AppShell title="RingCentral" currentUser={currentUser} active="/ringcentral">
        <div className="card"><h2>Access denied</h2><p className="subtle">Your role cannot access RingCentral call history.</p></div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="RingCentral"
      subtitle="Live call history from RingCentral"
      currentUser={currentUser}
      active="/ringcentral"
      showAdmin={roleKey === 'super_admin'}
      canManageUsers={['company_admin', 'manager', 'team_lead'].includes(roleKey)}
      showTransfers={false}
    >
      <RingCentralClient />
    </AppShell>
  )
}
