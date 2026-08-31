import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'

export default async function RemindersPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .single()

  const { data: reminders } = await supabase
    .from('lead_reminders')
    .select('remind_at, note, done, master_practices(name, practice_code)')
    .eq('agent_id', (me as any)?.id)
    .order('remind_at', { ascending: true })

  const now = new Date()
  const overdue = (reminders ?? []).filter((r: any) => !r.done && new Date(r.remind_at) < now)
  const upcoming = (reminders ?? []).filter((r: any) => !r.done && new Date(r.remind_at) >= now)

  const cell = { padding: 10, border: '1px solid #ddd', fontSize: 14, textAlign: 'left' as const }
  const head = { ...cell, background: '#f2f2f2', color: '#000', fontWeight: 600 }

  const renderTable = (rows: any[], emptyMsg: string) => (
    rows.length === 0 ? <p style={{ color: '#888' }}>{emptyMsg}</p> : (
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 800, marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={head}>When</th>
            <th style={head}>Practice</th>
            <th style={head}>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i) => (
            <tr key={i}>
              <td style={cell}>{new Date(r.remind_at).toLocaleString()}</td>
              <td style={cell}>
                <a href={`/practice/${r.master_practices?.practice_code}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                  {r.master_practices?.name ?? '—'}
                </a>
              </td>
              <td style={cell}>{r.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  )

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28 }}>My Reminders</h1>
        <a href="/" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>← Back to practices</a>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#dc2626' }}>Overdue ({overdue.length})</h2>
      {renderTable(overdue, 'Nothing overdue.')}

      <h2 style={{ fontSize: 18, marginBottom: 12, color: '#d97706' }}>Upcoming ({upcoming.length})</h2>
      {renderTable(upcoming, 'No upcoming reminders.')}
    </div>
  )
}