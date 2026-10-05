import PracticesTable from './PracticesTable'
import UploadLeadsButton from './UploadLeadsButton'
import AppShell from './AppShell'
import { compactRow } from '../lib/query-utils'
import { packRows } from '../lib/lead-pack'
import { loadLeadsData } from '../lib/leads-data'
import { saveLeadSnapshot, queryLeadSnapshot } from '../lib/lead-snapshots'
import { DEFAULT_LEAD_FILTERS } from '../lib/lead-filters'

export default async function Home() {
  const data = await loadLeadsData()

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
  const serverPaged = process.env.CRM_SERVER_PAGED_LEADS !== '0'
  const initialPageSize = isSuperAdmin ? 20 : 8
  let tableData: Record<string, unknown>
  if (serverPaged) {
    const snapshot = saveLeadSnapshot(data.authUserId, data)
    const first = queryLeadSnapshot(snapshot, DEFAULT_LEAD_FILTERS, null, 1, initialPageSize, true)
    tableData = {
      serverPaging: {
        snapshotId: snapshot.id,
        overview: snapshot.overview,
        rows: first.rows,
        codes: first.codes,
        pageSize: first.pageSize,
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
