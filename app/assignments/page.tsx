import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import AssignmentsClient from './AssignmentsClient'

export default async function ManageAssignmentsPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const isSuperAdmin = (me as any)?.roles?.key === 'super_admin'
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? '',
      }
    : null

  return (
    <AppShell
      title="Manage Assignments"
      subtitle="Leads you assigned. Remove one to send it back to the unassigned pool."
      currentUser={currentUser}
      active="/dashboard"
      showAdmin={isSuperAdmin}
      headerRight={
        <a href="/dashboard" className="btn" style={{ textDecoration: 'none' }}>← Back to dashboard</a>
      }
    >
      <AssignmentsClient />
    </AppShell>
  )
}
