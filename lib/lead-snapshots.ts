// Server-side Lead Pool snapshots.
//
// Before: the Leads page sent every lead (~15,000) to the browser, and the
// browser filtered that snapshot. Now the server keeps the same snapshot in
// memory and the browser asks for one page of it at a time. Each snapshot is
// tied to the signed-in user who created it and is never shared.
//
// Limits keep memory bounded: newest 3 snapshots per user, 40 overall, each
// expires after 30 minutes. A missing or expired snapshot is simply rebuilt.

import type { LeadsData } from './leads-data'
import {
  filterLeads, leadOverview, calendarDateIn,
  type LeadFilters, type LeadOverview, type LeadRow, type LeadContext,
} from './lead-filters'
import { compactRow } from './query-utils'

export type LeadSnapshot = {
  id: string
  userId: string
  tenantId: string | null
  createdAt: number
  practices: LeadRow[]
  ctx: LeadContext
  overview: LeadOverview
  /** Deep-search results per search text (phone/email/city/ZIP/contact). */
  deepSearch: Map<string, Set<string>>
  // ← ADDED: everything the Leads page needs to render from this snapshot,
  // plus the signed-in profile (id|status|role|company) it was built for.
  data: LeadsData
  profileKey: string | null
}

const TTL_MS = 30 * 60 * 1000
const PER_USER = 3
const MAX_TOTAL = 40

// Kept on globalThis so dev hot-reloads and separately bundled server
// entry points (page vs. server action) share one store.
const g = globalThis as typeof globalThis & { __crmLeadSnapshots?: Map<string, LeadSnapshot> }
const store: Map<string, LeadSnapshot> = (g.__crmLeadSnapshots ??= new Map())

function prune(now: number) {
  for (const [id, snap] of store) if (now - snap.createdAt > TTL_MS) store.delete(id)
  while (store.size > MAX_TOTAL) store.delete(store.keys().next().value as string)
}

export function saveLeadSnapshot(userId: string, data: LeadsData, profileKey: string | null = null): LeadSnapshot { // ← CHANGED: + profileKey
  const now = Date.now()
  const ctx: LeadContext = {
    isSuperAdmin: data.isSuperAdmin,
    prioritySet: new Set(data.myAssignedCodes),
    newLeadSet: new Set(data.newLeadCodes),
    workedLeadSet: new Set(data.workedLeadCodes),
  }
  const practices = data.practices as unknown as LeadRow[]
  const snap: LeadSnapshot = {
    id: globalThis.crypto.randomUUID(),
    userId,
    tenantId: data.tenantId ?? null,
    createdAt: now,
    practices,
    ctx,
    overview: leadOverview(practices, { ...ctx, completedWorksheetCount: data.completedWorksheetCount }),
    deepSearch: new Map(),
    data, // ← ADDED
    profileKey, // ← ADDED
  }
  // Keep only this user's newest snapshots.
  const mine = [...store.values()].filter((s) => s.userId === userId).sort((a, b) => a.createdAt - b.createdAt)
  while (mine.length >= PER_USER) store.delete(mine.shift()!.id)
  store.set(snap.id, snap)
  prune(now)
  return snap
}

export function getLeadSnapshot(id: string, userId: string): LeadSnapshot | null {
  const snap = store.get(id)
  if (!snap || snap.userId !== userId) return null
  if (Date.now() - snap.createdAt > TTL_MS) { store.delete(id); return null }
  return snap
}

// ← ADDED: identifies the profile a snapshot was built for. If the user's
// role, company or status changes, old snapshots no longer match.
export function leadProfileKey(profile: { id?: string | null; status?: string | null; tenant_id?: string | null; roles?: { key?: string | null } | null } | null | undefined): string | null {
  if (!profile?.id || profile.status !== 'active') return null
  return [profile.id, profile.status, profile.roles?.key ?? '', profile.tenant_id ?? ''].join('|')
}

// ← ADDED: the newest snapshot this user can reuse to show the Leads page
// immediately (the browser then refreshes it in the background).
export function getReusableLeadSnapshot(userId: string, profileKey: string | null, maxAgeMs: number): LeadSnapshot | null {
  if (!profileKey) return null
  const now = Date.now()
  let best: LeadSnapshot | null = null
  for (const snap of store.values()) {
    if (snap.userId !== userId || snap.profileKey !== profileKey) continue
    if (now - snap.createdAt > Math.min(maxAgeMs, TTL_MS)) continue
    if (!best || snap.createdAt > best.createdAt) best = snap
  }
  return best
}

export const MAX_PAGE_SIZE = 200

export function queryLeadSnapshot(
  snap: LeadSnapshot,
  filters: LeadFilters,
  timeZone: string | null,
  page: number,
  pageSize: number,
  wantCodes: boolean,
  searchExtraCodes?: Set<string>,
) {
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 1))
  const filtered = filterLeads(snap.practices, filters, { ...snap.ctx, searchExtraCodes }, calendarDateIn(timeZone))
  const totalPages = Math.max(1, Math.ceil(filtered.length / size))
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (safePage - 1) * size
  return {
    total: filtered.length,
    page: safePage,
    pageSize: size,
    // Same compact form the full list used (empty fields dropped; name and
    // practiceCode always kept).
    rows: filtered.slice(start, start + size).map((row) => ({
      ...compactRow(row as unknown as Record<string, unknown>), practiceCode: row.practiceCode, name: row.name,
    }) as unknown as LeadRow),
    codes: wantCodes ? filtered.map((p) => p.practiceCode) : undefined,
  }
}
