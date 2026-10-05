'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { roleLabel } from '../lib/roles'
import { allRows } from '../lib/practice-navigation'
import { chunks, mapConcurrent } from '../lib/query-utils'

// ---------------------------------------------------------------------------
// Manage the assignments I personally made (assigned_by = me).
//
//   getMyAssignmentSummary()  → my direct reports + how many leads I gave each
//   getAssignedLeads(agentId) → the leads I assigned to that specific person
//   unassignLead(practiceId, agentId) → remove that assignment (back to pool)
//
// All scoped so a caller can only touch assignments they created.
// ---------------------------------------------------------------------------

async function whoAmI() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return null
  const { data: me } = await getCurrentProfile(user.id)
  return me
    ? { id: (me as any).id, tenantId: (me as any).tenant_id, roleKey: (me as any).roles?.key ?? '' }
    : null
}

// Practice codes whose ORIGIN is a Company Admin — i.e. leads that came down
// from the admin, regardless of who currently holds them. Used to star them
// on the Manage Assignments page.
export async function getMyIncomingCodes(): Promise<string[]> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
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

function oneRelation<T>(relation: T | T[] | null | undefined): T | undefined {
  return Array.isArray(relation) ? relation[0] : relation ?? undefined
}

export async function getCompanyAllocationSummary(): Promise<{
  ok: boolean
  message?: string
  companies?: { id: string; name: string; count: number }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (me.roleKey !== 'super_admin') return { ok: false, message: 'Only Super Admin can view company allocations.' }

  // Independent of each other — the allocations query doesn't need the
  // tenant list to run, so run them together instead of tenants finishing
  // fully before allocations even starts.
  const [{ data: tenants, error: tenantError }, allocationsSettled] = await Promise.all([
    supabase.from('tenants').select('id, name').eq('is_platform', false).eq('status', 'active').order('name'),
    allRows<{ tenant_id: string }>(() => supabase
      .from('lead_allocations')
      .select('tenant_id')
      .eq('status', 'active')
      .order('tenant_id')).then(
      (data) => ({ ok: true as const, data }),
      (error) => ({ ok: false as const, error }),
    ),
  ])
  if (tenantError) return { ok: false, message: tenantError.message }

  let allocations: Array<{ tenant_id: string }>
  try {
    if (!allocationsSettled.ok) throw allocationsSettled.error
    allocations = allocationsSettled.data
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not load company allocation totals.' }
  }

  const counts = new Map<string, number>()
  for (const allocation of allocations ?? []) {
    counts.set(allocation.tenant_id, (counts.get(allocation.tenant_id) ?? 0) + 1)
  }

  return {
    ok: true,
    companies: (tenants ?? []).map((tenant) => ({ id: tenant.id, name: tenant.name, count: counts.get(tenant.id) ?? 0 })),
  }
}

export async function getCompanyAllocatedLeads(companyId: string): Promise<{
  ok: boolean
  message?: string
  leads?: { practiceCode: string; name: string; state: string | null; specialty: string | null; allocatedAt: string; status: string }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (me.roleKey !== 'super_admin') return { ok: false, message: 'Only Super Admin can view company allocations.' }
  if (!companyId) return { ok: false, message: 'Choose a company.' }

  let data: any[]
  try {
    data = await allRows<any>(() => supabase
      .from('lead_allocations')
      .select('allocated_at, status, master_practices(practice_code, name, state, specialty)')
      .eq('tenant_id', companyId)
      .eq('status', 'active')
      .order('allocated_at', { ascending: false }))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not load allocated leads.' }
  }

  const leads = (data ?? []).map((row: any) => ({
    practiceCode: row.master_practices?.practice_code,
    name: row.master_practices?.name ?? 'Unnamed practice',
    state: row.master_practices?.state ?? null,
    specialty: row.master_practices?.specialty ?? null,
    allocatedAt: row.allocated_at,
    status: row.status,
  })).filter((lead) => lead.practiceCode)

  return { ok: true, leads }
}

