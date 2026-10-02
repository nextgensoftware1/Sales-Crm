'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

const ASSIGNMENT_ROLES = ['company_admin', 'manager', 'team_lead']
const REPORT_ROLES = ['super_admin', ...ASSIGNMENT_ROLES, 'agent', 'closer']

type TeamMember = { id: string; full_name: string; roles: { key: string; level: number } | null }

type AssignmentOptions = {
  id: string
  fullName: string
  role: string
}

export type WorksheetAssignmentOptions = {
  canAssign: boolean
  agents: AssignmentOptions[]
  assignedTo: string | null
  assignedToName: string | null
}

async function getRequester() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false as const, message: 'Not signed in.' }
  const { data: profile } = await getCurrentProfile(user.id)
  if (!profile) return { ok: false as const, message: 'User not found.' }
  return { ok: true as const, profile, roleKey: profile.roles?.key ?? '' }
}

async function canManageTenant(tenantId: string) {
  const requester = await getRequester()
  if (!requester.ok) return requester
  const { profile, roleKey } = requester
  if (roleKey === 'super_admin') return { ok: true as const, profile, roleKey }
  if (!ASSIGNMENT_ROLES.includes(roleKey)) return { ok: false as const, message: 'You are not allowed to reassign leads.' }
  if (!profile.tenant_id || profile.tenant_id !== tenantId) {
    return { ok: false as const, message: 'This worksheet belongs to another company.' }
  }
  return { ok: true as const, profile, roleKey }
}

async function checkWorksheetScope(practiceCode: string, tenantId: string, practiceId: string) {
  const supabase = await createSupabaseServer()
  const [worksheetResult, practiceResult, allocationResult, claimResult] = await Promise.all([
    supabase.from('lead_worksheets').select('practice_id')
      .eq('practice_id', practiceId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('master_practices').select('practice_code, owner_tenant_id')
      .eq('id', practiceId).is('deleted_at', null).maybeSingle(),
    supabase.from('lead_allocations').select('practice_id')
      .eq('practice_id', practiceId).eq('tenant_id', tenantId).eq('status', 'active').maybeSingle(),
    supabase.from('lead_company_claims').select('tenant_id')
      .eq('practice_id', practiceId).eq('status', 'active').maybeSingle(),
  ])
  if (worksheetResult.error || practiceResult.error || allocationResult.error || claimResult.error) {
    return { ok: false as const, message: 'Could not verify this worksheet. Please try again.' }
  }
  const { data: worksheet } = worksheetResult
  const { data: practice } = practiceResult
  const { data: allocation } = allocationResult
  const { data: claim } = claimResult
  if (!worksheet || !practice || practice.practice_code !== practiceCode) {
    return { ok: false as const, message: 'This worksheet is unavailable.' }
  }
  if (practice.owner_tenant_id !== tenantId && !allocation) {
    return { ok: false as const, message: 'This lead is not owned or allocated to this company.' }
  }
  if (claim && claim.tenant_id !== tenantId) {
    return { ok: false as const, message: 'This lead is claimed by another company.' }
  }
  return { ok: true as const }
}

export async function getWorksheetAssignmentOptions(
  practiceCode: string,
  tenantId: string,
  practiceId: string,
): Promise<{ ok: true; data: WorksheetAssignmentOptions } | { ok: false; message: string }> {
  if (!practiceCode || !tenantId || !practiceId) return { ok: false, message: 'Worksheet details are missing.' }
  const requester = await canManageTenant(tenantId)
  if (!requester.ok) {
    if (requester.message === 'You are not allowed to reassign leads.') {
      return { ok: true, data: { canAssign: false, agents: [], assignedTo: null, assignedToName: null } }
    }
    return requester
  }
  const { profile, roleKey } = requester
  if (!REPORT_ROLES.includes(roleKey)) return { ok: false, message: 'You do not have permission to view worksheet reports.' }

  const supabase = await createSupabaseServer()
  const scope = await checkWorksheetScope(practiceCode, tenantId, practiceId)
  if (!scope.ok) return scope

  const [{ data: people, error: peopleError }, { data: assignments, error: assignmentError }] = await Promise.all([
    supabase.from('users').select('id, full_name, roles(key, level)')
      .eq('tenant_id', tenantId).eq('status', 'active').order('full_name'),
    supabase.from('lead_assignments')
      .select('assigned_to, assigned_at, users!lead_assignments_assigned_to_fkey(full_name)')
      .eq('practice_id', practiceId).eq('tenant_id', tenantId).eq('status', 'active')
      .order('assigned_at', { ascending: false }).limit(1),
  ])
  if (peopleError || assignmentError) return { ok: false, message: 'Could not load assignment options.' }

  const team = (people ?? []) as unknown as TeamMember[]
  const myLevel = profile.roles?.level ?? 999
  const agents = team.filter(person => {
    const targetRole = person.roles?.key ?? ''
    if (roleKey === 'super_admin') return targetRole === 'agent' || targetRole === 'closer'
    return (person.roles?.level ?? 0) > myLevel
  }).map(person => ({
    id: person.id,
    fullName: person.full_name,
    role: person.roles?.key ?? 'Unknown',
  }))
  const currentAssignment = assignments?.[0] as unknown as {
    assigned_to: string
    users: { full_name: string | null } | null
  } | undefined

  return {
    ok: true,
    data: {
      canAssign: ASSIGNMENT_ROLES.includes(roleKey) || roleKey === 'super_admin',
      agents,
      assignedTo: currentAssignment?.assigned_to ?? null,
      assignedToName: currentAssignment?.users?.full_name ?? null,
    },
  }
}

export async function reassignWorksheetLead(
  practiceCode: string,
  tenantId: string,
  practiceId: string,
  targetUserId: string,
): Promise<{ ok: boolean; message: string }> {
  if (!practiceCode || !tenantId || !practiceId || !targetUserId) {
    return { ok: false, message: 'Choose an agent to assign this lead to.' }
  }
  const requester = await canManageTenant(tenantId)
  if (!requester.ok) return requester
  const { profile, roleKey } = requester
  const supabase = await createSupabaseServer()

  const scope = await checkWorksheetScope(practiceCode, tenantId, practiceId)
  if (!scope.ok) return scope

  const { data: target } = await supabase.from('users').select('id, tenant_id, status, roles(key, level)')
    .eq('id', targetUserId).maybeSingle()
  if (!target) {
    return { ok: false, message: 'Choose an active team member from this company.' }
  }
  const targetUser = target as unknown as {
    id: string
    tenant_id: string | null
    status: string
    full_name: string
    roles: { key: string; level: number } | null
  }
  if (targetUser.tenant_id !== tenantId || targetUser.status !== 'active') {
    return { ok: false, message: 'Choose an active team member from this company.' }
  }
  const targetRole = targetUser.roles?.key ?? ''
  if (roleKey === 'super_admin') {
    if (targetRole !== 'agent' && targetRole !== 'closer') {
      return { ok: false, message: 'Super Admin can assign worksheets to an Agent or Closer.' }
    }
  } else if ((targetUser.roles?.level ?? 0) <= (profile.roles?.level ?? 999)) {
    return { ok: false, message: 'You can only assign leads to a more junior team member.' }
  }

  const { error } = await supabase.rpc('reassign_worksheet_lead', {
    p_practice_id: practiceId,
    p_tenant_id: tenantId,
    p_agent_user_id: targetUserId,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, message: `Lead assigned to ${targetUser.full_name}.` }
}
