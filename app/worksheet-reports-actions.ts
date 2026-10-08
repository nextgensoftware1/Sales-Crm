'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { chunks, mapConcurrent, readAllPages } from '../lib/query-utils'

export type WorksheetReportRow = {
  practiceId: string; tenantId: string; practiceCode: string; practiceName: string; providerName: string | null; orgName: string | null
  state: string | null; specialty: string | null; companyName: string | null
  filledBy: string | null; assignedCloser: string | null; callDetails: string | null
  additionalPhone: string | null; email: string | null; concernedPerson: string | null
  directLine: string | null; callbackAt: string | null; timezone: string | null
  disposition: string | null; lastUpdatedBy: string | null; lastUpdatedAt: string | null
  handoffStatus: string | null
  importData: Record<string, string> | null
  // Same signal/category fields the Leads Engine filters on — joined from
  // provider_signals/provider_mips/providers so this page can offer the
  // same category tabs, signal pills, and Credentialing sub-filters.
  npiFound: boolean
  entityType: string | null; enumerationDate: string | null; nppesLastUpdated: string | null
  ccm: boolean; pcm: boolean; awv: boolean; tcm: boolean; bhi: boolean; rpm: boolean; rcmFit: boolean
  mipsByYear: Record<number, string>
}

export type WorksheetReportsResult =
  | { ok: true; scope: 'all' | 'company' | 'personal'; companyName: string | null; rows: WorksheetReportRow[]; truncated: boolean }
  | { ok: false; message: string }

function getImportedProviderName(importData: Record<string, unknown> | null) {
  if (!importData) return null
  const entry = Object.entries(importData).find(([label]) => {
    const normalized = label.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
    return /^(provider'?s? name|nppes name|practice name|name)$/.test(normalized)
  })
  const name = String(entry?.[1] ?? '').trim()
  return name && !/^Practice\s*\(/i.test(name) ? name : null
}

// Same derivation the Leads Engine uses (app/page.tsx) — kept identical so
// the Credentialing/MIPS/RCM/CCM filters here behave exactly the same way
// they do on the Leads page, from the same underlying provider data.
function deriveSignals(provider: {
  record_source: string | null; entity_type: string | null; enumeration_date: string | null; nppes_last_updated: string | null
  provider_signals: { ccm: boolean | null; pcm: boolean | null; awv: boolean | null; tcm: boolean | null; bhi: boolean | null; rpm: boolean | null; rcm_fit: boolean | null } | null
  provider_mips: Array<{ performance_year: number | null; status: string | null; reporting_option: string | null }> | null
} | null | undefined) {
  const recordSourceLower = (provider?.record_source ?? '').toString().trim().toLowerCase()
  const s = provider?.provider_signals
  const mipsRows = Array.isArray(provider?.provider_mips) ? provider!.provider_mips! : []
  const mipsByYear: Record<number, string> = {}
  for (const m of mipsRows) {
    const raw = (m.reporting_option ?? m.status ?? '').toString().trim()
    let year = m.performance_year
    if (!year) {
      const match = raw.match(/^(\d{4})/)
      if (match) year = parseInt(match[1], 10)
    }
    if (year) mipsByYear[year] = raw.replace(/^\d{4}\s*-\s*/, '') || raw
  }
  return {
    // Only a confirmed NPPES match counts as Credentialing — "Not Found"
    // (and blank) are excluded. Matches the same rule in app/page.tsx.
    npiFound: recordSourceLower.includes('found') && !recordSourceLower.includes('not found'),
    entityType: provider?.entity_type ?? null,
    enumerationDate: provider?.enumeration_date ?? null,
    nppesLastUpdated: provider?.nppes_last_updated ?? null,
    ccm: s?.ccm ?? false, pcm: s?.pcm ?? false, awv: s?.awv ?? false, tcm: s?.tcm ?? false,
    bhi: s?.bhi ?? false, rpm: s?.rpm ?? false, rcmFit: s?.rcm_fit ?? false,
    mipsByYear,
  }
}

// Every worksheet in scope is loaded (no cap). Rows are read in pages of
// 1,000 — Supabase returns at most 1,000 per request — and transfers are
// looked up in batches so the request never gets too long.
const PAGE_SIZE = 1000
const TRANSFER_BATCH = 200

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
    practice_providers: Array<{ providers: {
      name: string | null; org_name: string | null
      record_source: string | null; entity_type: string | null; enumeration_date: string | null; nppes_last_updated: string | null
      provider_signals: { ccm: boolean | null; pcm: boolean | null; awv: boolean | null; tcm: boolean | null; bhi: boolean | null; rpm: boolean | null; rcm_fit: boolean | null } | null
      provider_mips: Array<{ performance_year: number | null; status: string | null; reporting_option: string | null }> | null
    } | null }>
  }
}

type RawTransfer = {
  practice_id: string
  tenant_id: string
  note: string | null
  users: { full_name: string | null } | null
}

/**
 * All worksheets the signed-in user may see. Super Admin can pass a company
 * to load only that company's worksheets (filtered in the database).
 */
