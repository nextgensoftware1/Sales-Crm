'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { chunks, mapConcurrent } from '../lib/query-utils'

// ---------------------------------------------------------------------------
// assignLeadsToAgent(practiceCodes, agentUserId)
//
// Who may assign: company_admin, manager, team_lead.
// Guardrails:
//   • The target must be a more junior role than the caller, in the SAME
//     company — checked by role level, company-wide. Not limited to a
//     literal direct report: Company Admin can hand a lead straight to any
//     Manager, Team Lead, Agent, or Closer in the company; Manager to Team
//     Lead, Agent, or Closer; Team Lead to Agent or Closer.
//   • Every practice must be OWNED by the caller's company.
// Writes/updates rows in lead_assignments (practice ↔ person pointer).
// ---------------------------------------------------------------------------

export async function assignLeadsToAgent(
  practiceCodes: string[],
  agentUserId: string
): Promise<{ ok: boolean; message: string; assigned?: number }> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = (me as any)?.roles?.key ?? ''
  const myLevel = (me as any)?.roles?.level ?? 999
  const myId = (me as any)?.id
  const myTenantId = (me as any)?.tenant_id

  if (!['company_admin', 'manager', 'team_lead'].includes(roleKey)) {
    return { ok: false, message: 'You are not allowed to assign leads.' }
  }
  if (!agentUserId) return { ok: false, message: 'Pick an agent.' }
  if (!practiceCodes || practiceCodes.length === 0) {
    return { ok: false, message: 'Select at least one lead.' }
  }

  // 1) Verify the target is a more junior role than the caller, in the same
  // company — company-wide by role level, not limited to a literal direct
  // report: Company Admin can hand a lead straight to any Manager, Team
  // Lead, Agent, or Closer in the company; Manager can hand to Team Lead,
  // Agent, or Closer; Team Lead to Agent or Closer.
  const { data: target } = await supabase
    .from('users')
    .select('tenant_id, status, roles(level)')
    .eq('id', agentUserId)
    .maybeSingle()

  if (!target || (target as any).tenant_id !== myTenantId) {
    return { ok: false, message: 'That person is not on your team.' }
  }
  if ((target as any).status !== 'active') {
    return { ok: false, message: 'That person has been removed from your team. Choose an active teammate.' }
  }
  if (((target as any).roles?.level ?? 0) <= myLevel) {
    return { ok: false, message: 'You can only assign to a more junior role than your own.' }
  }

  // 2) Resolve practice_codes → practice ids. A company may assign leads it
  //    OWNS (its own uploads) OR that are ALLOCATED to it by Super Admin.
  const practiceBatches = await mapConcurrent(chunks(practiceCodes, 200), 4, (codes) =>
    supabase
      .from('master_practices')
      .select('id, practice_code, owner_tenant_id')
      .in('practice_code', codes)
  )
  const practiceError = practiceBatches.find(({ error }) => error)?.error
  if (practiceError) return { ok: false, message: `Could not load selected leads: ${practiceError.message}` }
  const practices = practiceBatches.flatMap(({ data }) => data ?? [])

  // Which of these are allocated to my tenant?
  const allPracticeIds = practices.map((p: any) => p.id)
  let allocatedIds = new Set<string>()
  if (allPracticeIds.length) {
    const allocationBatches = await mapConcurrent(chunks(allPracticeIds, 200), 4, (ids) =>
      supabase
        .from('lead_allocations')
        .select('practice_id')
        .eq('tenant_id', myTenantId)
        .eq('status', 'active')
        .in('practice_id', ids)
    )
    const allocationError = allocationBatches.find(({ error }) => error)?.error
    if (allocationError) return { ok: false, message: `Could not check lead ownership: ${allocationError.message}` }
    allocatedIds = new Set(allocationBatches.flatMap(({ data }) => (data ?? []).map((a: any) => a.practice_id)))
  }

  // Keep practices my company owns OR is allocated.
  const ids = practices
    .filter((p: any) => p.owner_tenant_id === myTenantId || allocatedIds.has(p.id))
    .map((p: any) => p.id)

  // A company cannot assign a lead after another company has claimed it.
  const claimBatches = await mapConcurrent(chunks(ids, 200), 4, (idsBatch) =>
    supabase.from('lead_company_claims')
      .select('practice_id, tenant_id').in('practice_id', idsBatch).eq('status', 'active')
  )
  const claimError = claimBatches.find(({ error }) => error)?.error
  if (claimError) return { ok: false, message: `Could not check lead claims: ${claimError.message}` }
  const activeClaims = claimBatches.flatMap(({ data }) => data ?? [])
  const blockedIds = new Set(activeClaims
    .filter((claim: any) => claim.tenant_id !== myTenantId)
    .map((claim: any) => claim.practice_id))
  const assignableIds = ids.filter((id: string) => !blockedIds.has(id))

  if (assignableIds.length === 0) {
    return { ok: false, message: 'None of those leads belong to your company.' }
  }

  // Look up any EXISTING origin for these practices so we carry it forward
  // (a lead that came from the admin keeps admin as its origin as it moves down).
  const assignmentLookupBatches = await mapConcurrent(chunks(assignableIds, 200), 4, (idsBatch) =>
    supabase
      .from('lead_assignments')
      .select('practice_id, origin_user_id')
      .in('practice_id', idsBatch)
  )
  const assignmentLookupError = assignmentLookupBatches.find(({ error }) => error)?.error
  if (assignmentLookupError) return { ok: false, message: `Could not load existing assignments: ${assignmentLookupError.message}` }
  const existingRows = assignmentLookupBatches.flatMap(({ data }) => data ?? [])
  const originByPractice = new Map<string, string | null>()
  for (const r of existingRows as any[]) {
    originByPractice.set(r.practice_id, r.origin_user_id ?? null)
  }

  // 3) Upsert assignments. If a practice is already assigned to someone,
  //    re-point it to this agent (assigned_to) and keep it active.
  const now = new Date().toISOString()
  const rows = assignableIds.map((pid: string) => ({
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
  const upsertBatches = await mapConcurrent(chunks(rows, 200), 4, (rowsBatch) =>
    supabase.from('lead_assignments').upsert(rowsBatch, { onConflict: 'practice_id,assigned_to' })
  )
  const upsertError = upsertBatches.find(({ error }) => error)?.error
  if (upsertError) return { ok: false, message: `Assign failed: ${upsertError.message}` }

  const skipped = ids.length - assignableIds.length
  return { ok: true, message: `Assigned ${assignableIds.length} lead(s).${skipped ? ` Skipped ${skipped} claimed by another company.` : ''}`, assigned: assignableIds.length }
}
