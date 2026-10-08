'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react' // ← CHANGED: useRef instead of useMemo
import { Building2 } from 'lucide-react'
import { getCompanyAllocatedLeadsPage, getCompanyAllocationSummary } from '../manage-assignments-actions' // ← CHANGED: paged version
import WorkspacePanelToggle, { useWorkspacePanel } from '../WorkspacePanelToggle'

// ← ADDED: leads per page. The database returns one page at a time.
const PAGE_SIZE = 50

// ← ADDED: the chosen calendar day in the viewer's own time zone, as a UTC
// range [start of day, start of next day) — same day the old filter matched.
function dayRange(day: string): { fromIso: string; toIso: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  return { fromIso: new Date(y, m, d).toISOString(), toIso: new Date(y, m, d + 1).toISOString() }
}

type Company = { id: string; name: string; count: number }
type AllocatedLead = { practiceCode: string; name: string; state: string | null; specialty: string | null; allocatedAt: string; status: string }

// When the page already fetched this server-side (the normal case now),
// initialData arrives pre-populated and the component renders immediately
// — no loading state, no client-side fetch. Falls back to the original
// client-side fetch if ever rendered without initialData.
export default function CompanyAllocationsClient({ initialData }: {
  initialData?: { ok: boolean; message?: string; companies?: Company[] }
} = {}) {
  const [panelOpen, togglePanel] = useWorkspacePanel()
  const [companies, setCompanies] = useState<Company[]>(initialData?.ok ? (initialData.companies ?? []) : [])
  const [companyId, setCompanyId] = useState('')
  const [leads, setLeads] = useState<AllocatedLead[]>([])
  const [loading, setLoading] = useState(!initialData)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [msg, setMsg] = useState(initialData && !initialData.ok ? (initialData.message ?? 'Could not load company allocations.') : '')
  // "Allocated on" filter (calendar day in the viewer's time zone).
  const [dateFilter, setDateFilter] = useState('')
  // ← ADDED: server paging state.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const requestSeq = useRef(0)

  // ← ADDED: load one page for the chosen company / day / page number.
  const loadPage = async (id: string, nextPage: number, day: string) => {
    const seq = ++requestSeq.current
    setLoadingLeads(true)
    setMsg('')
    try {
      const range = day ? dayRange(day) : null
      const result = await getCompanyAllocatedLeadsPage({
        companyId: id, page: nextPage, pageSize: PAGE_SIZE,
        fromIso: range?.fromIso ?? null, toIso: range?.toIso ?? null,
      })
      if (seq !== requestSeq.current) return // a newer click replaced this one
      if (result.ok) {
        setLeads(result.leads ?? [])
        setTotal(result.total ?? 0)
        setPage(result.page ?? nextPage)
      } else {
        setLeads([]); setTotal(0)
        setMsg(result.message ?? 'Could not load allocated leads.')
      }
    } catch {
      if (seq === requestSeq.current) setMsg('Could not load allocated leads. Please try again.')
    } finally {
      if (seq === requestSeq.current) setLoadingLeads(false)
    }
  }

  useEffect(() => {
    if (initialData) return // already have it — no client-side fetch needed
    getCompanyAllocationSummary().then((result) => {
      if (result.ok) setCompanies(result.companies ?? [])
      else setMsg(result.message ?? 'Could not load company allocations.')
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickCompany = async (id: string) => { // ← CHANGED: loads page 1 only
    setCompanyId(id)
    setLeads([])
    setTotal(0)
    setMsg('')
    if (!id) return
    await loadPage(id, 1, dateFilter)
  }
  // ← ADDED
  const changeDay = (day: string) => {
    setDateFilter(day)
    if (companyId) void loadPage(companyId, 1, day)
  }
  const goToPage = (nextPage: number) => {
    if (companyId) void loadPage(companyId, nextPage, dateFilter)
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(page * PAGE_SIZE, total)

  const selectedCompany = companies.find((company) => company.id === companyId)
  return (
    <div className={'assigned-allocation-layout' + (panelOpen ? '' : ' panel-collapsed')}>
      <aside id="assigned-company-panel" className="assigned-company-nav" aria-label="Allocated lead companies">
        <WorkspacePanelToggle open={panelOpen} onToggle={togglePanel} panelId="assigned-company-panel" label="Assigned Leads" />
        <div className="assigned-company-nav-head">
          <span>Company queues</span>
          <h2>Assigned Leads</h2>
          <p>Select a company to review every lead allocated to it.</p>
        </div>
        <div className="assigned-company-list">
          {loading ? <p className="subtle">Loading companies…</p> : companies.map((company) => {
            const active = company.id === companyId
            return <button key={company.id} type="button" className={active ? 'active' : ''} onClick={() => pickCompany(company.id)} aria-pressed={active}>
              <Building2 size={15} strokeWidth={2} aria-hidden="true" />
              <span title={company.name}>{company.name}</span>
              <strong>{company.count}</strong>
            </button>
          })}
        </div>
      </aside>
      <section className="assigned-leads-workspace">
        <div className="card assigned-company-heading">
          <div><span>Company allocation</span><strong>{selectedCompany?.name ?? 'Choose one company'}</strong></div>
          {selectedCompany && <span className="badge badge-green">{selectedCompany.count} allocated</span>}
        </div>
        <div className="card">
        {/* ← CHANGED: the date filter stays visible while a day is chosen, and
            the table shows one page at a time with Previous / Next. */}
        {loading ? <p className="subtle">Loading companies…</p> : !companyId ? (
          <p className="subtle">Choose a company from the sidebar to see every lead currently allocated to it.</p>
        ) : (!loadingLeads && total === 0 && !dateFilter) ? <p className="subtle">No active leads are allocated to this company.</p> : (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label className="filter-control"><span>Allocated on</span>
              <input type="date" className="input" aria-label="Filter by allocated date" value={dateFilter} onChange={(e) => changeDay(e.target.value)} />
            </label>
            {dateFilter && <button type="button" className="btn" onClick={() => changeDay('')}>Clear</button>}
            <span className="subtle" role="status" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {loadingLeads ? 'Loading allocated leads…' : total === 0 ? '0 leads' : `Showing ${firstShown}–${lastShown} of ${total} leads`}
            </span>
          </div>
          {!loadingLeads && total === 0 ? <p className="subtle">No leads were allocated to this company on that date.</p> : (<>
          <div className="tbl-wrap" style={{ opacity: loadingLeads ? 0.6 : 1 }}><table className="tbl"><thead><tr><th>Practice</th><th>State</th><th>Specialty</th><th>Allocated</th><th>Status</th></tr></thead>
          <tbody>{leads.map((lead) => <tr key={lead.practiceCode}>
            <td><Link prefetch={false} href={`/practice/${lead.practiceCode}`}>{lead.name}</Link><small className="assigned-lead-code">{lead.practiceCode}</small></td>
            <td>{lead.state ?? '—'}</td><td>{lead.specialty ?? '—'}</td><td>{new Date(lead.allocatedAt).toLocaleString()}</td>
            <td><span className="badge badge-green">{lead.status}</span></td>
          </tr>)}</tbody></table></div>
          {/* ← ADDED: pager */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" disabled={loadingLeads || page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
              <span className="subtle" style={{ fontSize: 12 }}>Page {page} of {totalPages}</span>
              <button type="button" className="btn" disabled={loadingLeads || page >= totalPages} onClick={() => goToPage(page + 1)}>Next</button>
            </div>
          )}
          </>)}
        </>)}
        </div>
        {msg && <p className="subtle">{msg}</p>}
      </section>
    </div>
  )
}
