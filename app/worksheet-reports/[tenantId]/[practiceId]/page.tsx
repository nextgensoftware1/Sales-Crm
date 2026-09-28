import Link from 'next/link'
import { redirect } from 'next/navigation'
import AppShell from '../../../AppShell'
import { getCurrentProfile, getCurrentUser } from '../../../../lib/supabase-server'
import { roleLabel } from '../../../../lib/roles'
import { getWorksheetReportDetail } from '../../../worksheet-reports-actions'
import ImportedWorksheetEditor from './ImportedWorksheetEditor'

export default async function ImportedWorksheetPage({
  params,
}: {
  params: Promise<{ tenantId: string; practiceId: string }>
}) {
  const { tenantId, practiceId } = await params
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = me?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  const currentUser = me ? { full_name: me.full_name, role: roleLabel(roleKey), company: me.tenants?.name ?? '' } : null
  const result = await getWorksheetReportDetail(tenantId, practiceId)

  return <AppShell
    title="Imported Worksheet"
    subtitle={result.ok ? `${result.row.practiceName} · ${result.row.practiceCode}` : 'Worksheet details'}
    currentUser={currentUser}
    active="/worksheet-reports"
    showAdmin={isSuperAdmin}
    canManageUsers={canManageUsers}
  >
    {!result.ok ? <div className="card worksheet-detail-error">
      <h2>Worksheet unavailable</h2>
      <p>{result.message}</p>
      <Link href="/worksheet-reports" className="btn">Back to Worksheet Reports</Link>
    </div> : <div className="worksheet-detail-page">
      <div className="worksheet-detail-heading">
        <Link href="/worksheet-reports" className="lead-back-btn" aria-label="Back to Worksheet Reports">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div>
          <div className="worksheet-detail-title-row">
            <h1>{result.row.practiceName}</h1>
            <span className="lead-code">{result.row.practiceCode}</span>
            <span className="badge badge-blue">Imported worksheet</span>
          </div>
          <p>{[result.row.companyName, result.row.state, result.row.specialty].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <div className="worksheet-detail-summary">
        <div><span>Company</span><strong>{result.row.companyName ?? '—'}</strong></div>
        <div><span>Worksheet agent</span><strong>{result.row.filledBy ?? '—'}</strong></div>
        <div><span>Disposition</span><strong>{result.row.disposition ?? '—'}</strong></div>
        <div><span>Last updated</span><strong>{result.row.lastUpdatedAt ? new Date(result.row.lastUpdatedAt).toLocaleString() : '—'}</strong></div>
      </div>

      <ImportedWorksheetEditor tenantId={tenantId} practiceId={practiceId} initialFields={result.row.importData ?? {}} />
    </div>}
  </AppShell>
}
