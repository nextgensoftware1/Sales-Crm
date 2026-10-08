import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import KpiClient from './KpiClient'
import { getTransferKpi } from '../kpi-actions'

// KPI records: PKR 500 per verified transfer. Agents and closers see their own
// records; managers, team leads and company admins see their company; Super
// Admin sees every company. Visibility is enforced by the database (RLS).
export default async function KpiPage() {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  const kpi = await getTransferKpi()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me
    ? { full_name: (me as any).full_name, role: roleLabel((me as any).roles?.key), company: (me as any).tenants?.name ?? '' }
    : null

  return (
    <AppShell
      title="KPI"
      subtitle={isSuperAdmin
        ? 'Verified transfer earnings — every company'
        : kpi.scope === 'team' ? `Verified transfer earnings — ${(me as any)?.tenants?.name ?? 'your company'}` : 'Your verified transfer earnings'}
      currentUser={currentUser}
      active="/kpi"
      showAdmin={isSuperAdmin}
      showTransfers
      canManageUsers={canManageUsers}
    >
      <KpiClient initial={kpi} />
    </AppShell>
  )
}
