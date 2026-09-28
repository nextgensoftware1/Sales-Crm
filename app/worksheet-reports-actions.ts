'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

export type WorksheetReportRow = {
  practiceId: string; tenantId: string; practiceCode: string; practiceName: string; orgName: string | null
  state: string | null; specialty: string | null; companyName: string | null
  filledBy: string | null; assignedCloser: string | null; callDetails: string | null
  additionalPhone: string | null; email: string | null; concernedPerson: string | null
  directLine: string | null; callbackAt: string | null; timezone: string | null
  disposition: string | null; lastUpdatedBy: string | null; lastUpdatedAt: string | null
  handoffStatus: string | null
  importData: Record<string, string> | null
}

export type WorksheetReportsResult =
  | { ok: true; scope: 'all' | 'company' | 'personal'; companyName: string | null; rows: WorksheetReportRow[]; truncated: boolean }
  | { ok: false; message: string }

const REPORT_LIMIT = 300

type RawWorksheet = {
  practice_id: string
  tenant_id: string
  call_details: string | null
  additional_phone: string | null
  email: string | null
  concerned_person: string | null
  direct_line: string | null
  callback_at: string | null
  timezone: string | null
  disposition: string | null
  updated_at: string | null
  import_data: Record<string, unknown> | null
  tenants: { name: string | null } | null
  users: { full_name: string | null; tenants: { name: string | null } | null } | null
  master_practices: {
    practice_code: string
    name: string
    state: string | null
    specialty: string | null
    practice_providers: Array<{ providers: { org_name: string | null } | null }>
  }
}

type RawTransfer = {
  practice_id: string
  tenant_id: string
  note: string | null
  users: { full_name: string | null } | null
}

export async function getWorksheetReports(): Promise<WorksheetReportsResult> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const roleKey = me.roles?.key ?? ''
  if (!['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
    return { ok: false, message: 'You do not have permission to view worksheet reports.' }
  }
  const isSuperAdmin = roleKey === 'super_admin'
  const isPersonal = roleKey === 'agent' || roleKey === 'closer'
  if (!isSuperAdmin && !me.tenant_id) return { ok: false, message: 'Your account is not assigned to a company.' }

  let query = supabase.from('lead_worksheets').select(`
    practice_id, tenant_id, call_details, additional_phone, email,
    concerned_person, direct_line, callback_at, timezone, disposition,
    updated_by, updated_at, import_data,
    tenants!lead_worksheets_tenant_id_fkey(name),
    users!lead_worksheets_updated_by_fkey(full_name, tenants(name)),
    master_practices!inner(
      practice_code, name, state, specialty, deleted_at,
      practice_providers(providers(org_name))
    )
  `).is('master_practices.deleted_at', null)
    .order('updated_at', { ascending: false }).limit(REPORT_LIMIT + 1)
  if (isPersonal) query = query.eq('updated_by', me.id)
  else if (!isSuperAdmin) query = query.eq('tenant_id', me.tenant_id!)

  const { data, error } = await query
  if (error) return { ok: false, message: error.message }
  const all = (data ?? []) as unknown as RawWorksheet[]
  const truncated = all.length > REPORT_LIMIT
  const page = truncated ? all.slice(0, REPORT_LIMIT) : all

  const practiceIds = [...new Set(page.map(row => row.practice_id))]
  let transferQuery = supabase.from('lead_transfers')
    .select('practice_id, tenant_id, to_user_id, note, users!lead_transfers_to_user_id_fkey(full_name)')
  if (practiceIds.length) transferQuery = transferQuery.in('practice_id', practiceIds)
  if (!isSuperAdmin) transferQuery = transferQuery.eq('tenant_id', me.tenant_id!)
  const { data: transfers } = practiceIds.length ? await transferQuery : { data: [] }
  const transferByKey = new Map<string, RawTransfer>()
  for (const transfer of (transfers ?? []) as unknown as RawTransfer[]) {
    transferByKey.set(`${transfer.practice_id}:${transfer.tenant_id}`, transfer)
  }

  const rows: WorksheetReportRow[] = page.map((worksheet) => {
    const practice = worksheet.master_practices
    const transfer = transferByKey.get(`${worksheet.practice_id}:${worksheet.tenant_id}`)
    const editor = worksheet.users
    return {
      practiceId: worksheet.practice_id,
      tenantId: worksheet.tenant_id,
      practiceCode: practice.practice_code,
      practiceName: practice.name,
      orgName: practice.practice_providers?.[0]?.providers?.org_name ?? null,
      state: practice.state,
      specialty: practice.specialty,
      companyName: worksheet.tenants?.name ?? editor?.tenants?.name ?? (isSuperAdmin ? 'Unknown company' : me.tenants?.name ?? null),
      filledBy: editor?.full_name ?? null,
      assignedCloser: transfer?.users?.full_name ?? null,
      callDetails: worksheet.call_details,
      additionalPhone: worksheet.additional_phone,
      email: worksheet.email,
      concernedPerson: worksheet.concerned_person,
      directLine: worksheet.direct_line,
      callbackAt: worksheet.callback_at,
      timezone: worksheet.timezone,
      disposition: worksheet.disposition,
      lastUpdatedBy: editor?.full_name ?? null,
      lastUpdatedAt: worksheet.updated_at,
      handoffStatus: transfer?.note ?? null,
      importData: worksheet.import_data && typeof worksheet.import_data === 'object'
        ? Object.fromEntries(Object.entries(worksheet.import_data).map(([key, value]) => [key, String(value ?? '')]))
        : null,
    }
  })

  return { ok: true, scope: isSuperAdmin ? 'all' : isPersonal ? 'personal' : 'company',
    companyName: isSuperAdmin ? null : me.tenants?.name ?? null, rows, truncated }
}

