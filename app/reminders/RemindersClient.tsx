'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getReminders, markReminderDone, type Reminder } from '../reminders-actions'
import { useReminderCompanyFilter } from './ReminderCompanyFilter'

const SCOPE_LABEL: Record<string, string> = {
  all: 'across all companies',
  company: 'for your company',
  mine: "you've scheduled",
}

export default function RemindersClient({ initialData, initialMessage, companies = [] }: {
  initialData?: { reminders: Reminder[]; scope: 'all' | 'company' | 'mine' }
  initialMessage?: string
  companies?: Array<{ id: string; name: string }>
}) {
  const [reminders, setReminders] = useState<Reminder[]>(initialData?.reminders ?? [])
  const [scope, setScope] = useState<'all' | 'company' | 'mine'>(initialData?.scope ?? 'mine')
  const [loading, setLoading] = useState(!initialData && !initialMessage)
  const [msg, setMsg] = useState(initialMessage ?? '')
  const [busyId, setBusyId] = useState<string | null>(null)
  const companyFilter = useReminderCompanyFilter()
  const companyId = companyFilter?.companyId ?? 'all'
  const setCompanyId = companyFilter?.setCompanyId

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
      setReminders((prev) => prev.map((r) => (r.id === id ? { ...r, done: true, completedAt: res.completedAt ?? new Date().toISOString() } : r)))
      window.dispatchEvent(new CustomEvent('reminders:changed'))
    } else {
      setMsg(res.message ?? 'Could not update reminder.')
    }
    setBusyId(null)
  }

  if (loading) return <p className="subtle">Loading…</p>
  if (msg && reminders.length === 0) return <p className="subtle">{msg}</p>

  const visibleReminders = scope === 'all' && companyId !== 'all'
    ? reminders.filter((reminder) => reminder.companyId === companyId)
    : reminders
  const availableCompanies = companyFilter?.companies ?? companies
  const selectedCompany = availableCompanies.find((company) => company.id === companyId)
  const showAgentCol = scope !== 'mine'
  const showCompanyCol = scope === 'all' && companyId === 'all'

  const now = new Date()
  const active = visibleReminders.filter((r) => !r.done)
  const overdue = active.filter((r) => new Date(r.remindAt) < now)
  const upcoming = active.filter((r) => new Date(r.remindAt) >= now)
  const completedOverdue = visibleReminders.filter((r) => r.done && r.completedAt && +new Date(r.completedAt) > +new Date(r.remindAt))
    .sort((a, b) => +new Date(b.completedAt ?? b.remindAt) - +new Date(a.completedAt ?? a.remindAt))
  const completed = visibleReminders.filter((r) => r.done && (!r.completedAt || +new Date(r.completedAt) <= +new Date(r.remindAt)))
    .sort((a, b) => +new Date(b.completedAt ?? b.remindAt) - +new Date(a.completedAt ?? a.remindAt))

  const renderTable = (rows: Reminder[], emptyMsg: string, completedView = false) => (
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
              {completedView && <th>Completed At</th>}
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
                    <Link prefetch={false} href={`/practice/${r.practiceCode}`}>{r.practiceName}</Link>
                  )}
                </td>
                {showAgentCol && <td>{r.agentName ?? '—'}</td>}
                {showCompanyCol && <td>{r.companyName ?? '—'}</td>}
                <td>{r.note ?? '—'}</td>
                {completedView && <td style={{ fontSize: 12 }}>{r.completedAt ? new Date(r.completedAt).toLocaleString() : 'Completed previously'}</td>}
                <td>
                  {completedView ? <span className="badge badge-green">✓ Complete</span> : <button
                    onClick={() => handleDone(r.id)}
                    disabled={busyId === r.id}
                    className="lead-quickbtn"
                    style={{ opacity: busyId === r.id ? 0.6 : 1 }}
                    title="Mark this reminder done"
                  >
                    ✓ Done
                  </button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  )

  return (
    <div className="reminders-workspace">
      <div className="reminders-toolbar" aria-label="Reminder view controls">
        <div>
          <strong>{selectedCompany ? selectedCompany.name : scope === 'all' ? 'All companies' : 'Reminder schedule'}</strong>
          <span>Showing follow-ups and callbacks {selectedCompany ? `for ${selectedCompany.name}` : SCOPE_LABEL[scope]}.</span>
        </div>
        {scope === 'all' && (
          <label className="reminders-company-filter">
            <span>Company</span>
            <select value={companyId} onChange={(event) => setCompanyId?.(event.target.value)}>
              <option value="all">All companies</option>
              {availableCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="card page-anchor" id="overdue">
        <h2 className="h-section" style={{ color: 'var(--danger)' }}>Overdue ({overdue.length})</h2>
        {renderTable(overdue, 'Nothing overdue.')}
      </div>
      <div className="card page-anchor" id="upcoming">
        <h2 className="h-section" style={{ color: 'var(--warn)' }}>Upcoming ({upcoming.length})</h2>
        {renderTable(upcoming, 'No upcoming reminders.')}
      </div>
      <div className="card page-anchor" id="completed">
        <h2 className="h-section" style={{ color: 'var(--ok)' }}>Completed ({completed.length})</h2>
        {renderTable(completed, 'No completed reminders yet.', true)}
      </div>
      <div className="card page-anchor" id="completed-overdue">
        <h2 className="h-section" style={{ color: 'var(--danger)' }}>Completed Overdue ({completedOverdue.length})</h2>
        {renderTable(completedOverdue, 'No overdue reminders have been completed yet.', true)}
      </div>
    </div>
  )
}