export async function getWorksheetReports(options: { companyId?: string } = {}): Promise<WorksheetReportsResult> {
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

  const companyId = isSuperAdmin && typeof options.companyId === 'string' && /^[0-9a-f-]{36}$/i.test(options.companyId) ? options.companyId : ''
  const select = `
    practice_id, tenant_id, call_details, additional_phone, email,
    concerned_person, direct_line, callback_at, timezone, disposition,
    updated_by, updated_at, import_data,
    tenants!lead_worksheets_tenant_id_fkey(name),
    users!lead_worksheets_updated_by_fkey(full_name, tenants(name)),
    master_practices!inner(
      practice_code, name, state, specialty, deleted_at,
      practice_providers(providers(
        name, org_name, record_source, entity_type, enumeration_date, nppes_last_updated,
        provider_signals(ccm, pcm, awv, tcm, bhi, rpm, rcm_fit),
        provider_mips(performance_year, status, reporting_option)
      ))
    )
  `
  // Newest first; practice + company make the order unique so pages never
  // overlap or skip a worksheet.
  const readPage = (from: number, to: number, withCount: boolean) => {
    let q = supabase.from('lead_worksheets').select(select, withCount ? { count: 'exact' } : undefined)
      .is('master_practices.deleted_at', null)
    if (isPersonal) q = q.eq('updated_by', me.id)
    else if (!isSuperAdmin) q = q.eq('tenant_id', me.tenant_id!)
    if (companyId) q = q.eq('tenant_id', companyId)
    return q.order('updated_at', { ascending: false }).order('practice_id').order('tenant_id').range(from, to)
  }
  let page: RawWorksheet[]
  try {
    page = await readAllPages<RawWorksheet>(readPage as never, { pageSize: PAGE_SIZE, concurrency: 4 })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Could not load worksheets.' }
  }
  const truncated = false

  const practiceIds = [...new Set(page.map(row => row.practice_id))]
  const transferBatches = await mapConcurrent(chunks(practiceIds, TRANSFER_BATCH), 4, async (ids) => {
    let q = supabase.from('lead_transfers')
      .select('practice_id, tenant_id, to_user_id, note, users!lead_transfers_to_user_id_fkey(full_name)')
      .in('practice_id', ids)
    if (!isSuperAdmin) q = q.eq('tenant_id', me.tenant_id!)
    else if (companyId) q = q.eq('tenant_id', companyId)
    const { data } = await q
    return (data ?? []) as unknown as RawTransfer[]
  })
  const transferByKey = new Map<string, RawTransfer>()
  for (const transfer of transferBatches.flat()) {
    transferByKey.set(`${transfer.practice_id}:${transfer.tenant_id}`, transfer)
  }

  const rows: WorksheetReportRow[] = page.map((worksheet) => {
    const practice = worksheet.master_practices
    const transfer = transferByKey.get(`${worksheet.practice_id}:${worksheet.tenant_id}`)
    const editor = worksheet.users
    const provider = practice.practice_providers?.[0]?.providers
    return {
      practiceId: worksheet.practice_id,
      tenantId: worksheet.tenant_id,
      practiceCode: practice.practice_code,
      practiceName: practice.name,
      providerName: getImportedProviderName(worksheet.import_data) ?? worksheet.concerned_person ?? (provider?.name && !/^Practice\s*\(/i.test(provider.name) ? provider.name : null) ?? provider?.org_name ?? null,
      orgName: provider?.org_name ?? null,
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
      ...deriveSignals(provider),
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
      practice_providers(providers(
        name, org_name, record_source, entity_type, enumeration_date, nppes_last_updated,
        provider_signals(ccm, pcm, awv, tcm, bhi, rpm, rcm_fit),
        provider_mips(performance_year, status, reporting_option)
      ))
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
  const provider = practice.practice_providers?.[0]?.providers
  return { ok: true, row: {
    practiceId: item.practice_id,
    tenantId: item.tenant_id,
    practiceCode: practice.practice_code,
    practiceName: practice.name,
    providerName: getImportedProviderName(item.import_data) ?? item.concerned_person ?? (provider?.name && !/^Practice\s*\(/i.test(provider.name) ? provider.name : null) ?? provider?.org_name ?? null,
    orgName: provider?.org_name ?? null,
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
    ...deriveSignals(provider),
  } }
}

/**
 * Super Admin: exact number of worksheets per company (counted in the
 * database, deleted leads excluded) for the company list on the page.
 */
export async function getWorksheetCompanyCounts(companyIds: string[]): Promise<Record<string, number>> {
  // Callable from the browser like every action here, so check the caller.
  const { data: { user } } = await getCurrentUser()
  if (!user) return {}
  const { data: me } = await getCurrentProfile(user.id)
  if (me?.roles?.key !== 'super_admin' || !Array.isArray(companyIds)) return {}
  const ids = companyIds.filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500)
  const supabase = await createSupabaseServer()
  const counts: Record<string, number> = {}
  await mapConcurrent(ids, 6, async (id) => {
    const { count } = await supabase.from('lead_worksheets')
      .select('practice_id, master_practices!inner(deleted_at)', { count: 'exact', head: true })
      .eq('tenant_id', id).is('master_practices.deleted_at', null)
    counts[id] = count ?? 0
  })
  return counts
}
