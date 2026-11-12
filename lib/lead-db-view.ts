// Server side of the database-paged Lead Pool (Super Admin only).
// Builds the same page data the full lead load (lib/leads-data.ts) produced,
// without reading every lead: the viewer's context here, the counts and rows
// from public.crm_lead_page (see lib/lead-db-paging.ts).

import { redirect } from 'next/navigation'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from './supabase-server'
import { roleLabel } from './roles'
import { allRows } from './practice-navigation'
import { compactRow } from './query-utils'
import type { LeadsData } from './leads-data'
import { DEFAULT_LEAD_FILTERS, sanitizeLeadFilters, type LeadFilters, type LeadRow } from './lead-filters'
import {
  usesDbPaging, dbLeadFirst, dbLeadList, dbLeadResolve, dbLeadRows, type DbLeadScope, type DbPageEntry,
} from './lead-db-paging'
import { saveDbLeadSnapshot, cacheDbCodes, leadProfileKey, MAX_PAGE_SIZE, type LeadSnapshot } from './lead-snapshots'

export type DbLeadView = { data: LeadsData; scope: DbLeadScope; profileKey: string | null }

/**
 * The signed-in viewer's Lead Pool context, or null when this viewer keeps
 * the full lead load (Agent, Closer, Manager, Team Lead, or the switch
 * CRM_DB_PAGED_LEADS=0). Same flags and labels as loadLeadsData().
 */
export async function loadDbLeadView(): Promise<DbLeadView | null> {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = me?.roles?.key ?? ''
  if (!usesDbPaging(roleKey)) return null
  const isSuperAdmin = roleKey === 'super_admin'
  const myTenantId = me?.tenant_id ?? null
  const myUserId = me?.id
  // A Company Admin without a company keeps the original path unchanged.
  if (!isSuperAdmin && !myTenantId) return null

  const canAssign = ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  let myAssignedCodes: string[] = []
  if (canAssign && myUserId) {
    const supabase = await createSupabaseServer()
    // Same read as lib/leads-data.ts (the viewer's own active assignments).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await allRows<any>(() => supabase
      .from('lead_assignments')
      .select('practice_id, master_practices(practice_code)')
      .eq('assigned_to', myUserId).eq('status', 'active').order('practice_id'))
    myAssignedCodes = rows
      .map((row: { master_practices?: { practice_code?: string | null } | null }) => row.master_practices?.practice_code)
      .filter((code): code is string => Boolean(code))
  }

  const data: LeadsData = {
    kind: 'ok',
    authUserId: user.id,
    tenantId: myTenantId,
    currentUser: me ? { full_name: me.full_name, role: roleLabel(me.roles?.key), company: me.tenants?.name ?? 'Unknown' } : null,
    roleKey,
    isSuperAdmin,
    canUpload: ['company_admin', 'super_admin'].includes(roleKey),
    canAssign,
    showTransfers: true,
    canManageUsers: isSuperAdmin || canAssign,
    myUserId,
    practices: [],
    myAssignedCodes,
    newLeadCodes: [],
    workedLeadCodes: [],
    completedWorksheetCount: undefined,
  }
  const scope: DbLeadScope = {
    scope: isSuperAdmin ? 'all' : 'company',
    tenantId: isSuperAdmin ? null : myTenantId,
    profileId: myUserId ?? null,
    isSuperAdmin,
    canAssign,
    priorityCodes: myAssignedCodes,
  }
  return { data, scope, profileKey: leadProfileKey(me) }
}

/**
 * The cache key and the time zone actually sent to the database. The time
 * zone only matters for the "Assigned on" date filter, so otherwise it is left
 * out — the page's first query (no time zone) and the browser's next request
 * (with its time zone) then share one cached result instead of searching twice.
 */
function dbQueryKey(filters: LeadFilters, timeZone: string | null, extra: string[] | null) {
  const clean = sanitizeLeadFilters(filters)
  const zone = clean.assignedDateFilter ? (timeZone ?? '') : ''
  return { clean, zone: zone || null, key: JSON.stringify([clean, zone, extra ?? []]) }
}

/**
 * New database-paged snapshot: the summary numbers AND the first page of the
 * default view, from one database call.
 */
export async function buildDbLeadSnapshot(view: DbLeadView, firstPageSize = 20): Promise<LeadSnapshot> {
  const supabase = await createSupabaseServer()
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(firstPageSize) || 1))
  const { clean, zone, key } = dbQueryKey(DEFAULT_LEAD_FILTERS, null, null)
  const first = await dbLeadFirst(supabase, view.scope, clean, zone, size)
  const snap = saveDbLeadSnapshot(view.data.authUserId, view.data, view.profileKey, view.scope, first.overview)
  cacheDbCodes(snap, key, first.codes)
  snap.dbFirstPage = { key, pageSize: size, entries: first.page }
  return snap
}

/** One page of the Lead Pool — same result shape as queryLeadSnapshot(). */
export async function queryDbLeadSnapshot(
  snap: LeadSnapshot,
  filters: LeadFilters,
  timeZone: string | null,
  page: number,
  pageSize: number,
  wantCodes: boolean,
  searchExtraCodes?: Set<string>,
) {
  const scope = snap.dbScope!
  const supabase = await createSupabaseServer()
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 1))
  const requested = Math.max(1, Math.floor(page) || 1)
  const extra = searchExtraCodes ? [...searchExtraCodes] : null
  const { clean, zone, key } = dbQueryKey(filters, timeZone, extra)

  let codes = snap.codeCache?.get(key) ?? null
  let entries: DbPageEntry[] | null = null
  if (codes && requested === 1 && snap.dbFirstPage?.key === key && snap.dbFirstPage.pageSize === size) {
    entries = snap.dbFirstPage.entries as DbPageEntry[] // read together with the overview
  }
  if (!codes) {
    // Filter in the database; the ordered codes are kept for paging,
    // Select all and the lead page's Previous / Next.
    const result = await dbLeadList(supabase, scope, clean, zone, extra, (requested - 1) * size, size, true)
    codes = result.codes ?? []
    cacheDbCodes(snap, key, codes)
    entries = result.page
  }

  const totalPages = Math.max(1, Math.ceil(codes.length / size))
  const safePage = Math.min(requested, totalPages)
  const start = (safePage - 1) * size
  if (!entries || safePage !== requested) {
    entries = await dbLeadResolve(supabase, scope, codes.slice(start, start + size))
  }
  const rows = await dbLeadRows(supabase, scope, entries)
  return {
    total: codes.length,
    page: safePage,
    pageSize: size,
    rows: rows.map((row) => ({
      ...compactRow(row as unknown as Record<string, unknown>), practiceCode: row.practiceCode, name: row.name,
    }) as unknown as LeadRow),
    codes: wantCodes ? codes : undefined,
  }
}
