import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import AppShell from './AppShell'
import { compactRow } from '../lib/query-utils'
import { packRows } from '../lib/lead-pack'
import { cookies } from 'next/headers' // ← ADDED
import { loadLeadsData } from '../lib/leads-data'
import { saveLeadSnapshot, queryLeadSnapshot, getReusableLeadSnapshot, leadProfileKey, saveLeadNavigation, type LeadSnapshot } from '../lib/lead-snapshots' // ← CHANGED
import { DEFAULT_LEAD_FILTERS } from '../lib/lead-filters'
import { getCurrentUser, getCurrentProfile } from '../lib/supabase-server' // ← ADDED

// ← ADDED: open the page instantly from this user's recent lead snapshot
// (up to 10 minutes old) and refresh it in the background. Set
// CRM_INSTANT_LEADS=0 to always load everything first, as before.
const REUSE_SNAPSHOT_MS = 10 * 60 * 1000
const FRESH_COOKIE = 'crm_leads_fresh'
const BACKGROUND_REFRESH_AFTER_MS = 2 * 60 * 1000 // ← ADDED
function snapshotOlderThan(createdAt: number, ms: number) { // ← ADDED
  return Date.now() - createdAt > ms
}

export default async function Home() {
  const serverPaged = process.env.CRM_SERVER_PAGED_LEADS !== '0'

  // ← ADDED: reuse a recent snapshot when possible. Skipped right after this
  // user changed leads on the Leads page (cookie set by the browser), and for
  // roles whose list depends on their own assignments (Company Admin,
  // Manager, Team Lead) — those always load fresh, exactly as before.
  let reused: LeadSnapshot | null = null
  let profileKey: string | null = null
  if (serverPaged && process.env.CRM_INSTANT_LEADS !== '0') {
    const { data: { user } } = await getCurrentUser()
    if (user) {
      const { data: me } = await getCurrentProfile(user.id)
      profileKey = leadProfileKey(me)
      let wantsFresh = true
      try {
        wantsFresh = (await cookies()).get(FRESH_COOKIE)?.value === '1'
      } catch {
        // Outside a real request (e.g. tests): always load fresh.
      }
      const candidate = wantsFresh ? null : getReusableLeadSnapshot(user.id, profileKey, REUSE_SNAPSHOT_MS)
      // ← CHANGED: every role now opens instantly from its recent snapshot
      // (Company Admin / Manager / Team Lead included). Their "My assigned"
      // list is refreshed together with the leads in the background.
      if (candidate) reused = candidate
    }
  }

  const data = reused ? reused.data : await loadLeadsData() // ← CHANGED

  if (data.kind === 'error') {
    const error: any = data.error
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ color: 'red' }}>Error loading practices</h1>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#f66' }}>{JSON.stringify({
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
        }, null, 2)}</pre>
      </div>
    )
  }

  const {
    currentUser, roleKey, isSuperAdmin, canUpload, canAssign, showTransfers, canManageUsers,
    myUserId, practices, myAssignedCodes, newLeadCodes, workedLeadCodes, completedWorksheetCount,
  } = data

  // Server-paged mode (default): keep the lead snapshot on the server and send
  // only the first page + counts; the table asks for other pages/filters via
  // app/leads-page-actions.ts. Set CRM_SERVER_PAGED_LEADS=0 to send every lead
  // to the browser as before.
  const initialPageSize = isSuperAdmin ? 20 : 8
  let tableData: Record<string, unknown>
  if (serverPaged) {
    if (!reused && !profileKey) {
      const { data: me } = await getCurrentProfile(data.authUserId)
      profileKey = leadProfileKey(me)
    }
    const snapshot = reused ?? saveLeadSnapshot(data.authUserId, data, profileKey) // ← CHANGED
    const first = queryLeadSnapshot(snapshot, DEFAULT_LEAD_FILTERS, null, 1, initialPageSize, true)
    const navigationId = saveLeadNavigation(snapshot, first.codes ?? [])
    tableData = {
      serverPaging: {
        snapshotId: snapshot.id,
        navigationId,
        overview: snapshot.overview,
        rows: first.rows,
        codes: first.codes,
        pageSize: first.pageSize,
        // ← CHANGED: refresh in the background only when the reused data is
        // older than 2 minutes. Moving quickly between pages no longer
        // re-runs the full lead load each time (which also slowed the next
        // page you opened). Your own changes still always load fresh.
        stale: Boolean(reused) && snapshotOlderThan(reused?.createdAt ?? 0, BACKGROUND_REFRESH_AFTER_MS),
      },
    }
  } else {
    // Smaller browser payload: drop empty/false/null fields (read with ?? / ?. /
    // truthiness in PracticesTable). name and practiceCode are always kept.
    const compactPractices = practices.map(row => ({
      ...compactRow(row), practiceCode: row.practiceCode, name: row.name,
    }))
    tableData = {
      packedPractices: packRows(compactPractices as unknown as Record<string, unknown>[]),
      newLeadCodes,
      workedLeadCodes,
    }
  }

  return (
    <AppShell
      title="Leads Management Engine"
      subtitle="Import, deduplicate, and assign practice-first leads to employees"
      currentUser={currentUser}
      active="/"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
      headerRight={canUpload ? <UploadLeadsButton /> : null}
    >
      <PracticesTable
        {...tableData}
        currentUser={currentUser}
        viewerUserId={myUserId}
        isSuperAdmin={isSuperAdmin}
        lazyOptions
        canAssign={canAssign}
        myAssignedCodes={myAssignedCodes}
        viewerRole={roleKey}
        completedWorksheetCount={completedWorksheetCount}
      />
    </AppShell>
  )
}
