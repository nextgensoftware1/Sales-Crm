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
  filledBy: string | null
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
  | { ok: true; scope: 'all' | 'company' | 'personal'; companyName: string | null; rows: WorksheetReportRow[]; truncated: boolean }
  | { ok: false; message: string }

// Cap the report at a fixed size rather than loading every worksheet ever
// saved — the UI paginates client-side over this batch (same pattern as
// the leads table), and `truncated` tells the page whether there's more
// than this beyond what's shown.
const REPORT_LIMIT = 300

type CompanyUserRow = { id: string }
type TransferRow = { practice_id: string; to_user_id: string | null; from_user_id: string | null; note: string | null }
type ReportUserRow = {
  id: string
  full_name: string
  tenant_id: string | null
  tenants: { name: string } | null
}
type PracticeRow = {
  id: string
  practice_code: string
  name: string
  state: string | null
  specialty: string | null
  ws_call_details: string | null
  ws_additional_phone: string | null
  ws_email: string | null
  ws_concerned_person: string | null
  ws_direct_line: string | null
  ws_callback_at: string | null
  ws_timezone: string | null
  ws_disposition: string | null
  ws_updated_at: string | null
  ws_updated_by: string | null
  practice_providers: Array<{ providers: { org_name: string | null } | null }> | null
}

export async function getWorksheetReports(): Promise<WorksheetReportsResult> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const roleKey = me.roles?.key ?? ''

  // Managers see their company. Agents and closers see only worksheets they
  // personally saved. This is enforced in the action as well as the page UI.
  const allowed = ['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)
  if (!allowed) return { ok: false, message: 'You do not have permission to view worksheet reports.' }

  const isSuperAdmin = roleKey === 'super_admin'
  const isPersonal = roleKey === 'agent' || roleKey === 'closer'
  const myTenantId = me.tenant_id
  const myCompanyName = me.tenants?.name ?? null

  // Company visibility follows the company of the person who saved the
  // worksheet. This correctly includes leads allocated by Super Admin whose
  // owner_tenant_id may still belong to the platform.
  let companyUserIds: string[] = []
  if (!isSuperAdmin && !isPersonal) {
    if (!myTenantId) return { ok: false, message: 'Your account is not assigned to a company.' }
    const { data: companyUsers, error: companyUsersError } = await supabase
      .from('users').select('id').eq('tenant_id', myTenantId)
    if (companyUsersError) return { ok: false, message: companyUsersError.message }
    companyUserIds = ((companyUsers ?? []) as CompanyUserRow[]).map((row) => row.id).filter(Boolean)
    if (companyUserIds.length === 0) {
      return { ok: true, scope: 'company', companyName: myCompanyName, rows: [], truncated: false }
    }
  }

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

  if (isPersonal) practicesQ = practicesQ.eq('ws_updated_by', me.id)
  else if (!isSuperAdmin) practicesQ = practicesQ.in('ws_updated_by', companyUserIds)

  const { data: practices, error: practicesErr } = await practicesQ
  if (practicesErr) return { ok: false, message: practicesErr.message }
  if (!practices || practices.length === 0) {
    return { ok: true, scope: isSuperAdmin ? 'all' : isPersonal ? 'personal' : 'company', companyName: isSuperAdmin ? null : myCompanyName, rows: [], truncated: false }
  }

  const truncated = practices.length > REPORT_LIMIT
  const page = (truncated ? practices.slice(0, REPORT_LIMIT) : practices) as unknown as PracticeRow[]
  const practiceIds = page.map((p) => p.id)

  const { data: transfers } = await supabase.from('lead_transfers')
    .select('practice_id, to_user_id, from_user_id, note').in('practice_id', practiceIds)

  const transferByPractice: Record<string, { toUserId: string | null; fromUserId: string | null; note: string | null }> = {}
  for (const t of (transfers ?? []) as TransferRow[]) transferByPractice[t.practice_id] = { toUserId: t.to_user_id, fromUserId: t.from_user_id, note: t.note }

  const userIds = new Set<string>()
  for (const p of page) if (p.ws_updated_by) userIds.add(p.ws_updated_by)
  for (const t of Object.values(transferByPractice)) { if (t.toUserId) userIds.add(t.toUserId) }

  const { data: userRows } = userIds.size
    ? await supabase.from('users').select('id, full_name, tenant_id, tenants(name)').in('id', Array.from(userIds))
    : { data: [] as ReportUserRow[] }
  const nameById: Record<string, string> = {}
  const companyByUserId: Record<string, string> = {}
  for (const u of (userRows ?? []) as unknown as ReportUserRow[]) {
    nameById[u.id] = u.full_name
    companyByUserId[u.id] = u.tenants?.name ?? 'Unknown company'
  }

  const rows: WorksheetReportRow[] = page.map((p) => {
    const transfer = transferByPractice[p.id]
    const orgName = p.practice_providers?.[0]?.providers?.org_name ?? null
    return {
      practiceId: p.id,
      practiceCode: p.practice_code,
      practiceName: p.name,
      orgName,
      state: p.state,
      specialty: p.specialty,
      companyName: isSuperAdmin
        ? (p.ws_updated_by ? companyByUserId[p.ws_updated_by] ?? 'Unknown company' : 'Unknown company')
        : myCompanyName,
      filledBy: p.ws_updated_by ? (nameById[p.ws_updated_by] ?? null) : null,
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

  return {
    ok: true,
    scope: isSuperAdmin ? 'all' : isPersonal ? 'personal' : 'company',
    companyName: isSuperAdmin ? null : myCompanyName,
    rows,
    truncated,
  }
}
