'use client'

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react' // ← CHANGED: + Fragment
import { getReminders, markReminderDone, getLeadNotes, type Reminder, type LeadNote, type LeadCallback } from '../reminders-actions' // ← CHANGED
import { useReminderCompanyFilter } from './ReminderCompanyFilter'
import { leadHref } from '../../lib/lead-return'

// ← ADDED: rows drawn per section at first. Counts in the headings stay
// exact; "Show more" draws the next rows. Drawing hundreds of completed
// reminders at once was what made this page slow as history grew.
const ROWS_PER_STEP = 25

// ← ADDED: a lead's work history — every saved call note with its date, plus
// each callback that was set and what happened to it. Loaded when opened.
function LeadHistory({ reminderId }: { reminderId: string }) {
  const [state, setState] = useState<{ notes: LeadNote[]; callbacks: LeadCallback[]; loadedAt: number } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    getLeadNotes(reminderId).then((res) => {
      if (cancelled) return
      if (res.ok) setState({ notes: res.notes ?? [], callbacks: res.callbacks ?? [], loadedAt: Date.now() })
      else setError(res.message ?? 'Could not load the history.')
    }).catch(() => { if (!cancelled) setError('Could not load the history.') })
    return () => { cancelled = true }
  }, [reminderId])

  if (error) return <p className="subtle" style={{ fontSize: 12, margin: 0 }}>{error}</p>
  if (!state) return <p className="subtle" role="status" style={{ fontSize: 12, margin: 0 }}>Loading history…</p>
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
  const callbackStatus = (c: LeadCallback) => {
    if (!c.done) return new Date(c.remindAt).getTime() < state.loadedAt ? 'Overdue' : 'Upcoming'
    if (!c.completedAt) return 'Completed'
    return new Date(c.completedAt).getTime() > new Date(c.remindAt).getTime() ? 'Completed late / replaced late' : 'Completed / replaced on time'
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, fontSize: 12 }}>
      <div>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Call notes ({state.notes.length})</div>
        {state.notes.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No call notes saved yet.</p> : (
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {state.notes.map((n, i) => (
              <li key={i}>
                <div><strong>{fmt(n.at)}</strong>{n.disposition ? ` · ${n.disposition}` : ''}{n.by ? ` · ${n.by}` : ''}</div>
                {n.note && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{n.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Callbacks ({state.callbacks.length})</div>
        {state.callbacks.length === 0 ? <p className="subtle" style={{ margin: 0 }}>No callbacks set.</p> : (
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {state.callbacks.map((c, i) => (
              <li key={i}>
                <div><strong>{fmt(c.remindAt)}</strong> · {callbackStatus(c)}</div>
                <div className="subtle">Set {fmt(c.setAt)}{c.by ? ` by ${c.by}` : ''}{c.completedAt ? ` · closed ${fmt(c.completedAt)}` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

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
  const [shown, setShown] = useState<Record<string, number>>({}) // ← ADDED: rows shown per section
  const [historyFor, setHistoryFor] = useState<string | null>(null) // ← ADDED: reminder whose history is open
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

  const renderTable = (section: string, allRows: Reminder[], emptyMsg: string, completedView = false) => { // ← CHANGED: + section, row limit
    const limit = shown[section] ?? ROWS_PER_STEP
    const rows = allRows.slice(0, limit)
    const hidden = allRows.length - rows.length
    return allRows.length === 0 ? <p className="subtle">{emptyMsg}</p> : (<>
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
              <Fragment key={r.id}>{/* ← CHANGED: row + optional history row */}
              <tr>
                <td style={{ fontSize: 12 }}>{new Date(r.remindAt).toLocaleString()}</td>
                <td>
                  {r.practiceDeleted ? (
                    <span className="subtle" title="This lead was permanently deleted">{r.practiceName}</span>
                  ) : (
                    <Link prefetch={false} href={leadHref(r.practiceCode, 'reminders')}>{r.practiceName}</Link>
                  )}
                  {/* ← ADDED */}
                  <button type="button" onClick={() => setHistoryFor(historyFor === r.id ? null : r.id)} aria-expanded={historyFor === r.id}
                    style={{ display: 'block', marginTop: 3, border: 0, background: 'none', padding: 0, fontSize: 11, fontWeight: 700, color: 'var(--accent-dark, #0f766e)', cursor: 'pointer' }}>
                    {historyFor === r.id ? 'Hide notes & history' : 'View notes & history'}
                  </button>
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
              {/* ← ADDED */}
              {historyFor === r.id && (
                <tr>
                  <td colSpan={4 + (showAgentCol ? 1 : 0) + (showCompanyCol ? 1 : 0) + (completedView ? 1 : 0)} style={{ background: 'var(--surface-2, #f6f9fa)' }}>
                    <LeadHistory reminderId={r.id} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* ← ADDED */}
      {hidden > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 10 }}>
          <span className="subtle" style={{ fontSize: 12 }}>Showing {rows.length} of {allRows.length}</span>
          <button type="button" className="btn" onClick={() => setShown((prev) => ({ ...prev, [section]: limit + ROWS_PER_STEP }))}>
            Show {Math.min(ROWS_PER_STEP, hidden)} more
          </button>
          <button type="button" className="btn" onClick={() => setShown((prev) => ({ ...prev, [section]: allRows.length }))}>Show all</button>
        </div>
      )}
    </>)
  }

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
        {renderTable('overdue', overdue, 'Nothing overdue.')}
      </div>
      <div className="card page-anchor" id="upcoming">
        <h2 className="h-section" style={{ color: 'var(--warn)' }}>Upcoming ({upcoming.length})</h2>
        {renderTable('upcoming', upcoming, 'No upcoming reminders.')}
      </div>
      <div className="card page-anchor" id="completed">
        <h2 className="h-section" style={{ color: 'var(--ok)' }}>Completed ({completed.length})</h2>
        {renderTable('completed', completed, 'No completed reminders yet.', true)}
      </div>
      <div className="card page-anchor" id="completed-overdue">
        <h2 className="h-section" style={{ color: 'var(--danger)' }}>Completed Overdue ({completedOverdue.length})</h2>
        {renderTable('completed-overdue', completedOverdue, 'No overdue reminders have been completed yet.', true)}
      </div>
    </div>
  )
}
