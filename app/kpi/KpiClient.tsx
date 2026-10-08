'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, Building2, CalendarDays, ChevronRight, Download, Filter, Search, Wallet, XCircle } from 'lucide-react'
import type { KpiCredit } from '../kpi-actions'
import { useKpiCompany } from '../../lib/kpi-company-store'

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

export default function KpiClient({ initial, allCompanies = [] }: { initial: Initial; allCompanies?: { id: string; name: string }[] }) {
  const team = initial.scope === 'team'
  const superAdmin = initial.isSuperAdmin
  // "This month" and month labels depend on the viewer's time zone, so they
  // are worked out in the browser after it loads.
  const [thisMonth, setThisMonth] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => setThisMonth(monthKey(new Date().toISOString())), 0)
    return () => window.clearTimeout(id)
  }, [])

  // Verified-on range: From / To date + time in the viewer's local time
  // (same as Worksheet Reports). Empty = open-ended; "To" includes its minute.
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const fromMs = rangeFrom ? new Date(rangeFrom).getTime() : null
  const toMs = rangeTo ? new Date(rangeTo).getTime() + 59_999 : null
  const rangeReversed = fromMs !== null && toMs !== null && fromMs > toMs
  // Shared with the company list in the left KPI panel (KpiCompanyNav).
  const [company, setCompany] = useKpiCompany()
  // A user pick belongs to the company it was made under, so switching
  // company (here or in the left panel) clears it for good.
  const [agentPick, setAgentPick] = useState<{ id: string; company: string }>({ id: '', company: '' })
  const setAgent = (id: string) => setAgentPick({ id, company })
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'verified' | 'rejected'>('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const credits = initial.credits
  // Every company (also those with no KPI yet), so the dropdown always matches the left panel.
  const companies = useMemo(() => Array.from(new Map([
    ...allCompanies.map((c) => [c.id, c.name] as [string, string]),
    ...credits.filter((c) => c.tenantId).map((c) => [c.tenantId as string, c.companyName ?? 'Unknown company'] as [string, string]),
  ])).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [credits, allCompanies])
  const agentKey = (c: KpiCredit) => c.agentId ?? `name:${c.agentName ?? ''}`
  const agents = useMemo(() => Array.from(new Map(credits.filter((c) => !company || c.tenantId === company).map((c) => [agentKey(c), c.agentName ?? 'Unknown agent'])))
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [credits, company])
  // A chosen user only applies while they belong to the selected company
  // (e.g. after picking a different company in the left panel).
  const agent = agentPick.company === company && agents.some((a) => a.id === agentPick.id) ? agentPick.id : ''

  // Company / agent / search narrow everything; the date range only narrows the record list.
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
  const filtered = useMemo(() => (fromMs === null && toMs === null ? scoped : scoped.filter((c) => {
    const at = new Date(c.verifiedAt).getTime()
    return (fromMs === null || at >= fromMs) && (toMs === null || at <= toMs)
  })), [scoped, fromMs, toMs])

  const monthTotals = useMemo(() => sum(thisMonth ? scoped.filter((c) => monthKey(c.verifiedAt) === thisMonth) : []), [scoped, thisMonth])
  const allTotals = useMemo(() => sum(scoped), [scoped])
  const shownTotals = useMemo(() => sum(filtered), [filtered])
  // Super Admin drill-down: companies → users → records (click a row).
  const byCompany = useMemo(() => {
    const map = new Map<string, { id: string; name: string; totals: Totals; rejected: number; agents: Set<string> }>()
    for (const c of filtered) {
      const id = c.tenantId ?? ''
      const row = map.get(id) ?? { id, name: c.companyName ?? 'Unknown company', totals: { count: 0, amount: 0 }, rejected: 0, agents: new Set<string>() }
      if (c.status === 'rejected') row.rejected += 1
      else row.totals = { count: row.totals.count + 1, amount: row.totals.amount + c.amount }
      row.agents.add(agentKey(c))
      map.set(id, row)
    }
    return Array.from(map.values()).sort((a, b) => b.totals.amount - a.totals.amount || a.name.localeCompare(b.name))
  }, [filtered])
  const byAgent = useMemo(() => {
    const map = new Map<string, { key: string; name: string; company: string | null; totals: Totals; rejected: number }>()
    for (const c of filtered) {
      const key = agentKey(c)
      const row = map.get(key) ?? { key, name: c.agentName ?? 'Unknown agent', company: c.companyName, totals: { count: 0, amount: 0 }, rejected: 0 }
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
  const activeFilters = [!!(rangeFrom || rangeTo), !!company, !!agent, !!status, !!search.trim()].filter(Boolean).length
  const reset = () => { setRangeFrom(''); setRangeTo(''); setCompany(''); setAgent(''); setStatus(''); setSearch(''); setPage(1) }
  const rejectedShown = filtered.filter((c) => c.status === 'rejected').length
  const fmtPick = (v: string) => new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const periodName = rangeFrom && rangeTo ? `${fmtPick(rangeFrom)} – ${fmtPick(rangeTo)}`
    : rangeFrom ? `From ${fmtPick(rangeFrom)}` : rangeTo ? `Until ${fmtPick(rangeTo)}` : 'All time'

  const downloadCsv = () => {
    const header = ['Reviewed on', 'Status', 'Agent', 'Lead', 'Lead code', ...(superAdmin ? ['Company'] : []), 'Reviewed by', 'Note', 'Amount', 'Currency']
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [header, ...filtered.map((c) => [new Date(c.verifiedAt).toLocaleString(), c.status === 'rejected' ? 'Rejected' : 'Verified', c.agentName, c.practiceName, c.practiceCode,
      ...(superAdmin ? [c.companyName] : []), c.verifiedByName, c.note ?? '', c.amount, c.currency])].map((row) => row.map(cell).join(','))
    const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `kpi-records-${rangeFrom || rangeTo ? `${rangeFrom.slice(0, 10) || 'start'}_to_${rangeTo.slice(0, 10) || 'now'}` : 'all-time'}.csv`
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
        <div className="filter-control kpi-range"><span>Verified on (from – to)</span>
          <div className="kpi-range-inputs">
            <input type="datetime-local" className="input" aria-label="Verified from date and time" value={rangeFrom} max={rangeTo || undefined}
              onChange={(e) => { setRangeFrom(e.target.value); setPage(1) }} />
            <span className="subtle">to</span>
            <input type="datetime-local" className="input" aria-label="Verified to date and time" value={rangeTo} min={rangeFrom || undefined}
              onChange={(e) => { setRangeTo(e.target.value); setPage(1) }} />
          </div>
          {rangeReversed && <small role="alert" style={{ color: 'var(--danger)', fontSize: 11, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>“From” is after “To” — no records can match.</small>}
        </div>
        <label className="filter-control"><span>Status</span>
          <select className="input" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'verified' | 'rejected'); setPage(1) }}>
            <option value="">Verified &amp; rejected</option>
            <option value="verified">Verified only</option>
            <option value="rejected">Rejected only</option>
          </select>
        </label>
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

      {superAdmin && !company && !agent && byCompany.length > 0 && (
        <section className="card">
          <h3 className="kpi-page-h3">By company · {periodName}</h3>
          <p className="subtle" style={{ margin: '-6px 0 10px', fontSize: 12 }}>Click a company to see its users with KPI.</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Company</th><th>Users with KPI</th><th>Verified</th><th>Rejected</th><th>KPI earned</th><th aria-label="Open" /></tr></thead>
              <tbody>{byCompany.map((co) => (
                <tr key={co.id} className="kpi-group-row" tabIndex={0} role="button" aria-label={`Show ${co.name}`}
                  onClick={() => { setCompany(co.id); setAgent(''); setPage(1) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCompany(co.id); setAgent(''); setPage(1) } }}>
                  <td><strong><Building2 size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-2px', color: 'var(--accent)' }} />{co.name}</strong></td>
                  <td>{co.agents.size}</td><td>{co.totals.count}</td><td>{co.rejected || <span className="subtle">0</span>}</td>
                  <td><strong>{pkr(co.totals.amount)}</strong></td>
                  <td style={{ textAlign: 'right' }}><ChevronRight size={16} aria-hidden="true" className="kpi-group-arrow" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {team && !agent && byAgent.length > 0 && (!superAdmin || !!company) && (
        <section className="card">
          <h3 className="kpi-page-h3">{superAdmin && company ? `${companies.find((c) => c.id === company)?.name ?? 'Company'} · users with KPI · ${periodName}` : `By agent · ${periodName}`}</h3>
          <p className="subtle" style={{ margin: '-6px 0 10px', fontSize: 12 }}>Click a user to see their KPI records.</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Agent</th>{superAdmin && <th>Company</th>}<th>Verified</th><th>Rejected</th><th>KPI earned</th><th aria-label="Open" /></tr></thead>
              <tbody>{byAgent.map((a) => (
                <tr key={`${a.key}|${a.company}`} className="kpi-group-row" tabIndex={0} role="button" aria-label={`Show ${a.name}`}
                  onClick={() => { setAgent(a.key); setPage(1) }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAgent(a.key); setPage(1) } }}>
                  <td><strong>{a.name}</strong></td>{superAdmin && <td>{a.company ?? '—'}</td>}
                  <td>{a.totals.count}</td><td>{a.rejected || <span className="subtle">0</span>}</td><td><strong>{pkr(a.totals.amount)}</strong></td>
                  <td style={{ textAlign: 'right' }}><ChevronRight size={16} aria-hidden="true" className="kpi-group-arrow" /></td>
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
