'use client'

// ← ADDED (new file) — table for the Email Sheet Report with filters
// (search, response, agent, date) and paging.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react' // ← CHANGED: + useSyncExternalStore
import { getEmailLeadHistory, type EmailReportRow, type EmailHistoryEntry } from '../email-worksheet-actions' // ← CHANGED
import { EMAIL_RESPONSES, emailResponseBadge } from '../../lib/email-leads'
import { npiLabel } from '../../lib/npi-label' // ← ADDED: show NPI instead of PR-
import { toCsv, toXlsx, downloadFile, type ExportTable } from '../../lib/export-file' // ← ADDED: download selected leads

// ← CHANGED: rows per page is now chosen on the page (was fixed at 25).
const PAGE_SIZES = [20, 40, 100, 200] as const

// ← ADDED: one key per row (the same lead can exist under two companies).
const rowKey = (r: EmailReportRow) => `${r.tenantId}:${r.practiceId}`

// ← ADDED: the downloaded file's columns (same idea as Active Call).
function exportTable(rows: EmailReportRow[]): ExportTable {
  return {
    headers: ['NPI', 'Practice', 'Response', 'Email', 'Note', 'State', 'Specialty', 'Agent', 'Company', 'Last Updated'],
    rows: rows.map((r) => [
      r.practiceCode.replace(/^PR-/i, ''), r.practiceName, r.response, r.email, r.note,
      r.state, r.specialty, r.agentName, r.companyName, new Date(r.updatedAt).toLocaleString(),
    ]),
  }
}

// ← ADDED: dates are shown in the viewer's own format and time zone, which
// the server can't know. Rendering them only in the browser avoids the
// "Hydration failed … text didn't match" warning (server 10/13/2026 vs
// browser 13/10/2026).
const noopSubscribe = () => () => {}
function LocalDateTime({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false)
  return <>{isClient ? new Date(iso).toLocaleString() : ''}</>
}

