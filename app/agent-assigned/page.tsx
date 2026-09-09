import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import AgentAssignedClient from './AgentAssignedClient'

export default async function AgentAssignedLeadsPage() {
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
      title="Agent Assigned Leads"
      subtitle="Leads currently assigned to each agent/closer."
      currentUser={currentUser}
      active="/"
      showAdmin={isSuperAdmin}
      headerRight={
        <a href="/" className="btn" style={{ textDecoration: 'none' }}>← Back to practices</a>
      }
    >
      <AgentAssignedClient />
    </AppShell>
  )
}
