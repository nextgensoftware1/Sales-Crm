'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, CalendarDays, Download, Filter, Search, Wallet, XCircle } from 'lucide-react'
import type { KpiCredit } from '../kpi-actions'

type Initial = { ok: boolean; message?: string; available: boolean; scope: 'own' | 'team'; credits: KpiCredit[]; isSuperAdmin: boolean }

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
/** Calendar month key in the viewer's own time zone, e.g. "2026-10". */
const monthKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
const PAGE_SIZES = [20, 50, 100]

type Totals = { count: number; amount: number }
// Earnings count verified transfers only (a rejected one earns nothing).
const sum = (rows: KpiCredit[]): Totals => {
  const verified = rows.filter((r) => r.status !== 'rejected')
  return { count: verified.length, amount: verified.reduce((t, r) => t + r.amount, 0) }
}

export default function KpiClient({ initial }: { initial: Initial }) {
  const team = initial.scope === 'team'
  const superAdmin = initial.isSuperAdmin
  // "This month" and month labels depend on the viewer's time zone, so they
  // are worked out in the browser after it loads.
  const [thisMonth, setThisMonth] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setThisMonth(monthKey(new Date().toISOString())), 0)
    return () => window.clearTimeout(id)
  }, [])

  const [period, setPeriod] = useState('all')
  const [company, setCompany] = useState('')
  const [agent, setAgent] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'verified' | 'rejected'>('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const credits = initial.credits
  const companies = useMemo(() => Array.from(new Map(credits.filter((c) => c.tenantId).map((c) => [c.tenantId as string, c.companyName ?? 'Unknown company'])))
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [credits])
  const agentKey = (c: KpiCredit) => c.agentId ?? `name:${c.agentName ?? ''}`
  const agents = useMemo(() => Array.from(new Map(credits.filter((c) => !company || c.tenantId === company).map((c) => [agentKey(c), c.agentName ?? 'Unknown agent'])))
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [credits, company])
  const months = useMemo(() => thisMonth ? Array.from(new Set([thisMonth, ...credits.map((c) => monthKey(c.verifiedAt))])).sort().reverse() : [], [credits, thisMonth])

  // Company / agent / search narrow everything; the period only narrows the record list.
  const scoped = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return credits.filter((c) => {
      if (company && c.tenantId !== company) return false
      if (agent && agentKey(c) !== agent) return false
      if (status && c.status !== status) return false
      if (needle && ![c.agentName, c.practiceName, c.practiceCode, c.verifiedByName, c.companyName, c.note]
        .some((v) => v && v.toLowerCase().includes(needle))) return false
      return true
    })
  }, [credits, company, agent, search, status])
  const filtered = useMemo(() => (period === 'all' ? scoped : scoped.filter((c) => monthKey(c.verifiedAt) === period)), [scoped, period])

  const monthTotals = useMemo(() => sum(thisMonth ? scoped.filter((c) => monthKey(c.verifiedAt) === thisMonth) : []), [scoped, thisMonth])
  const allTotals = useMemo(() => sum(scoped), [scoped])
  const shownTotals = useMemo(() => sum(filtered), [filtered])
  const byAgent = useMemo(() => {
    const map = new Map<string, { name: string; company: string | null; totals: Totals; rejected: number }>()
    for (const c of filtered) {
      const key = agentKey(c)
      const row = map.get(key) ?? { name: c.agentName ?? 'Unknown agent', company: c.companyName, totals: { count: 0, amount: 0 }, rejected: 0 }
      if (c.status === 'rejected') row.rejected += 1
      else row.totals = { count: row.totals.count + 1, amount: row.totals.amount + c.amount }
      map.set(key, row)
    }
    return Array.from(map.values()).sort((a, b) => b.totals.amount - a.totals.amount || a.name.localeCompare(b.name))
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const pageRows = filtered.slice(start, start + pageSize)
  const activeFilters = [period !== 'all', !!company, !!agent, !!status, !!search.trim()].filter(Boolean).length
  const reset = () => { setPeriod('all'); setCompany(''); setAgent(''); setStatus(''); setSearch(''); setPage(1) }
  const rejectedShown = filtered.filter((c) => c.status === 'rejected').length
  const periodName = period === 'all' ? 'All time' : monthLabel(period)

  const downloadCsv = () => {
    const header = ['Reviewed on', 'Status', 'Agent', 'Lead', 'Lead code', ...(superAdmin ? ['Company'] : []), 'Reviewed by', 'Note', 'Amount', 'Currency']
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [header, ...filtered.map((c) => [new Date(c.verifiedAt).toLocaleString(), c.status === 'rejected' ? 'Rejected' : 'Verified', c.agentName, c.practiceName, c.practiceCode,
      ...(superAdmin ? [c.companyName] : []), c.verifiedByName, c.note ?? '', c.amount, c.currency])].map((row) => row.map(cell).join(','))
    const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `kpi-records-${period === 'all' ? 'all-time' : period}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  if (!initial.ok) return <div className="card"><p className="subtle">{initial.message ?? 'Could not load KPI records.'}</p></div>
  if (!initial.available) return <div className="card"><p className="subtle">Transfer KPI isn&apos;t set up yet. Run <code>database/transfer-kpi.sql</code> in Supabase.</p></div>

  return (
    <div className="kpi-page">
      <div className="kpi-page-stats">
        <div className="kpi-panel-stat">
          <span className="kpi-panel-stat-icon"><CalendarDays size={16} aria-hidden="true" /></span>
          <div><span>{thisMonth ? monthLabel(thisMonth) : 'This month'}</span><strong>{pkr(monthTotals.amount)}</strong><small>{monthTotals.count} verified transfer{monthTotals.count === 1 ? '' : 's'}</small></div>
        </div>
        <div className="kpi-panel-stat">
          <span className="kpi-panel-stat-icon"><Wallet size={16} aria-hidden="true" /></span>
          <div><span>All-time</span><strong>{pkr(allTotals.amount)}</strong><small>{allTotals.count} verified transfer{allTotals.count === 1 ? '' : 's'}</small></div>
        </div>
        <div className="kpi-panel-stat">
          <span className="kpi-panel-stat-icon"><Filter size={16} aria-hidden="true" /></span>
          <div><span>Showing · {periodName}</span><strong>{pkr(shownTotals.amount)}</strong><small>{shownTotals.count} verified{rejectedShown ? ` · ${rejectedShown} rejected` : ''}</small></div>
        </div>
      </div>

      <div className="card kpi-page-filters">
        <label className="filter-control kpi-page-search"><span>Search</span>
          <div className="kpi-search-box">
            <Search size={15} aria-hidden="true" />
            <input type="search" className="input" aria-label="Search KPI records" placeholder={team ? 'Agent, lead, NPI, verifier…' : 'Lead, NPI, verifier…'}
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
        </label>
        <label className="filter-control"><span>Period</span>
          <select className="input" aria-label="Period" value={period} onChange={(e) => { setPeriod(e.target.value); setPage(1) }}>
            <option value="all">All time</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === thisMonth ? ' (this month)' : ''}</option>)}
          </select>
        </label>
        <label className="filter-control"><span>Status</span>
          <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'verified' | 'rejected'); setPage(1) }}>
            <option value="">Verified &amp; rejected</option>
            <option value="verified">Verified only</option>
            <option value="rejected">Rejected only</option>
          </select>
        </label>
        {superAdmin && (
          <label className="filter-control"><span>Company</span>
            <select className="input" aria-label="Company" value={company} onChange={(e) => { setCompany(e.target.value); setAgent(''); setPage(1) }}>
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {team && (
          <label className="filter-control"><span>Agent</span>
            <select className="input" aria-label="Agent" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1) }}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <div className="kpi-page-filter-actions">
          {activeFilters > 0 && <button type="button" className="btn" onClick={reset}>Clear filters ({activeFilters})</button>}
          <button type="button" className="btn" onClick={downloadCsv} disabled={!filtered.length}><Download size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />Download CSV</button>
        </div>
      </div>

      {team && byAgent.length > 0 && (
        <section className="card">
          <h3 className="kpi-page-h3">By agent · {periodName}</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Agent</th>{superAdmin && <th>Company</th>}<th>Verified</th><th>Rejected</th><th>KPI earned</th></tr></thead>
              <tbody>{byAgent.map((a) => (
                <tr key={`${a.name}|${a.company}`}>
                  <td><strong>{a.name}</strong></td>{superAdmin && <td>{a.company ?? '—'}</td>}
                  <td>{a.totals.count}</td><td>{a.rejected || <span className="subtle">0</span>}</td><td><strong>{pkr(a.totals.amount)}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h3 className="kpi-page-h3">KPI records · {periodName}</h3>
        {credits.length === 0 ? (
          <p className="subtle">No verified transfers yet. When a closer, manager or company admin verifies a transfer on the <Link href="/transfers">Transfers</Link> page, it appears here.</p>
        ) : filtered.length === 0 ? (
          <p className="subtle">No KPI records match these filters. <button type="button" className="report-practice-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={reset}>Clear filters</button></p>
        ) : (
          <>
            <div className="tbl-wrap">
              <table className="tbl kpi-records-table">
                <thead><tr><th>Reviewed on</th>{team && <th>Agent</th>}<th>Lead</th>{superAdmin && <th>Company</th>}<th>Reviewed by</th><th>Note</th><th style={{ textAlign: 'right' }}>KPI</th></tr></thead>
                <tbody>{pageRows.map((c, i) => (
                  <tr key={`${c.practiceCode}|${c.verifiedAt}|${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(c.verifiedAt)}</td>
                    {team && <td><strong>{c.agentName ?? '—'}</strong></td>}
                    <td><strong>{c.practiceName ?? '—'}</strong><div className="subtle mono" style={{ fontSize: 10.5 }}>{c.practiceCode ?? ''}</div></td>
                    {superAdmin && <td>{c.companyName ?? '—'}</td>}
                    <td>{c.verifiedByName ?? '—'}</td>
                    <td className="kpi-note-cell">{c.note ? <span title={c.note}>{c.note}</span> : <span className="subtle">—</span>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{c.status === 'rejected'
                      ? <span className="kpi-rejected"><XCircle size={14} aria-hidden="true" /> Rejected</span>
                      : <span className="kpi-verified"><BadgeCheck size={14} aria-hidden="true" /> +{c.currency} {c.amount.toLocaleString()}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="kpi-page-pagination">
              <span className="subtle">Showing {start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}</span>
              <div>
                <label className="subtle" style={{ fontSize: 12 }}>Rows&nbsp;
                  <select className="input" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                </label>
                <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
                <span className="subtle" style={{ fontSize: 12 }}>Page {safePage} of {totalPages}</span>
                <button type="button" className="btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
