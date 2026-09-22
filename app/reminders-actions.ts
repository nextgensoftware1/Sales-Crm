'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

export type Reminder = {
  id: string
  practiceCode: string | null
  practiceName: string
  remindAt: string
  note: string | null
  done: boolean
  // Shown whenever the view spans more than just the caller's own reminders.
  agentName: string | null
  // Shown for Super Admin only, since that's the only view spanning companies.
  companyName: string | null
  practiceDeleted: boolean
}

async function whoAmI() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return null
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return null
  return {
    id: (me as any).id as string,
    tenantId: (me as any).tenant_id as string | null,
    roleKey: (me as any).roles?.key ?? '' as string,
  }
}

// Returns reminders in scope for the caller:
//   super_admin: every company's reminders
//   company_admin / manager / team_lead: their own company's reminders (every agent/closer)
//   agent / closer: only reminders they personally set
export async function getReminders(): Promise<{
  ok: boolean; message?: string; reminders?: Reminder[]; scope?: 'all' | 'company' | 'mine'
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }

  const isSuperAdmin = me.roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(me.roleKey)
  const scope: 'all' | 'company' | 'mine' = isSuperAdmin ? 'all' : isCompanyRole ? 'company' : 'mine'

  let q = supabase
    .from('lead_reminders')
    .select('id, practice_id, tenant_id, agent_id, remind_at, note, done, master_practices(practice_code, name), users(full_name), tenants(name)')
    .order('remind_at', { ascending: true })
  if (scope === 'company') q = q.eq('tenant_id', me.tenantId)
  else if (scope === 'mine') q = q.eq('agent_id', me.id)

  const { data: rows, error } = await q
  if (error) return { ok: false, message: error.message }
  if (!rows || rows.length === 0) return { ok: true, reminders: [], scope }

  const reminders: Reminder[] = rows.map((r: any) => {
    const p = r.master_practices
    return {
      id: r.id,
      practiceCode: p?.practice_code ?? null,
      practiceName: p?.name ?? '(deleted lead)',
      remindAt: r.remind_at,
      note: r.note ?? null,
      done: !!r.done,
      agentName: scope !== 'mine' ? (r.users?.full_name ?? null) : null,
      companyName: isSuperAdmin ? (r.tenants?.name ?? null) : null,
      practiceDeleted: !p,
    }
  })

  return { ok: true, reminders, scope }
}

// Marks a reminder done. Allowed for the agent who set it, their company's
// management (company_admin/manager/team_lead), or Super Admin — matches the
// same "who can see it" scope, since anyone who can see a reminder in an
// oversight view should also be able to clear a stale one.
export async function markReminderDone(reminderId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }

  const { data: reminder } = await supabase
    .from('lead_reminders')
    .select('id, agent_id, tenant_id')
    .eq('id', reminderId)
    .maybeSingle()
  if (!reminder) return { ok: false, message: 'This reminder no longer exists.' }

  const isSuperAdmin = me.roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(me.roleKey)
  const isMine = (reminder as any).agent_id === me.id
  const isMyCompany = isCompanyRole && (reminder as any).tenant_id === me.tenantId
  if (!isSuperAdmin && !isMine && !isMyCompany) {
    return { ok: false, message: 'Not allowed.' }
  }

  const { error } = await supabase.from('lead_reminders').update({ done: true }).eq('id', reminderId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

