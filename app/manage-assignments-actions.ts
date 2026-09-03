'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// ---------------------------------------------------------------------------
// Manage the assignments I personally made (assigned_by = me).
//
//   getMyAssignmentSummary()  → my direct reports + how many leads I gave each
//   getAssignedLeads(agentId) → the leads I assigned to that specific person
//   unassignLead(practiceCode, agentId) → remove that assignment (back to pool)
//
// All scoped so a caller can only touch assignments they created.
// ---------------------------------------------------------------------------

async function whoAmI(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  return me
    ? { id: (me as any).id, tenantId: (me as any).tenant_id, roleKey: (me as any).roles?.key ?? '' }
    : null
}

// Practice codes whose ORIGIN is a Company Admin — i.e. leads that came down
// from the admin, regardless of who currently holds them. Used to star them
// on the Manage Assignments page.
export async function getMyIncomingCodes(): Promise<string[]> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI(supabase)
  if (!me) return []

  // Find the company_admin user id(s) for my tenant.
  const { data: admins } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('tenant_id', me.tenantId)
  const adminIds = (admins ?? [])
    .filter((u: any) => u.roles?.key === 'company_admin')
    .map((u: any) => u.id)
  if (adminIds.length === 0) return []

  const { data: rows } = await supabase
    .from('lead_assignments')
    .select('origin_user_id, master_practices(practice_code)')
    .in('origin_user_id', adminIds)
    .eq('status', 'active')

  return (rows ?? [])
    .map((r: any) => r.master_practices?.practice_code)
    .filter(Boolean)
}

const CAN_MANAGE = ['company_admin', 'manager', 'team_lead']

// People I assigned leads to, with a count.
export async function getMyAssignmentSummary(): Promise<{
  ok: boolean
  message?: string
  people?: { id: string; full_name: string; role: string; count: number }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI(supabase)
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const { data: rows, error } = await supabase
    .from('lead_assignments')
    .select('assigned_to, users!lead_assignments_assigned_to_fkey(full_name, roles(label))')
    .eq('assigned_by', me.id)
    .eq('status', 'active')

  if (error) return { ok: false, message: error.message }

  const map = new Map<string, { id: string; full_name: string; role: string; count: number }>()
  for (const r of (rows ?? []) as any[]) {
    const id = r.assigned_to
    if (!id) continue
    const existing = map.get(id)
    if (existing) existing.count++
    else map.set(id, {
      id,
      full_name: r.users?.full_name ?? 'Unknown',
      role: r.users?.roles?.label ?? '',
      count: 1,
    })
  }
  return { ok: true, people: Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name)) }
}

// The leads I assigned to one specific person.
export async function getAssignedLeads(agentId: string): Promise<{
  ok: boolean
  message?: string
  leads?: { practiceCode: string; name: string; state: string | null; specialty: string | null; assignedAt: string }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI(supabase)
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const { data: rows, error } = await supabase
    .from('lead_assignments')
    .select('assigned_at, master_practices(practice_code, name, state, specialty)')
    .eq('assigned_by', me.id)
    .eq('assigned_to', agentId)
    .eq('status', 'active')

  if (error) return { ok: false, message: error.message }

  const leads = (rows ?? [])
    .map((r: any) => ({
      practiceCode: r.master_practices?.practice_code,
      name: r.master_practices?.name ?? '',
      state: r.master_practices?.state ?? null,
      specialty: r.master_practices?.specialty ?? null,
      assignedAt: r.assigned_at,
    }))
    .filter((l: any) => l.practiceCode)
    .sort((a: any, b: any) => a.name.localeCompare(b.name))

  return { ok: true, leads }
}

// Remove one assignment (I made it) → the lead returns to the unassigned pool.
export async function unassignLead(practiceCode: string, agentId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI(supabase)
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  // resolve practice_code → id, scoped to my company
  const { data: prac } = await supabase
    .from('master_practices')
    .select('id')
    .eq('owner_tenant_id', me.tenantId)
    .eq('practice_code', practiceCode)
    .maybeSingle()

  if (!prac) return { ok: false, message: 'Lead not found in your company.' }

  // delete only the assignment I made to this person
  const { error } = await supabase
    .from('lead_assignments')
    .delete()
    .eq('practice_id', (prac as any).id)
    .eq('assigned_to', agentId)
    .eq('assigned_by', me.id)

  if (error) return { ok: false, message: `Remove failed: ${error.message}` }
  return { ok: true, message: 'Lead un-assigned and returned to the pool.' }
}