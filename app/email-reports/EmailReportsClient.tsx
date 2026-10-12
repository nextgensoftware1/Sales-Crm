'use client'

// ← ADDED (new file) — table for the Email Sheet Report with filters
// (search, response, agent, date) and paging.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { EmailReportRow } from '../email-worksheet-actions'
import { EMAIL_RESPONSES, emailResponseBadge } from '../../lib/email-leads'

const PAGE_SIZE = 25

function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
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

        {shown.length === 0 ? <p className="subtle">{rows.length === 0 ? 'No email worksheets saved yet.' : 'No email worksheets match these filters.'}</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>
              <th>Practice</th><th>State</th><th>Specialty</th><th>Email</th><th>Response</th><th>Agent</th>
              {showCompany && <th>Company</th>}
              <th>Last Updated</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.tenantId}:${r.practiceId}`}>
                  <td>
                    <Link prefetch={false} href={`/practice/${r.practiceCode}`} style={{ fontWeight: 700 }}>{r.practiceName}</Link>
                    <div className="subtle" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{r.practiceCode}</div>
                    {r.note && <div className="subtle" style={{ fontSize: 11, marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note}>{r.note}</div>}
                  </td>
                  <td>{r.state ?? '—'}</td>
                  <td>{r.specialty ?? '—'}</td>
                  <td>{r.email ?? '—'}</td>
                  <td><span className={emailResponseBadge(r.response)}>{r.response}</span></td>
                  <td>{r.agentName ?? '—'}</td>
                  {showCompany && <td>{r.companyName ?? '—'}</td>}
                  <td style={{ fontSize: 12 }}>{new Date(r.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
            <span className="subtle" style={{ fontSize: 12 }}>Page {safePage} of {totalPages}</span>
            <button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