export type WorksheetReportDetailResult =
  | { ok: true; row: WorksheetReportRow }
  | { ok: false; message: string }

export async function getWorksheetReportDetail(tenantId: string, practiceId: string): Promise<WorksheetReportDetailResult> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const roleKey = me.roles?.key ?? ''
  if (!['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
    return { ok: false, message: 'You do not have permission to view this worksheet.' }
  }
  if (roleKey !== 'super_admin' && me.tenant_id !== tenantId) {
    return { ok: false, message: 'This worksheet belongs to another company.' }
  }

  let query = supabase.from('lead_worksheets').select(`
    practice_id, tenant_id, call_details, additional_phone, email,
    concerned_person, direct_line, callback_at, timezone, disposition,
    updated_by, updated_at, import_data,
    tenants!lead_worksheets_tenant_id_fkey(name),
    users!lead_worksheets_updated_by_fkey(full_name, tenants(name)),
    master_practices!inner(
      practice_code, name, state, specialty, deleted_at,
      practice_providers(providers(org_name))
    )
  `).eq('tenant_id', tenantId).eq('practice_id', practiceId).is('master_practices.deleted_at', null)
  if (roleKey === 'agent' || roleKey === 'closer') query = query.eq('updated_by', me.id)

  const { data: worksheet, error } = await query.maybeSingle()
  if (error) return { ok: false, message: error.message }
  if (!worksheet) return { ok: false, message: 'Worksheet not found or unavailable.' }

  const item = worksheet as unknown as RawWorksheet
  if (!item.import_data || typeof item.import_data !== 'object') {
    return { ok: false, message: 'This is not an uploaded worksheet.' }
  }
  const practice = item.master_practices
  return { ok: true, row: {
    practiceId: item.practice_id,
    tenantId: item.tenant_id,
    practiceCode: practice.practice_code,
    practiceName: practice.name,
    orgName: practice.practice_providers?.[0]?.providers?.org_name ?? null,
    state: practice.state,
    specialty: practice.specialty,
    companyName: item.tenants?.name ?? item.users?.tenants?.name ?? me.tenants?.name ?? null,
    filledBy: item.users?.full_name ?? null,
    assignedCloser: null,
    callDetails: item.call_details,
    additionalPhone: item.additional_phone,
    email: item.email,
    concernedPerson: item.concerned_person,
    directLine: item.direct_line,
    callbackAt: item.callback_at,
    timezone: item.timezone,
    disposition: item.disposition,
    lastUpdatedBy: item.users?.full_name ?? null,
    lastUpdatedAt: item.updated_at,
    handoffStatus: null,
    importData: Object.fromEntries(Object.entries(item.import_data).map(([key, value]) => [key, String(value ?? '')])),
  } }
}
