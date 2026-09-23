import Link from 'next/link'
import { getCurrentUser, getCurrentProfile } from '../../../lib/supabase-server'
import { roleLabel } from '../../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../../AppShell'
import RoleViewClient from './RoleViewClient'

export default async function RoleView() {

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

  return (
    <AppShell
      title="View as Role"
      subtitle="Super Admin — inspect exactly what each role sees."
      currentUser={currentUser}
      active="/admin"
      showAdmin
      showTransfers
      canManageUsers
      headerRight={
        <Link prefetch={false} href="/admin" className="btn" style={{ textDecoration: 'none' }}>← Back to admin</Link>
      }
    >
      <RoleViewClient />
    </AppShell>
  )
}
