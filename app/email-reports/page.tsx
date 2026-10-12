// ← ADDED (new file) — Email Sheet Report: the latest saved email worksheet
// per Email lead. Same visibility as Worksheet Reports.
import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import AppShell from '../AppShell'
import EmailReportsClient from './EmailReportsClient'
import { getEmailReports } from '../email-worksheet-actions'

export default async function EmailReportsPage() {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = me?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me ? { full_name: me.full_name, role: roleLabel(me.roles?.key), company: me.tenants?.name ?? '' } : null

  const result = await getEmailReports()
  const subtitle = !result.ok ? '' : result.scope === 'all' ? 'All companies' : result.scope === 'company' ? `Scoped to ${me?.tenants?.name ?? 'your company'}` : 'Email work you saved'

  return (
    <AppShell title="Email Sheet Report" subtitle={subtitle} currentUser={currentUser} active="/email-reports"
      showAdmin={isSuperAdmin} showTransfers canManageUsers={canManageUsers}>
      {result.ok ? (
        <EmailReportsClient rows={result.rows} truncated={result.truncated} showCompany={result.scope === 'all'} />
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 18, margin: '0 0 8px' }}>Can&apos;t show the email report</h1>
          <p className="subtle">{result.message}</p>
        </div>
      )}
    </AppShell>
  )
}
