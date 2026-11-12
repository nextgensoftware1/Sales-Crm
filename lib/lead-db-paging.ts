// Lead Pool paged INSIDE the database (Super Admin and Company Admin).
//
// Before, the Leads page read every lead (~32k rows) from Supabase and
// filtered them in the app server's memory. Now the filters are sent to
// public.crm_lead_page (database/lead-pool-db-paging.sql), which returns only
// the count, the ordered list of matching lead codes and the ids of the
// current page. The page rows are then read with crm_lead_rows_page (the
// crm_lead_rows_flat row format) for just those ids and built by mapLeadRow — the same
// code the full load uses — so the table looks exactly the same.
//
// Agents, Closers, Managers and Team Leads keep the existing path (their list
// is only their own assigned leads).

import { decodeFlatLead } from './lead-pack'
import { mapLeadRow, type MappedLeadRow } from './lead-row-map'
import { ZONE_BY_STATE, type LeadFilters, type LeadOverview } from './lead-filters'
import { dispositionOptions } from './dispositions'

export type DbLeadScope = {
  scope: 'all' | 'company'
  tenantId: string | null
  /** public.users id of the viewer. */
  profileId: string | null
  isSuperAdmin: boolean
  canAssign: boolean
  /** Lead codes assigned to the viewer ("My assigned" + priority order). */
  priorityCodes: string[]
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type DbPageEntry = {
  id: string
  code: string
  alloc: boolean
  companies: { id: string; name: string }[]
  email: boolean
}

/** Switch: CRM_DB_PAGED_LEADS=0 turns the database-paged Lead Pool off. */
export function dbPagingEnabled(): boolean {
  return process.env.CRM_DB_PAGED_LEADS !== '0'
}

/** Roles whose Lead Pool is paged in the database: Super Admin only. */
export function usesDbPaging(roleKey: string): boolean {
  if (!dbPagingEnabled()) return false
  return roleKey === 'super_admin'
}

/** The SQL file has not been run yet (function missing). */
export function isMissingDbPagingFunction(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST202' || code === '42883'
}

export class DbPagingError extends Error {
  code?: string
  constructor(error: { code?: string; message?: string } | null) {
    super(error?.message ?? 'Lead Pool query failed')
    this.name = 'DbPagingError'
    this.code = error?.code
  }
}

/**
 * Any database error from the database-paged Lead Pool. The Leads page then
 * falls back to the full lead load, so a problem here never blocks the page.
 */
export function isDbPagingError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'DbPagingError'
}

async function callLeadPage(db: RpcClient, scope: DbLeadScope, args: {
  action: 'list' | 'resolve' | 'overview' | 'first'
  filters?: LeadFilters | null
  timeZone?: string | null
  extraCodes?: string[] | null
  offset?: number
  limit?: number
  codes?: string[] | null
  wantCodes?: boolean
}) {
  const { data, error } = await db.rpc('crm_lead_page', {
    p_scope: scope.scope,
    p_tenant: scope.tenantId,
    p_user: scope.profileId,
    p_filters: args.filters ?? {},
    p_time_zone: args.timeZone ?? null,
    p_priority_codes: scope.priorityCodes,
    p_extra_codes: args.extraCodes ?? [],
    p_action: args.action,
    p_offset: args.offset ?? 0,
    p_limit: args.limit ?? 20,
    p_codes: args.codes ?? null,
    p_want_codes: args.wantCodes ?? false,
  })
  if (error) throw new DbPagingError(error)
  return (data ?? {}) as Record<string, unknown>
}

/** Summary cards, dropdown options and tab counts — same as leadOverview(). */
export async function dbLeadOverview(db: RpcClient, scope: DbLeadScope): Promise<LeadOverview> {
  return overviewFrom(await callLeadPage(db, scope, { action: 'overview' }), scope)
}

function overviewFrom(r: Record<string, unknown>, scope: DbLeadScope): LeadOverview {
  const total = Number(r.total ?? 0)
  const stateCounts = (Array.isArray(r.stateCounts) ? r.stateCounts : []) as [string | null, number][]
  const zoneCounts: Record<string, number> = { EST: 0, CST: 0, MST: 0, PST: 0, Other: 0 }
  for (const [state, count] of stateCounts) {
    const zone = state ? (ZONE_BY_STATE[state] ?? 'Other') : 'Other'
    zoneCounts[zone] = (zoneCounts[zone] ?? 0) + Number(count)
  }
  const states = stateCounts.map(([state]) => state).filter((s): s is string => Boolean(s)).sort()
  const specialties = ((Array.isArray(r.specialties) ? r.specialties : []) as string[]).filter(Boolean).sort()
  const covered = Number(scope.isSuperAdmin ? r.allocatedCount ?? 0 : r.assignedAwayCount ?? 0)
  const worked = Number(r.workedCount ?? 0)
  const fresh = Number(r.newCount ?? 0)
  return {
    states,
    specialties,
    // Admin views carry no call status, as in the full load.
    dispositions: dispositionOptions([]),
    zoneCounts,
    summaryCounts: {
      total,
      unassigned: total - covered,
      assigned: covered,
      worked,
      qualified: 0,
      new: fresh,
      followUp: 0,
    },
    leadCompanies: (Array.isArray(r.leadCompanies) ? r.leadCompanies : []) as { id: string; name: string }[],
    newCount: fresh,
    workedCount: worked,
    notWorkedCount: total - worked,
  }
}

