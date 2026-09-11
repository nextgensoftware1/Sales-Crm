import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import RemindersClient from './RemindersClient'

export default async function RemindersPage() {
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
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
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
    >
      <RemindersClient />
    </AppShell>
  )
}
