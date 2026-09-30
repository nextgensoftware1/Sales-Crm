import Link from 'next/link'
import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import AgentAssignedClient from './AgentAssignedClient'
import { getAgentAssignedLeads } from '../agent-assigned-actions'

export default async function AgentAssignedLeadsPage() {

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  // Fetched here (server-side) instead of the client component fetching
  // it after mount — same data, same request, just no longer a visible
  // extra round-trip after the page has already loaded.
  const agentAssignedData = await getAgentAssignedLeads()

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
      title="Agent Assigned Leads"
      subtitle="Leads currently assigned to each agent/closer."
      currentUser={currentUser}
      active="/"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
      headerRight={
        <Link prefetch={false} href="/" className="btn" style={{ textDecoration: 'none' }}>← Back to practices</Link>
      }
    >
      <AgentAssignedClient initialData={agentAssignedData} />
    </AppShell>
  )
}