/** Filter + sort in the database: count, ordered codes (optional), one page. */
export async function dbLeadList(
  db: RpcClient,
  scope: DbLeadScope,
  filters: LeadFilters,
  timeZone: string | null,
  extraCodes: string[] | null,
  offset: number,
  limit: number,
  wantCodes: boolean,
): Promise<{ total: number; codes: string[] | null; page: DbPageEntry[] }> {
  const r = await callLeadPage(db, scope, { action: 'list', filters, timeZone, extraCodes, offset, limit, wantCodes })
  const codesText = typeof r.codes === 'string' ? r.codes : null
  return {
    total: Number(r.total ?? 0),
    codes: wantCodes ? (codesText ? codesText.split('\n') : []) : null,
    page: (Array.isArray(r.page) ? r.page : []) as DbPageEntry[],
  }
}

/**
 * Opening the Lead Pool: the overview AND the first filtered page from one
 * pass over the leads (one database call instead of two).
 */
export async function dbLeadFirst(
  db: RpcClient,
  scope: DbLeadScope,
  filters: LeadFilters,
  timeZone: string | null,
  limit: number,
): Promise<{ overview: LeadOverview; total: number; codes: string[]; page: DbPageEntry[] }> {
  const r = await callLeadPage(db, scope, { action: 'first', filters, timeZone, offset: 0, limit, wantCodes: true })
  const codesText = typeof r.codes === 'string' ? r.codes : ''
  return {
    overview: overviewFrom((r.overview ?? {}) as Record<string, unknown>, scope),
    total: Number(r.total ?? 0),
    codes: codesText ? codesText.split('\n') : [],
    page: (Array.isArray(r.page) ? r.page : []) as DbPageEntry[],
  }
}

/** Ids and allocation details for known codes (opening another page). */
export async function dbLeadResolve(db: RpcClient, scope: DbLeadScope, codes: string[]): Promise<DbPageEntry[]> {
  if (codes.length === 0) return []
  const r = await callLeadPage(db, scope, { action: 'resolve', codes })
  return (Array.isArray(r.page) ? r.page : []) as DbPageEntry[]
}

/** The page rows, built exactly like the full load builds them. */
export async function dbLeadRows(db: RpcClient, scope: DbLeadScope, entries: DbPageEntry[]): Promise<MappedLeadRow[]> {
  if (entries.length === 0) return []
  // Same row format as crm_lead_rows_flat (database/lead-pool-db-paging.sql).
  const { data, error } = await db.rpc('crm_lead_rows_page', {
    p_ids: entries.map((entry) => entry.id),
    p_assigned_by: scope.canAssign ? scope.profileId : null,
  })
  if (error) throw new DbPagingError(error)
  const byId = new Map<string, Record<string, unknown>>()
  for (const raw of (Array.isArray(data) ? data : []) as unknown[][]) {
    const lead = decodeFlatLead(raw as Parameters<typeof decodeFlatLead>[0])
    byId.set(String(lead.id), lead)
  }

  const allocatedCodeSet = new Set<string>()
  const allocatedCompanyByCode: Record<string, { id: string; name: string }[]> = {}
  const emailLeadIds = new Set<string>()
  const lastDialed: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.alloc) allocatedCodeSet.add(entry.code)
    if (scope.isSuperAdmin && entry.companies?.length) allocatedCompanyByCode[entry.code] = entry.companies
    if (entry.email) emailLeadIds.add(entry.id)
    const lead = byId.get(entry.id) as { lead_activity?: { created_at?: string | null }[] } | undefined
    const latest = lead?.lead_activity?.[0]?.created_at
    if (latest) lastDialed[entry.id] = latest
  }
  const context = {
    canAssign: scope.canAssign,
    allocatedOn: {} as Record<string, string>,
    leadStatus: {} as Record<string, string>,
    lastDialed,
    allocatedCodeSet,
    allocatedCompanyByCode,
    emailLeadIds,
  }
  const rows: MappedLeadRow[] = []
  for (const entry of entries) {
    const lead = byId.get(entry.id)
    if (lead) rows.push(mapLeadRow(lead, context))
  }
  return rows
}
