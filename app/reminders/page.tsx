import { getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import RemindersClient from './RemindersClient'
import { getReminders } from '../reminders-actions'

export default async function RemindersPage() {

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  const reminderResult = await getReminders()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  return (
    <AppShell
      title={isSuperAdmin ? 'All Reminders' : isCompanyRole ? 'Team Reminders' : 'My Reminders'}
      subtitle={
        isSuperAdmin
          ? 'Every follow-up and callback scheduled, across all companies.'
          : isCompanyRole
            ? "Follow-ups and callbacks your company's agents and closers have scheduled."
            : "Follow-ups and callbacks you've scheduled"
      }
      currentUser={currentUser}
      active="/reminders"
      showAdmin={isSuperAdmin}
      showTransfers
      canManageUsers={isSuperAdmin || isCompanyRole}
      initialReminders={reminderResult.ok ? reminderResult.reminders ?? [] : undefined}
    >
      <RemindersClient initialData={reminderResult.ok ? {
        reminders: reminderResult.reminders ?? [],
        scope: reminderResult.scope ?? 'mine',
      } : undefined} initialMessage={reminderResult.ok ? undefined : reminderResult.message} />
    </AppShell>
  )
}
