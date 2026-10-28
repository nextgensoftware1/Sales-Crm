'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

export type Reminder = {
  id: string
  companyId: string | null
  practiceCode: string | null
  practiceName: string
  remindAt: string
  note: string | null
  done: boolean
  completedAt: string | null
  // Shown whenever the view spans more than just the caller's own reminders.
  agentName: string | null
  // Shown for Super Admin only, since that's the only view spanning companies.
  companyName: string | null
  practiceDeleted: boolean
}

type ReminderRow = {
  id: string
  practice_id: string
  tenant_id: string | null
  agent_id: string
  remind_at: string
  note: string | null
  done: boolean
  completed_at: string | null
  master_practices: { practice_code: string; name: string } | null
  users: { full_name: string } | null
  tenants: { name: string } | null
}

type ReminderAccessRow = { id: string; agent_id: string; tenant_id: string | null }

async function whoAmI() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return null
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return null
  return {
    id: me.id,
    tenantId: me.tenant_id,
    roleKey: me.roles?.key ?? '',
  }
}

// Returns reminders in scope for the caller:
//   super_admin: every company's reminders
//   company_admin / manager / team_lead: their own company's reminders (every agent/closer)
//   agent / closer: only reminders they personally set
export async function getReminders(): Promise<{
  ok: boolean; message?: string; reminders?: Reminder[]; scope?: 'all' | 'company' | 'mine'
}> {
  return readReminders(false)
}

// ← ADDED: only reminders that are not done yet — all the notification bell
// needs. The bell loads on every page, and the full list (with every
// completed reminder ever) grows forever; this keeps that request small.
export async function getActiveReminders(): Promise<{
  ok: boolean; message?: string; reminders?: Reminder[]; scope?: 'all' | 'company' | 'mine'
}> {
  return readReminders(true)
}

// ← ADDED (free-plan egress saver): the notification bell's once-a-day load.
// Only active reminders due inside one time window (the bell asks for
// "24 hours ago → 24 hours ahead"), capped at 100 rows. Older overdue and
// later reminders are still on the /reminders page.
export async function getBellReminders(fromISO: string, toISO: string): Promise<{
  ok: boolean; message?: string; reminders?: Reminder[]; scope?: 'all' | 'company' | 'mine'
}> {
  const from = new Date(fromISO)
  const to = new Date(toISO)
  if (isNaN(+from) || isNaN(+to) || +to <= +from) return { ok: false, message: 'Invalid reminder window.' }
  return readReminders(true, { from: from.toISOString(), to: to.toISOString(), limit: 100 })
}

