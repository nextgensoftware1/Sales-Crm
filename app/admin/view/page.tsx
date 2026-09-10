import { createSupabaseServer } from '../../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../../AppShell'
import RoleViewClient from './RoleViewClient'

export default async function RoleView() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
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
      headerRight={
        <a href="/admin" className="btn" style={{ textDecoration: 'none' }}>← Back to admin</a>
      }
    >
      <RoleViewClient />
    </AppShell>
  )
}
