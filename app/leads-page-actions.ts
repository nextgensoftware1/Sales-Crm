'use server'

// Returns one page of the Lead Pool for the signed-in user, filtered on the
// server with the same rules the browser used before (lib/lead-filters.ts).
// Reads from the snapshot the Leads page created; if it is missing (server
// restart, expired), the snapshot is rebuilt with the same loader the page uses.

import { getCurrentUser } from '../lib/supabase-server'
import { loadLeadsData } from '../lib/leads-data'
import { getLeadSnapshot, saveLeadSnapshot, queryLeadSnapshot } from '../lib/lead-snapshots'
import { sanitizeLeadFilters } from '../lib/lead-filters'

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
  const result = queryLeadSnapshot(
    snapshot, sanitizeLeadFilters(input?.filters), timeZone,
    Number(input?.page), Number(input?.pageSize),
    // A rebuilt snapshot may differ, so always send its codes and counts.
    Boolean(input?.wantCodes) || rebuilt,
  )
  return {
    ok: true as const,
    snapshotId: snapshot.id,
    overview: rebuilt ? snapshot.overview : undefined,
    ...result,
  }
}
