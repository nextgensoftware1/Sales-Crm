'use server'

// Returns one page of the Lead Pool for the signed-in user, filtered on the
// server with the same rules the browser used before (lib/lead-filters.ts).
// Reads from the snapshot the Leads page created; if it is missing (server
// restart, expired), the snapshot is rebuilt with the same loader the page uses.

import { loadLeadsData } from '../lib/leads-data'
import { getLeadSnapshot, saveLeadSnapshot, queryLeadSnapshot } from '../lib/lead-snapshots'
import { sanitizeLeadFilters } from '../lib/lead-filters'
import { deepSearchLeadCodes } from '../lib/lead-deep-search'
import { createSupabaseServer, getCurrentUser } from '../lib/supabase-server'

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
    const data = await loadLeadsData()
    if (data.kind !== 'ok' || data.authUserId !== user.id) {
      return { ok: false as const, message: 'Could not load leads. Please refresh the page.' }
    }
    snapshot = saveLeadSnapshot(user.id, data)
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

  const result = queryLeadSnapshot(
    snapshot, filters, timeZone,
    Number(input?.page), Number(input?.pageSize),
    // A rebuilt snapshot may differ, so always send its codes and counts.
    Boolean(input?.wantCodes) || rebuilt,
    searchExtraCodes,
  )
  return {
    ok: true as const,
    snapshotId: snapshot.id,
    overview: rebuilt ? snapshot.overview : undefined,
    ...result,
  }
}
