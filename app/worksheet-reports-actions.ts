'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

export type WorksheetReportRow = {
  practiceId: string
  practiceCode: string
  practiceName: string
  orgName: string | null
  state: string | null
  specialty: string | null
  companyName: string | null
  assignedAgent: string | null
  assignedCloser: string | null
  callDetails: string | null
  additionalPhone: string | null
  email: string | null
  concernedPerson: string | null
  directLine: string | null
  callbackAt: string | null
  timezone: string | null
  disposition: string | null
  lastUpdatedBy: string | null
  lastUpdatedAt: string | null
  handoffStatus: string | null
}

export type WorksheetReportsResult =
  | { ok: true; scope: 'all' | 'company'; companyName: string | null; rows: WorksheetReportRow[]; truncated: boolean }
  | { ok: false; message: string }

// Cap the report at a fixed size rather than loading every worksheet ever
// saved — the UI paginates client-side over this batch (same pattern as
// the leads table), and `truncated` tells the page whether there's more
// than this beyond what's shown.
const REPORT_LIMIT = 300

export async function getWorksheetReports(): Promise<WorksheetReportsResult> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const roleKey = (me as any).roles?.key ?? ''

  // Enforced here, not just by the Admin page not rendering this tab for
  // them — agents and closers must not be able to reach worksheet reports
  // even by calling this action directly.
  const allowed = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  if (!allowed) return { ok: false, message: 'You do not have permission to view worksheet reports.' }

  const isSuperAdmin = roleKey === 'super_admin'
  const myTenantId = (me as any).tenant_id as string | null
  const myCompanyName = (me as any).tenants?.name ?? null

  // Only leads with an actual saved worksheet, excluding soft-deleted
  // leads (handles "deleted or missing practices safely" — a deleted
  // lead's stale worksheet shouldn't show up in a live report), latest
  // updated first.
  let practicesQ = supabase
    .from('master_practices')
    .select(`
      id, practice_code, name, state, specialty, owner_tenant_id,
      ws_call_details, ws_additional_phone, ws_email, ws_concerned_person,
      ws_direct_line, ws_callback_at, ws_timezone, ws_disposition,
      ws_updated_at, ws_updated_by,
      practice_providers ( providers ( org_name ) )
    `)
    .not('ws_updated_at', 'is', null)
    .is('deleted_at', null)
    .order('ws_updated_at', { ascending: false })
    .limit(REPORT_LIMIT + 1)

  if (!isSuperAdmin) practicesQ = practicesQ.eq('owner_tenant_id', myTenantId)

  const { data: practices, error: practicesErr } = await practicesQ
  if (practicesErr) return { ok: false, message: practicesErr.message }
  if (!practices || practices.length === 0) {
    return { ok: true, scope: isSuperAdmin ? 'all' : 'company', companyName: isSuperAdmin ? null : myCompanyName, rows: [], truncated: false }
  }

  const truncated = practices.length > REPORT_LIMIT
  const page = truncated ? practices.slice(0, REPORT_LIMIT) : practices
  const practiceIds = page.map((p: any) => p.id)

  // These three are all independent of each other — only dependent on the
  // practice ids above — so they run together instead of one after another.
  const [{ data: assignments }, { data: transfers }, tenantsRes] = await Promise.all([
    supabase.from('lead_assignments').select('practice_id, assigned_to, current_status').in('practice_id', practiceIds),
    supabase.from('lead_transfers').select('practice_id, to_user_id, from_user_id, note').in('practice_id', practiceIds),
    isSuperAdmin
      ? supabase.from('tenants').select('id, name')
      : Promise.resolve({ data: [] as any[] }),
  ])

  const transferByPractice: Record<string, { toUserId: string | null; fromUserId: string | null; note: string | null }> = {}
  for (const t of (transfers ?? []) as any[]) transferByPractice[t.practice_id] = { toUserId: t.to_user_id, fromUserId: t.from_user_id, note: t.note }

  const agentAssignmentByPractice: Record<string, string> = {}
  for (const a of (assignments ?? []) as any[]) {
    // A transferred lead can have more than one lead_assignments row (the
    // original agent's, plus one for the closer). The one that isn't the
    // transfer's recipient is the original agent's.
    const t = transferByPractice[a.practice_id]
    if (!t || a.assigned_to !== t.toUserId) agentAssignmentByPractice[a.practice_id] = a.assigned_to
  }

  const tenantNameById: Record<string, string> = {}
  for (const t of (tenantsRes.data ?? []) as any[]) tenantNameById[t.id] = t.name

  const userIds = new Set<string>()
  for (const p of page as any[]) if (p.ws_updated_by) userIds.add(p.ws_updated_by)
  for (const id of Object.values(agentAssignmentByPractice)) userIds.add(id)
  for (const t of Object.values(transferByPractice)) { if (t.toUserId) userIds.add(t.toUserId) }

  const { data: userRows } = userIds.size
    ? await supabase.from('users').select('id, full_name').in('id', Array.from(userIds))
    : { data: [] as any[] }
  const nameById: Record<string, string> = {}
  for (const u of (userRows ?? []) as any[]) nameById[u.id] = u.full_name

  const rows: WorksheetReportRow[] = page.map((p: any) => {
    const transfer = transferByPractice[p.id]
    const orgName = p.practice_providers?.[0]?.providers?.org_name ?? null
    return {
      practiceId: p.id,
      practiceCode: p.practice_code,
      practiceName: p.name,
      orgName,
      state: p.state,
      specialty: p.specialty,
      companyName: isSuperAdmin ? (tenantNameById[p.owner_tenant_id] ?? null) : myCompanyName,
      assignedAgent: agentAssignmentByPractice[p.id] ? (nameById[agentAssignmentByPractice[p.id]] ?? null) : null,
      assignedCloser: transfer?.toUserId ? (nameById[transfer.toUserId] ?? null) : null,
      callDetails: p.ws_call_details,
      additionalPhone: p.ws_additional_phone,
      email: p.ws_email,
      concernedPerson: p.ws_concerned_person,
      directLine: p.ws_direct_line,
      callbackAt: p.ws_callback_at,
      timezone: p.ws_timezone,
      disposition: p.ws_disposition,
      lastUpdatedBy: p.ws_updated_by ? (nameById[p.ws_updated_by] ?? null) : null,
      lastUpdatedAt: p.ws_updated_at,
      handoffStatus: transfer?.note ?? null,
    }
  })

  return { ok: true, scope: isSuperAdmin ? 'all' : 'company', companyName: isSuperAdmin ? null : myCompanyName, rows, truncated }
}
