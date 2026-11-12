'use server'

// Returns one page of the Lead Pool for the signed-in user, filtered on the
// server with the same rules the browser used before (lib/lead-filters.ts).
// Reads from the snapshot the Leads page created; if it is missing (server
// restart, expired), the snapshot is rebuilt with the same loader the page uses.

import { loadLeadsData } from '../lib/leads-data'
import { getLeadSnapshot, saveLeadSnapshot, queryLeadSnapshot, leadProfileKey, saveLeadNavigation } from '../lib/lead-snapshots' // ← CHANGED: + leadProfileKey
import { sanitizeLeadFilters } from '../lib/lead-filters'
import { deepSearchLeadCodes } from '../lib/lead-deep-search'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server' // ← CHANGED: + getCurrentProfile
import { loadDbLeadView, buildDbLeadSnapshot, queryDbLeadSnapshot } from '../lib/lead-db-view' // ← ADDED
import { isDbPagingError, dbPagingEnabled } from '../lib/lead-db-paging' // ← ADDED
import type { LeadSnapshot } from '../lib/lead-snapshots' // ← ADDED

// ← ADDED: a fresh snapshot for this viewer — database-paged for Super Admin /
// Company Admin (no lead rows read), otherwise the full lead load as before.
async function rebuildSnapshot(userId: string, allowDb = true): Promise<LeadSnapshot | null> {
  const view = allowDb && dbPagingEnabled() ? await loadDbLeadView() : null
  if (view && view.data.authUserId === userId) {
    try {
      return await buildDbLeadSnapshot(view)
    } catch (error) {
      if (!isDbPagingError(error)) throw error
      console.error('[crm] database-paged Lead Pool failed; loading every lead as before:', (error as Error).message)
    }
  }
  const data = await loadLeadsData()
  if (data.kind !== 'ok' || data.authUserId !== userId) return null
  const { data: me } = await getCurrentProfile(userId)
  return saveLeadSnapshot(userId, data, leadProfileKey(me))
}

export async function queryLeadPage(input: {
  snapshotId: string
  filters: unknown
  timeZone?: string | null
  page: number
  pageSize: number
  wantCodes: boolean
}) {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false as const, message: 'Your session has ended. Please sign in again.' }

  let snapshot = getLeadSnapshot(String(input?.snapshotId ?? ''), user.id)
  let rebuilt = false
  if (!snapshot) {
    snapshot = await rebuildSnapshot(user.id) // ← CHANGED: database-paged for admins
    if (!snapshot) {
      return { ok: false as const, message: 'Could not load leads. Please refresh the page.' }
    }
    rebuilt = true
  }

  const timeZone = typeof input?.timeZone === 'string' ? input.timeZone.slice(0, 64) : null
  const filters = sanitizeLeadFilters(input?.filters)

  // Search box: also find leads by phone number, email, city, ZIP or contact
  // person (details not in the list rows). Cached per snapshot + search text,
  // so changing page doesn't repeat the lookups.
  let searchExtraCodes: Set<string> | undefined
  const term = filters.search.trim().toLowerCase()
  if (term.length >= 3) {
    searchExtraCodes = snapshot.deepSearch.get(term)
    if (!searchExtraCodes) {
      try {
        const db = await createSupabaseServer()
        searchExtraCodes = await deepSearchLeadCodes(db, term, { tenantId: snapshot.tenantId, isSuperAdmin: snapshot.ctx.isSuperAdmin })
      } catch {
        searchExtraCodes = new Set()   // deep search is a bonus; normal search still works
      }
      if (snapshot.deepSearch.size >= 30) snapshot.deepSearch.delete(snapshot.deepSearch.keys().next().value as string)
      snapshot.deepSearch.set(term, searchExtraCodes)
    }
  }

  // ← CHANGED: a database-paged snapshot reads the page from the database.
  // If that fails for any database reason, this request falls back to the
  // full lead load (as before), so paging and filtering keep working.
  let dbResult: Awaited<ReturnType<typeof queryDbLeadSnapshot>> | null = null
  if (snapshot.dbScope) {
    try {
      dbResult = await queryDbLeadSnapshot(
        snapshot, filters, timeZone,
        Number(input?.page), Number(input?.pageSize),
        Boolean(input?.wantCodes) || rebuilt,
        searchExtraCodes,
      )
    } catch (error) {
      if (!isDbPagingError(error)) throw error
      console.error('[crm] database-paged Lead Pool failed; loading every lead as before:', (error as Error).message)
      const fallback = await rebuildSnapshot(user.id, false)
      if (!fallback) return { ok: false as const, message: 'Could not load leads. Please refresh the page.' }
      fallback.deepSearch = snapshot.deepSearch
      snapshot = fallback
      rebuilt = true
    }
  }
  const shouldReturnCodes = Boolean(input?.wantCodes) || rebuilt
  const result = dbResult
    ?? queryLeadSnapshot(
        snapshot, filters, timeZone,
        Number(input?.page), Number(input?.pageSize),
        // A rebuilt snapshot may differ, so always send its codes and counts.
        shouldReturnCodes,
        searchExtraCodes,
      )
  const navigationId = shouldReturnCodes && result.codes
    ? saveLeadNavigation(snapshot, result.codes)
    : undefined
  return {
    ok: true as const,
    snapshotId: snapshot.id,
    overview: rebuilt ? snapshot.overview : undefined,
    navigationId,
    ...result,
  }
}

// ← ADDED: when the Leads page opened instantly from a recent snapshot, the
// browser calls this right away to load fresh data in the background. It
// builds a new snapshot with the exact same loader the page uses; the table
// then re-reads its current filters/page from the new snapshot.
export async function refreshLeadSnapshot() {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false as const, message: 'Your session has ended. Please sign in again.' }
  const snapshot = await rebuildSnapshot(user.id) // ← CHANGED: database-paged for admins
  if (!snapshot) {
    return { ok: false as const, message: 'Could not refresh leads. Please reload the page.' }
  }
  const data = snapshot.data
  // ← CHANGED: + the viewer's own assigned leads, so "My assigned" and the
  // priority order in the browser match the fresh data too.
  return { ok: true as const, snapshotId: snapshot.id, overview: snapshot.overview, myAssignedCodes: data.myAssignedCodes ?? [] }
}
