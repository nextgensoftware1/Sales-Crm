import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import { getCurrentProfile, getCurrentUser } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { getWorksheetUpdates } from '../worksheet-updates-actions'
import WorksheetUpdatesClient from './WorksheetUpdatesClient'

export default async function WorksheetUpdatesPage() {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) redirect('/login')
  const roleKey = me.roles?.key ?? ''
  const allowed = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const isSuperAdmin = roleKey === 'super_admin'
  const currentUser = { full_name: me.full_name, role: roleLabel(roleKey), company: me.tenants?.name ?? '' }
  const result = allowed ? await getWorksheetUpdates() : { ok: false as const, message: 'Only administrative roles can review worksheet updates.' }

  return <AppShell title="Worksheet Updates" subtitle={isSuperAdmin ? 'Audit saved worksheet edits across every company' : `Audit saved worksheet edits for ${me.tenants?.name ?? 'your company'}`} currentUser={currentUser} active="/worksheet-updates" showAdmin={isSuperAdmin} canManageUsers={allowed}>
    {!result.ok ? <div className="card"><h2 className="h-section">Access unavailable</h2><p className="subtle">{result.message}</p></div>
      : <WorksheetUpdatesClient rows={result.rows} showCompany={result.scope === 'all'} truncated={result.truncated} />}
  </AppShell>
}