function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ← ADDED: read-only popup — everything saved on this email lead.
function EmailLeadPopup({ row, onClose }: { row: EmailReportRow; onClose: () => void }) {
  const [entries, setEntries] = useState<EmailHistoryEntry[] | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getEmailLeadHistory(row.practiceId, row.tenantId).then((res) => {
      if (cancelled) return
      if (res.ok) setEntries(res.entries)
      else setError(res.message)
    }).catch(() => { if (!cancelled) setError('Could not load the history.') })
    return () => { cancelled = true }
  }, [row.practiceId, row.tenantId])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus?.() }
  }, [onClose])

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const kv = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 32, 0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="email-popup-title" tabIndex={-1}
        style={{ width: 'min(760px, 100%)', background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 24px 60px rgba(10, 30, 45, 0.28)', outline: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 id="email-popup-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{row.practiceName}</h2>
            <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>{npiLabel(row.practiceCode)}{row.companyName ? ` · ${row.companyName}` : ''}</div>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: '14px 20px' }}>
          {kv('Email address', row.email || '—')}
          {kv('Response', <span className={emailResponseBadge(row.response)}>{row.response}</span>)}
          {kv('Note', row.note ? <span style={{ whiteSpace: 'pre-wrap' }}>{row.note}</span> : '—')}
          {kv('Saved by', row.agentName || '—')}
          {kv('Last updated', fmt(row.updatedAt))}
          {kv('State / Specialty', [row.state, row.specialty].filter(Boolean).join(' · ') || '—')}

          <h3 style={{ fontSize: 14, fontWeight: 800, margin: '18px 0 8px' }}>History{entries ? ` (${entries.length})` : ''}</h3>
          {error ? <p className="subtle" style={{ fontSize: 12 }}>{error}</p>
            : entries === null ? <p className="subtle" role="status" style={{ fontSize: 12 }}>Loading history…</p>
            : entries.length === 0 ? <p className="subtle" style={{ fontSize: 12 }}>No saves recorded.</p>
            : (
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {entries.map((h, i) => (
                  <li key={i} style={{ borderLeft: '3px solid var(--border)', paddingLeft: 10, fontSize: 13 }}>
                    <div><strong>{fmt(h.at)}</strong>{h.by ? ` · ${h.by}` : ''} · <span className={emailResponseBadge(h.response)}>{h.response}</span></div>
                    <div className="subtle" style={{ fontSize: 12, marginTop: 2 }}>{h.email || 'No email address'}</div>
                    {h.note && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{h.note}</div>}
                  </li>
                ))}
              </ol>
            )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <Link prefetch={false} href={`/practice/${row.practiceCode}?from=email-reports`} style={{ fontWeight: 700, fontSize: 13, alignSelf: 'center' }}>Open lead →</Link>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default function EmailReportsClient({ rows, truncated, showCompany }: {
  rows: EmailReportRow[]
  truncated: boolean
  showCompany: boolean
}) {
  const [search, setSearch] = useState('')
  const [response, setResponse] = useState('')
  const [agent, setAgent] = useState('')
  const [day, setDay] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(20) // ← ADDED
  const [viewKey, setViewKey] = useState<string | null>(null) // ← ADDED: row shown in the popup
  const viewRow = viewKey ? rows.find((r) => rowKey(r) === viewKey) ?? null : null
  const closeView = useCallback(() => setViewKey(null), [])

  // ← ADDED: selected leads (kept across pages and filters) + download.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((key: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  }), [])
  const setManySelected = useCallback((keys: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const k of keys) { if (on) next.add(k); else next.delete(k) }
    return next
  }), [])
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowKey(r))), [rows, selected])
  const download = (format: 'csv' | 'xlsx') => {
    if (!selectedRows.length) return
    const table = exportTable(selectedRows)
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') downloadFile(`active-email-${stamp}.csv`, toCsv(table), 'text/csv;charset=utf-8')
    else downloadFile(`active-email-${stamp}.xlsx`, toXlsx(table, 'Active Email'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }

  const agents = useMemo(() => Array.from(new Set(rows.map((r) => r.agentName).filter((v): v is string => !!v))).sort(), [rows])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(r.response, (map.get(r.response) ?? 0) + 1)
    return map
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) =>
      (!response || r.response === response) &&
      (!agent || r.agentName === agent) &&
      (!day || localDay(r.updatedAt) === day) &&
      (!q || r.practiceName.toLowerCase().includes(q) || r.practiceCode.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q)))
  }, [rows, search, response, agent, day])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)) // ← CHANGED: pageSize
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize // ← ADDED
  const shown = filtered.slice(pageStart, pageStart + pageSize) // ← CHANGED
  const pageKeys = shown.map(rowKey) // ← ADDED
  const pageAllSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k)) // ← ADDED
  const reset = (fn: () => void) => { fn(); setPage(1) }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {EMAIL_RESPONSES.map((r) => (
          <button key={r} type="button" onClick={() => reset(() => setResponse(response === r ? '' : r))} aria-pressed={response === r}
            className={emailResponseBadge(r)} style={{ cursor: 'pointer', border: response === r ? '2px solid currentColor' : '2px solid transparent', padding: '5px 10px', fontSize: 12 }}>
            {r} · {counts.get(r) ?? 0}
          </button>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
          <label className="filter-control" style={{ flex: '1 1 220px' }}><span>Search</span>
            <input className="input" type="search" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} placeholder="Practice, NPI or email" />
          </label>
          <label className="filter-control"><span>Response</span>
            <select className="input" value={response} onChange={(e) => reset(() => setResponse(e.target.value))}>
              <option value="">All responses</option>
              {EMAIL_RESPONSES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="filter-control"><span>Agent</span>
            <select className="input" value={agent} onChange={(e) => reset(() => setAgent(e.target.value))}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="filter-control"><span>Saved on</span>
            <input className="input" type="date" value={day} onChange={(e) => reset(() => setDay(e.target.value))} />
          </label>
          <span className="subtle" role="status" style={{ fontSize: 12, marginLeft: 'auto' }}>{filtered.length} of {rows.length} email leads</span>
        </div>

        {truncated && <p className="subtle" style={{ fontSize: 12 }}>Showing the 2,000 most recent email worksheets.</p>}

        {/* ← ADDED: download bar — same as Active Call */}
        {filtered.length > 0 && (
          <div role="region" aria-label="Download selected leads"
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: selected.size ? 'var(--surface-2)' : undefined }}>
            <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
            {filtered.some((r) => !selected.has(rowKey(r))) && (
              <button type="button" className="btn" onClick={() => setManySelected(filtered.map(rowKey), true)}>Select all {filtered.length} matching</button>
            )}
            {selected.size > 0 && <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button type="button" className="btn" disabled={!selected.size} onClick={() => download('csv')}>Download CSV</button>
              <button type="button" className="btn btn-primary" disabled={!selected.size} onClick={() => download('xlsx')}>Download Excel</button>
            </span>
          </div>
        )}

        {shown.length === 0 ? <p className="subtle">{rows.length === 0 ? 'No email worksheets saved yet.' : 'No email worksheets match these filters.'}</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>
              {/* ← ADDED: select every lead on this page */}
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Select all leads on this page" checked={pageAllSelected}
                  onChange={(e) => setManySelected(pageKeys, e.target.checked)} />
              </th>
              <th>Practice</th><th>State</th><th>Specialty</th><th>Email</th><th>Response</th><th>Agent</th>
              {showCompany && <th>Company</th>}
              <th>Last Updated</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={rowKey(r)}>
                  {/* ← ADDED: row checkbox */}
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.practiceName}`}
                      checked={selected.has(rowKey(r))} onChange={() => toggleSelect(rowKey(r))} />
                  </td>
                  <td>
                    {/* ← CHANGED: eye button opens the popup */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button type="button" onClick={() => setViewKey(rowKey(r))} aria-label={`View email work for ${r.practiceName}`} title="View email work"
                        style={{ flex: 'none', width: 28, height: 28, display: 'inline-grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--accent-dark, #0f766e)', cursor: 'pointer' }}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                      </button>
                      <Link prefetch={false} href={`/practice/${r.practiceCode}?from=email-reports`} style={{ fontWeight: 700 }}>{r.practiceName}</Link>
                    </div>
                    <div className="subtle" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{npiLabel(r.practiceCode)}</div>
                    {r.note && <div className="subtle" style={{ fontSize: 11, marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note}>{r.note}</div>}
                  </td>
                  <td>{r.state ?? '—'}</td>
                  <td>{r.specialty ?? '—'}</td>
                  <td>{r.email ?? '—'}</td>
                  <td><span className={emailResponseBadge(r.response)}>{r.response}</span></td>
                  <td>{r.agentName ?? '—'}</td>
                  {showCompany && <td>{r.companyName ?? '—'}</td>}
                  <td style={{ fontSize: 12 }}><LocalDateTime iso={r.updatedAt} /></td>{/* ← CHANGED */}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

        {/* ← CHANGED: rows-per-page choice + "Showing x–y of z", next to paging */}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <span className="subtle" style={{ fontSize: 12, marginRight: 'auto' }}>
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
            </span>
            <label className="report-page-size"><span>Rows per page</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            {totalPages > 1 && <>
              <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
              <span className="subtle" style={{ fontSize: 12 }}>Page {safePage} of {totalPages}</span>
              <button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</button>
            </>}
          </div>
        )}
      </div>

      {/* ← ADDED */}
      {viewRow && <EmailLeadPopup key={viewKey!} row={viewRow} onClose={closeView} />}
    </div>
  )
}
