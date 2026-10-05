'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getMyAssignmentSummary,
  getAssignedLeads,
  unassignLead,
  getMyIncomingCodes,
} from '../manage-assignments-actions'

type Person = { id: string; full_name: string; role: string; count: number }
type Lead = { practiceId: string; practiceCode: string; name: string; state: string | null; specialty: string | null; assignedAt: string; canRemove: boolean }
const PAGE_SIZES = [10, 25, 50, 100] as const

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function assignedDateKey(value: string): string | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : localDateKey(date)
}

// When the page already fetched this server-side (the normal case now),
// initialData arrives pre-populated and the component renders immediately
// — no loading state, no client-side fetch. Falls back to the original
// client-side fetch (now running its two independent requests together
// instead of one after another) if ever rendered without initialData.
export default function AssignmentsClient({ initialData, companyWide = false }: {
  initialData?: { summary: { ok: boolean; message?: string; people?: Person[] }; incomingCodes: string[] }
  companyWide?: boolean
} = {}) {
  const [people, setPeople] = useState<Person[]>(initialData?.summary.ok ? (initialData.summary.people ?? []) : [])
  const [selected, setSelected] = useState<string>('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(!initialData)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [leadError, setLeadError] = useState('')
  const [query, setQuery] = useState('')
  const [assignedDate, setAssignedDate] = useState('')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState(initialData && !initialData.summary.ok ? (initialData.summary.message ?? 'Could not load assignments.') : '')
  const [incoming, setIncoming] = useState<Set<string>>(new Set(initialData?.incomingCodes ?? []))
  const requestId = useRef(0)

  // Load the assignment summary and leads received from higher in the hierarchy.
  useEffect(() => {
    if (initialData) return // already have it — no client-side fetch needed
    (async () => {
      setLoading(true)
      // These two are independent of each other — run them together
      // instead of one waiting on the other.
      const [res, codes] = await Promise.all([getMyAssignmentSummary(), getMyIncomingCodes()])
      if (res.ok && res.people) setPeople(res.people)
      else setMsg(res.message ?? 'Could not load assignments.')
      setIncoming(new Set(codes))
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickPerson = async (id: string) => {
    const currentRequest = ++requestId.current
    setSelected(id)
    setLeads([])
    setLeadError('')
    setMsg('')
    setQuery('')
    setAssignedDate('')
    setPage(1)
    setLoadingLeads(true)
    const res = await getAssignedLeads(id)
    if (currentRequest !== requestId.current) return
    if (res.ok && res.leads) setLeads(res.leads)
    else setLeadError(res.message ?? 'Could not load leads.')
    setLoadingLeads(false)
  }

  const remove = async (practiceId: string) => {
    const lead = leads.find((item) => item.practiceId === practiceId && item.canRemove)
    if (!lead) return
    const res = await unassignLead(lead.practiceId, selected)
    setMsg(res.message)
    if (res.ok) {
      setLeads((prev) => prev.filter((item) => item.practiceId !== lead.practiceId))
      setPeople((prev) => prev.map((p) => p.id === selected ? { ...p, count: Math.max(0, p.count - 1) } : p))
    }
  }

  const filteredLeads = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return leads.filter((lead) => {
      const matchesSearch = !needle || [lead.practiceCode, lead.name, lead.state, lead.specialty]
        .some((value) => String(value ?? '').toLowerCase().includes(needle))
      const matchesDate = !assignedDate || assignedDateKey(lead.assignedAt) === assignedDate
      return matchesSearch && matchesDate
    })
  }, [leads, query, assignedDate])
  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageLeads = filteredLeads.slice(pageStart, pageStart + pageSize)

  return (
    <>
      {loading ? (
        <p className="subtle">Loading…</p>
      ) : people.length === 0 ? (
        <p className="subtle">{companyWide ? 'No active leads are assigned in your company.' : 'You haven’t assigned any leads yet.'}</p>
      ) : (
        <div className="grid-2-sidebar-sm">
          {/* People list */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>{companyWide ? 'Company assignees' : 'My reports'}</div>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPerson(p.id)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selected === p.id ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${selected === p.id ? 'var(--accent)' : 'transparent'}`,
                  color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}
              >
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.role}</div>
                </span>
                <span className="badge badge-amber">{p.count}</span>
              </button>
            ))}
          </div>

          {/* Leads for selected person */}
          <div className="card">
            {!selected ? (
              <p className="subtle">Pick a person on the left to see their active assigned leads.</p>
            ) : loadingLeads ? (
              <p className="subtle">Loading assigned leads…</p>
            ) : leadError ? (
              <p className="subtle">{leadError}</p>
            ) : leads.length === 0 ? (
              <p className="subtle">No active leads are assigned to this person.</p>
            ) : (
              <>
                <div className="sheet-toolbar">
                  <div><strong>{filteredLeads.length} of {leads.length} active leads</strong><span>{companyWide ? 'Company-wide assignment view' : 'Assigned by you'}</span></div>
                  <div className="sheet-toolbar-controls">
                    <label className="sheet-page-size"><span>Assigned date</span><input className="sheet-date-input" type="date" aria-label="Choose assignment date" value={assignedDate} onChange={(event) => { setAssignedDate(event.target.value); setPage(1) }} /></label>
                    <label className="sheet-page-size"><span>Rows</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                    <label className="sheet-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search assigned leads…" /></label>
                  </div>
                </div>
                {filteredLeads.length === 0 ? (
                  <p className="subtle" style={{ padding: 12 }}>No leads match the selected filters.</p>
                ) : (
                  <>
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Practice</th>
                            <th>State</th>
                            <th>Specialty</th>
                            <th>Assigned</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageLeads.map((lead) => (
                            <tr key={lead.practiceId}>
                              <td style={{ fontWeight: 600 }}>
                                {!companyWide && incoming.has(lead.practiceCode) && (
                                  <span title="Also assigned to you by your manager" style={{ color: 'var(--warn)', marginRight: 6 }}>★</span>
                                )}
                                <Link prefetch={false} href={`/practice/${lead.practiceCode}`}>{lead.name}</Link>
                              </td>
                              <td>{lead.state ?? '—'}</td>
                              <td>{lead.specialty ?? '—'}</td>
                              <td>{new Date(lead.assignedAt).toLocaleString()}</td>
                              <td style={{ textAlign: 'right' }}>
                                {lead.canRemove ? (
                                  <button
                                    onClick={() => remove(lead.practiceId)}
                                    style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                                  >
                                    Remove
                                  </button>
                                ) : <span className="subtle">View only</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="sheet-pagination">
                      <span>Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filteredLeads.length)} of {filteredLeads.length}</span>
                      <div>
                        <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                        <span>Page {safePage} of {totalPages}</span>
                        <button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {msg && <p className="subtle" style={{ marginTop: 16 }}>{msg}</p>}
    </>
  )
}
