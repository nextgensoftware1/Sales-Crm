'use client'

import { useEffect, useState } from 'react'
import { getReminders, markReminderDone, type Reminder } from '../reminders-actions'

const SCOPE_LABEL: Record<string, string> = {
  all: 'across all companies',
  company: 'for your company',
  mine: "you've scheduled",
}

export default function RemindersClient({ initialData, initialMessage }: {
  initialData?: { reminders: Reminder[]; scope: 'all' | 'company' | 'mine' }
  initialMessage?: string
}) {
  const [reminders, setReminders] = useState<Reminder[]>(initialData?.reminders ?? [])
  const [scope, setScope] = useState<'all' | 'company' | 'mine'>(initialData?.scope ?? 'mine')
  const [loading, setLoading] = useState(!initialData && !initialMessage)
  const [msg, setMsg] = useState(initialMessage ?? '')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (initialData || initialMessage) return
    (async () => {
      setLoading(true)
      const res = await getReminders()
      if (res.ok) {
        setReminders(res.reminders ?? [])
        setScope(res.scope ?? 'mine')
      } else {
        setMsg(res.message ?? 'Could not load reminders.')
      }
      setLoading(false)
    })()
  }, [initialData, initialMessage])

  const handleDone = async (id: string) => {
    setBusyId(id)
    const res = await markReminderDone(id)
    if (res.ok) {
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, done: true } : r)))
    } else {
      setMsg(res.message ?? 'Could not update reminder.')
    }
    setBusyId(null)
  }

  if (loading) return <p className="subtle">Loading…</p>
  if (msg && reminders.length === 0) return <p className="subtle">{msg}</p>

  const showAgentCol = scope !== 'mine'
  const showCompanyCol = scope === 'all'

  const now = new Date()
  const active = reminders.filter((r) => !r.done)
  const overdue = active.filter((r) => new Date(r.remindAt) < now)
  const upcoming = active.filter((r) => new Date(r.remindAt) >= now)

  const renderTable = (rows: Reminder[], emptyMsg: string) => (
    rows.length === 0 ? <p className="subtle">{emptyMsg}</p> : (
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Practice</th>
              {showAgentCol && <th>Set By</th>}
              {showCompanyCol && <th>Company</th>}
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontSize: 12 }}>{new Date(r.remindAt).toLocaleString()}</td>
                <td>
                  {r.practiceDeleted ? (
                    <span className="subtle" title="This lead was permanently deleted">{r.practiceName}</span>
                  ) : (
                    <a href={`/practice/${r.practiceCode}`}>{r.practiceName}</a>
                  )}
                </td>
                {showAgentCol && <td>{r.agentName ?? '—'}</td>}
                {showCompanyCol && <td>{r.companyName ?? '—'}</td>}
                <td>{r.note ?? '—'}</td>
                <td>
                  <button
                    onClick={() => handleDone(r.id)}
                    disabled={busyId === r.id}
                    className="lead-quickbtn"
                    style={{ opacity: busyId === r.id ? 0.6 : 1 }}
                    title="Mark this reminder done"
                  >
                    ✓ Done
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p className="subtle" style={{ margin: 0 }}>
        Showing follow-ups and callbacks {SCOPE_LABEL[scope]}.
      </p>
      <div className="card">
        <h2 className="h-section" style={{ color: 'var(--danger)' }}>Overdue ({overdue.length})</h2>
        {renderTable(overdue, 'Nothing overdue.')}
      </div>
      <div className="card">
        <h2 className="h-section" style={{ color: 'var(--warn)' }}>Upcoming ({upcoming.length})</h2>
        {renderTable(upcoming, 'No upcoming reminders.')}
      </div>
    </div>
  )
}
