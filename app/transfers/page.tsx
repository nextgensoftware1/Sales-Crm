import { createSupabaseServer } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import TransfersClient from './TransfersClient'

export default async function TransfersPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  return (
    <AppShell
      title="Transfers"
      subtitle="Leads handed off to a closer, with the full worksheet from the transferring agent."
      currentUser={currentUser}
      active="/transfers"
      showAdmin={isSuperAdmin}
      showTransfers
      canManageUsers={canManageUsers}
    >
      <TransfersClient />
    </AppShell>
  )
}
