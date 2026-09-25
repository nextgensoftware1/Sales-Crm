import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import RemindersClient from './RemindersClient'
import { getReminders } from '../reminders-actions'
import { ReminderCompanyFilterProvider, ReminderCompanyNav } from './ReminderCompanyFilter'

export default async function RemindersPage() {

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const supabase = await createSupabaseServer()
  const companyRequest = isSuperAdmin
    ? supabase.from('tenants').select('id, name').eq('is_platform', false).eq('status', 'active').order('name')
    : Promise.resolve({ data: [] as Array<{ id: string; name: string }> })
  const [reminderResult, companyResult] = await Promise.all([getReminders(), companyRequest])
  const companies = companyResult.data ?? []
  const companyReminderCounts = (reminderResult.reminders ?? []).reduce<Record<string, number>>((counts, reminder) => {
    if (reminder.companyId) counts[reminder.companyId] = (counts[reminder.companyId] ?? 0) + 1
    return counts
  }, {})
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  return (
    <ReminderCompanyFilterProvider companies={companies}>
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
      contextExtra={isSuperAdmin ? <ReminderCompanyNav counts={companyReminderCounts} /> : null}
    >
      <RemindersClient initialData={reminderResult.ok ? {
        reminders: reminderResult.reminders ?? [],
        scope: reminderResult.scope ?? 'mine',
      } : undefined} initialMessage={reminderResult.ok ? undefined : reminderResult.message} companies={companies} />
    </AppShell>
    </ReminderCompanyFilterProvider>
  )
}