// People with active assignments in my scope, with a count.
export async function getMyAssignmentSummary(): Promise<{
  ok: boolean
  message?: string
  people?: { id: string; full_name: string; role: string; count: number }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const map = new Map<string, { id: string; full_name: string; role: string; count: number }>()
  try {
    if (me.roleKey === 'company_admin') {
      const tenantId = me.tenantId
      if (!tenantId) return { ok: false, message: 'Your account is not assigned to a company.' }

      const members = await allRows<{ id: string; full_name: string | null; roles: { key: string | null } | { key: string | null }[] | null }>(() => supabase
        .from('users')
        .select('id, full_name, roles(key, label)')
        .eq('tenant_id', tenantId)
        .order('id'))
      const memberById = new Map<string, { full_name: string; role: string }>(
        members.map((member) => [member.id, {
          full_name: member.full_name ?? 'Unknown',
          role: roleLabel(oneRelation(member.roles)?.key),
        }])
      )
      const memberIds = [...memberById.keys()]
      const batches = await mapConcurrent(chunks(memberIds, 200), 4, (ids) =>
        allRows<{ assigned_to: string | null }>(() => supabase
          .from('lead_assignments')
          .select('assigned_to')
          .in('assigned_to', ids)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .order('assigned_to')
          .order('practice_id'))
      )

      for (const row of batches.flat()) {
        const id = row.assigned_to
        if (!id) continue
        const member = memberById.get(id)
        if (!member) continue
        const existing = map.get(id)
        if (existing) existing.count++
        else map.set(id, { id, ...member, count: 1 })
      }
    } else {
      const rows = await allRows<{
        assigned_to: string | null
        users: { full_name: string | null; roles: { key: string | null } | { key: string | null }[] | null } | { full_name: string | null; roles: { key: string | null } | { key: string | null }[] | null }[] | null
      }>(() => supabase
        .from('lead_assignments')
        .select('assigned_to, users!lead_assignments_assigned_to_fkey(full_name, roles(key, label))')
        .eq('assigned_by', me.id)
        .eq('status', 'active')
        .order('assigned_to')
        .order('practice_id'))

      for (const row of rows) {
        const id = row.assigned_to
        if (!id) continue
        const existing = map.get(id)
        if (existing) existing.count++
        else map.set(id, {
          id,
          full_name: oneRelation(row.users)?.full_name ?? 'Unknown',
          role: roleLabel(oneRelation(oneRelation(row.users)?.roles)?.key),
          count: 1,
        })
      }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not load assignments.' }
  }
  return { ok: true, people: Array.from(map.values()).sort((a, b) => a.full_name.localeCompare(b.full_name)) }
}

// The active leads assigned to one person in the caller's scope.
export async function getAssignedLeads(agentId: string): Promise<{
  ok: boolean
  message?: string
  leads?: { practiceId: string; practiceCode: string; name: string; state: string | null; specialty: string | null; assignedAt: string; canRemove: boolean }[]
}> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }

  const companyAdmin = me.roleKey === 'company_admin'
  const tenantId = me.tenantId
  if (companyAdmin) {
    if (!tenantId) return { ok: false, message: 'Your account is not assigned to a company.' }
    const { data: member, error: memberError } = await supabase
      .from('users')
      .select('id')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (memberError) return { ok: false, message: memberError.message }
    if (!member) return { ok: false, message: 'That person is not on your team.' }
  }

  type AssignedLeadRow = {
    practice_id: string
    assigned_by: string | null
    assigned_at: string
    master_practices: {
      practice_code: string | null
      name: string | null
      state: string | null
      specialty: string | null
    } | {
      practice_code: string | null
      name: string | null
      state: string | null
      specialty: string | null
    }[] | null
  }
  let rows: AssignedLeadRow[]
  try {
    rows = companyAdmin
      ? await allRows<AssignedLeadRow>(() => supabase
        .from('lead_assignments')
        .select('practice_id, assigned_by, assigned_at, master_practices(practice_code, name, state, specialty)')
        .eq('assigned_to', agentId)
        .eq('status', 'active')
        .eq('tenant_id', tenantId!)
        .order('assigned_at', { ascending: false })
        .order('practice_id'))
      : await allRows<AssignedLeadRow>(() => supabase
        .from('lead_assignments')
        .select('practice_id, assigned_by, assigned_at, master_practices(practice_code, name, state, specialty)')
        .eq('assigned_to', agentId)
        .eq('status', 'active')
        .eq('assigned_by', me.id)
        .order('assigned_at', { ascending: false })
        .order('practice_id'))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not load assigned leads.' }
  }

  const leads = rows.flatMap((row) => {
    const practice = oneRelation(row.master_practices)
    if (!practice?.practice_code) return []
    return [{
      practiceId: row.practice_id,
      practiceCode: practice.practice_code,
      name: practice.name ?? '',
      state: practice.state,
      specialty: practice.specialty,
      assignedAt: row.assigned_at,
      canRemove: row.assigned_by === me.id,
    }]
  }).sort((a, b) => a.name.localeCompare(b.name) || a.practiceCode.localeCompare(b.practiceCode) || a.practiceId.localeCompare(b.practiceId))

  return { ok: true, leads }
}

// Remove an assignment I made → the lead returns to the unassigned pool.
export async function unassignLead(practiceId: string, agentId: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createSupabaseServer()
  const me = await whoAmI()
  if (!me) return { ok: false, message: 'Not signed in.' }
  if (!CAN_MANAGE.includes(me.roleKey)) return { ok: false, message: 'Not allowed.' }
  if (!me.tenantId) return { ok: false, message: 'Your account is not assigned to a company.' }

  const { data: prac, error: practiceError } = await supabase
    .from('master_practices')
    .select('id, owner_tenant_id')
    .eq('id', practiceId)
    .maybeSingle()

  if (practiceError) return { ok: false, message: `Could not load lead: ${practiceError.message}` }
  if (!prac) return { ok: false, message: 'Lead not found in your company.' }

  if (prac.owner_tenant_id !== me.tenantId) {
    const { data: allocation, error: allocationError } = await supabase
      .from('lead_allocations')
      .select('practice_id')
      .eq('practice_id', prac.id)
      .eq('tenant_id', me.tenantId)
      .eq('status', 'active')
      .maybeSingle()
    if (allocationError) return { ok: false, message: `Could not verify lead access: ${allocationError.message}` }
    if (!allocation) return { ok: false, message: 'Lead not found in your company.' }
  }

  // delete only the assignment I made to this person
  const { error } = await supabase
    .from('lead_assignments')
    .delete()
    .eq('practice_id', prac.id)
    .eq('assigned_to', agentId)
    .eq('assigned_by', me.id)
    .eq('status', 'active')

  if (error) return { ok: false, message: `Remove failed: ${error.message}` }
  return { ok: true, message: 'Lead un-assigned and returned to the pool.' }
}