async function readReminders(activeOnly: boolean, window?: { from: string; to: string; limit: number }): Promise<{ // ← CHANGED: shared by all three
  ok: boolean; message?: string; reminders?: Reminder[]; scope?: 'all' | 'company' | 'mine'
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }

  const isSuperAdmin = me.roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(me.roleKey)
  const scope: 'all' | 'company' | 'mine' = isSuperAdmin ? 'all' : isCompanyRole ? 'company' : 'mine'

  const readRows = (includeCompletedAt: boolean) => {
    let q = supabase
      .from('lead_reminders')
      .select(`id, practice_id, tenant_id, agent_id, remind_at, note, done, ${includeCompletedAt ? 'completed_at,' : ''} master_practices(practice_code, name), users(full_name), tenants(name)`)
      .order('remind_at', { ascending: true })
    if (scope === 'company') q = q.eq('tenant_id', me.tenantId)
    else if (scope === 'mine') q = q.eq('agent_id', me.id)
    if (activeOnly) q = q.or('done.is.null,done.eq.false') // ← ADDED
    if (window) q = q.gte('remind_at', window.from).lte('remind_at', window.to).limit(window.limit) // ← ADDED: bell window
    return q
  }

  let { data: rows, error } = await readRows(true)
  // Safe rollout fallback: existing databases keep working until the additive
  // completed_at migration is applied.
  if (error?.code === '42703') ({ data: rows, error } = await readRows(false))
  if (error) return { ok: false, message: error.message }
  if (!rows || rows.length === 0) return { ok: true, reminders: [], scope }

  const reminders: Reminder[] = (rows as unknown as ReminderRow[]).map((r) => {
    const p = r.master_practices
    return {
      id: r.id,
      companyId: r.tenant_id ?? null,
      practiceCode: p?.practice_code ?? null,
      practiceName: p?.name ?? '(deleted lead)',
      remindAt: r.remind_at,
      note: r.note ?? null,
      done: !!r.done,
      completedAt: r.completed_at ?? null,
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
export async function markReminderDone(reminderId: string): Promise<{ ok: boolean; message?: string; completedAt?: string }> {
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
  const access = reminder as ReminderAccessRow
  const isMine = access.agent_id === me.id
  const isMyCompany = isCompanyRole && access.tenant_id === me.tenantId
  if (!isSuperAdmin && !isMine && !isMyCompany) {
    return { ok: false, message: 'Not allowed.' }
  }

  const completedAt = new Date().toISOString()
  let { error } = await supabase.from('lead_reminders').update({ done: true, completed_at: completedAt }).eq('id', reminderId)
  if (error?.code === '42703') ({ error } = await supabase.from('lead_reminders').update({ done: true }).eq('id', reminderId))
  if (error) return { ok: false, message: error.message }
  return { ok: true, completedAt }
}


// ← ADDED: everything an agent did on the lead behind a reminder — every
// saved call note with its date, disposition and who saved it — plus the
// lead's callback history (each callback set, and when it was completed or
// replaced by a newer one). Same visibility as the reminder itself.
export type LeadNote = { at: string; by: string | null; disposition: string | null; note: string | null }
export type LeadCallback = { remindAt: string; setAt: string | null; completedAt: string | null; done: boolean; note: string | null; by: string | null }

export async function getLeadNotes(reminderId: string): Promise<{
  ok: boolean; message?: string; notes?: LeadNote[]; callbacks?: LeadCallback[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (typeof reminderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(reminderId)) return { ok: false, message: 'Invalid reminder.' }

  const { data: reminder } = await supabase
    .from('lead_reminders')
    .select('id, agent_id, tenant_id, practice_id, master_practices(practice_code)')
    .eq('id', reminderId)
    .maybeSingle()
  if (!reminder) return { ok: false, message: 'This reminder no longer exists.' }

  const row = reminder as unknown as { agent_id: string; tenant_id: string | null; practice_id: string; master_practices: { practice_code: string | null } | null }
  const isSuperAdmin = me.roleKey === 'super_admin'
  const isCompanyRole = ['company_admin', 'manager', 'team_lead'].includes(me.roleKey)
  if (!isSuperAdmin && row.agent_id !== me.id && !(isCompanyRole && row.tenant_id === me.tenantId)) {
    return { ok: false, message: 'Not allowed.' }
  }

  // The same practice can exist as more than one row (e.g. Platform copy and
  // company copy) — collect all rows with this practice code.
  let practiceIds = [row.practice_id]
  const code = row.master_practices?.practice_code
  if (code) {
    const { data: copies } = await supabase.from('master_practices').select('id').eq('practice_code', code)
    practiceIds = Array.from(new Set([row.practice_id, ...((copies ?? []) as { id: string }[]).map((c) => c.id)]))
  }

  let activityQuery = supabase.from('lead_activity')
    .select('created_at, disposition, note, users(full_name)')
    .in('practice_id', practiceIds)
    .order('created_at', { ascending: false })
    .limit(100)
  let callbackQuery = supabase.from('lead_reminders')
    .select('remind_at, created_at, completed_at, done, note, users(full_name)')
    .in('practice_id', practiceIds)
    .order('created_at', { ascending: false })
    .limit(50)
  if (row.tenant_id) {
    activityQuery = activityQuery.eq('tenant_id', row.tenant_id)
    callbackQuery = callbackQuery.eq('tenant_id', row.tenant_id)
  }
  const [activity, callbacks] = await Promise.all([activityQuery, callbackQuery])
  if (activity.error) return { ok: false, message: activity.error.message }

  type ActivityRow = { created_at: string; disposition: string | null; note: string | null; users: { full_name: string | null } | null }
  type CallbackRow = { remind_at: string; created_at: string | null; completed_at: string | null; done: boolean | null; note: string | null; users: { full_name: string | null } | null }
  return {
    ok: true,
    notes: ((activity.data ?? []) as unknown as ActivityRow[]).map((a) => ({
      at: a.created_at, by: a.users?.full_name ?? null, disposition: a.disposition, note: a.note,
    })),
    callbacks: callbacks.error ? [] : ((callbacks.data ?? []) as unknown as CallbackRow[]).map((c) => ({
      remindAt: c.remind_at, setAt: c.created_at, completedAt: c.completed_at, done: c.done === true, note: c.note, by: c.users?.full_name ?? null,
    })),
  }
}
