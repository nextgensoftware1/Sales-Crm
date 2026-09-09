'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// ---------------------------------------------------------------------------
// assignLeadsToAgent(practiceCodes, agentUserId)
//
// Who may assign: company_admin, manager, team_lead.
// Guardrails:
//   • The chosen agent must be a DIRECT report of the caller (one level down
//     in user_hierarchy: caller = manages_user_id, agent = user_id).
//   • Every practice must be OWNED by the caller's company.
// Writes/updates rows in lead_assignments (practice ↔ person pointer).
// ---------------------------------------------------------------------------

export async function assignLeadsToAgent(
  practiceCodes: string[],
  agentUserId: string
): Promise<{ ok: boolean; message: string; assigned?: number }> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  const myId = (me as any)?.id
  const myTenantId = (me as any)?.tenant_id

  if (!['company_admin', 'manager', 'team_lead'].includes(roleKey)) {
    return { ok: false, message: 'You are not allowed to assign leads.' }
  }
  if (!agentUserId) return { ok: false, message: 'Pick an agent.' }
  if (!practiceCodes || practiceCodes.length === 0) {
    return { ok: false, message: 'Select at least one lead.' }
  }

  // 1) Verify the agent is a DIRECT report of the caller.
  const { data: edge } = await supabase
    .from('user_hierarchy')
    .select('id')
    .eq('manages_user_id', myId)
    .eq('user_id', agentUserId)
    .maybeSingle()

  if (!edge) {
    return { ok: false, message: 'That agent does not report directly to you.' }
  }

  // 2) Resolve practice_codes → practice ids. A company may assign leads it
  //    OWNS (its own uploads) OR that are ALLOCATED to it by Super Admin.
  const { data: practices } = await supabase
    .from('master_practices')
    .select('id, practice_code, owner_tenant_id')
    .in('practice_code', practiceCodes)

  // Which of these are allocated to my tenant?
  const allPracticeIds = (practices ?? []).map((p: any) => p.id)
  let allocatedIds = new Set<string>()
  if (allPracticeIds.length) {
    const { data: allocs } = await supabase
      .from('lead_allocations')
      .select('practice_id')
      .eq('tenant_id', myTenantId)
      .eq('status', 'active')
      .in('practice_id', allPracticeIds)
    allocatedIds = new Set((allocs ?? []).map((a: any) => a.practice_id))
  }

  // Keep practices my company owns OR is allocated.
  const ids = (practices ?? [])
    .filter((p: any) => p.owner_tenant_id === myTenantId || allocatedIds.has(p.id))
    .map((p: any) => p.id)

  if (ids.length === 0) {
    return { ok: false, message: 'None of those leads belong to your company.' }
  }

  // Look up any EXISTING origin for these practices so we carry it forward
  // (a lead that came from the admin keeps admin as its origin as it moves down).
  const { data: existingRows } = await supabase
    .from('lead_assignments')
    .select('practice_id, origin_user_id')
    .in('practice_id', ids)
  const originByPractice = new Map<string, string | null>()
  for (const r of (existingRows ?? []) as any[]) {
    originByPractice.set(r.practice_id, r.origin_user_id ?? null)
  }

  // 3) Upsert assignments. If a practice is already assigned to someone,
  //    re-point it to this agent (assigned_to) and keep it active.
  const now = new Date().toISOString()
  const rows = ids.map((pid: string) => ({
    practice_id: pid,
    assigned_to: agentUserId,
    assigned_by: myId,
    // origin = whoever FIRST pushed it in; keep it if present, else it's me.
    origin_user_id: originByPractice.get(pid) ?? myId,
    tenant_id: myTenantId,
    assigned_at: now,
    status: 'active',
  }))

  // onConflict matches the UNIQUE (practice_id, assigned_to) constraint:
  // re-assigning the same lead to the same person updates instead of duplicating.
  const { error } = await supabase
    .from('lead_assignments')
    .upsert(rows, { onConflict: 'practice_id,assigned_to' })

  if (error) {
    return { ok: false, message: `Assign failed: ${error.message}` }
  }

  return { ok: true, message: `Assigned ${ids.length} lead(s).`, assigned: ids.length }
}