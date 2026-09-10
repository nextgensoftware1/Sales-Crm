import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'

export default async function RemindersPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('id, full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const isSuperAdmin = (me as any)?.roles?.key === 'super_admin'
  const showTransfers = true // everyone signed in can view transfers (scoped by role inside the page)
  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? '',
      }
    : null

  const { data: reminders } = await supabase
    .from('lead_reminders')
    .select('remind_at, note, done, master_practices(name, practice_code)')
    .eq('agent_id', (me as any)?.id)
    .order('remind_at', { ascending: true })

  const now = new Date()
  const overdue = (reminders ?? []).filter((r: any) => !r.done && new Date(r.remind_at) < now)
  const upcoming = (reminders ?? []).filter((r: any) => !r.done && new Date(r.remind_at) >= now)

  const renderTable = (rows: any[], emptyMsg: string) => (
    rows.length === 0 ? <p className="subtle">{emptyMsg}</p> : (
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Practice</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i) => (
              <tr key={i}>
                <td>{new Date(r.remind_at).toLocaleString()}</td>
                <td>
                  {r.master_practices ? (
                    <a href={`/practice/${r.master_practices.practice_code}`}>
                      {r.master_practices.name}
                    </a>
                  ) : (
                    <span className="subtle" title="This practice was permanently deleted">— (deleted)</span>
                  )}
                </td>
                <td>{r.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  )

  return (
    <AppShell
      title="My Reminders"
      subtitle="Follow-ups and callbacks you've scheduled"
      currentUser={currentUser}
      active="/reminders"
      showAdmin={isSuperAdmin}
      showTransfers={showTransfers}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card">
          <h2 className="h-section" style={{ color: 'var(--danger)' }}>Overdue ({overdue.length})</h2>
          {renderTable(overdue, 'Nothing overdue.')}
        </div>
        <div className="card">
          <h2 className="h-section" style={{ color: 'var(--warn)' }}>Upcoming ({upcoming.length})</h2>
          {renderTable(upcoming, 'No upcoming reminders.')}
        </div>
      </div>
    </AppShell>
  )
}
