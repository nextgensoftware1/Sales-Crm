'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Building2 } from 'lucide-react'
import { getCompanyAllocatedLeads, getCompanyAllocationSummary } from '../manage-assignments-actions'
import { toLocalCalendarDate } from '../../lib/lead-filters'

type Company = { id: string; name: string; count: number }
type AllocatedLead = { practiceCode: string; name: string; state: string | null; specialty: string | null; allocatedAt: string; status: string }

// When the page already fetched this server-side (the normal case now),
// initialData arrives pre-populated and the component renders immediately
// — no loading state, no client-side fetch. Falls back to the original
// client-side fetch if ever rendered without initialData.
export default function CompanyAllocationsClient({ initialData }: {
  initialData?: { ok: boolean; message?: string; companies?: Company[] }
} = {}) {
  const [companies, setCompanies] = useState<Company[]>(initialData?.ok ? (initialData.companies ?? []) : [])
  const [companyId, setCompanyId] = useState('')
  const [leads, setLeads] = useState<AllocatedLead[]>([])
  const [loading, setLoading] = useState(!initialData)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [msg, setMsg] = useState(initialData && !initialData.ok ? (initialData.message ?? 'Could not load company allocations.') : '')
  // "Allocated on" filter (calendar day in the viewer's time zone).
  const [dateFilter, setDateFilter] = useState('')
  const visibleLeads = useMemo(
    () => (dateFilter ? leads.filter((l) => toLocalCalendarDate(l.allocatedAt) === dateFilter) : leads),
    [leads, dateFilter],
  )

  useEffect(() => {
    if (initialData) return // already have it — no client-side fetch needed
    getCompanyAllocationSummary().then((result) => {
      if (result.ok) setCompanies(result.companies ?? [])
      else setMsg(result.message ?? 'Could not load company allocations.')
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickCompany = async (id: string) => {
    setCompanyId(id)
    setLeads([])
    setMsg('')
    if (!id) return
    setLoadingLeads(true)
    const result = await getCompanyAllocatedLeads(id)
    if (result.ok) setLeads(result.leads ?? [])
    else setMsg(result.message ?? 'Could not load allocated leads.')
    setLoadingLeads(false)
  }

  const selectedCompany = companies.find((company) => company.id === companyId)
  return (
    <div className="assigned-allocation-layout">
      <aside className="assigned-company-nav" aria-label="Allocated lead companies">
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
        {loading ? <p className="subtle">Loading companies…</p> : loadingLeads ? <p className="subtle">Loading allocated leads…</p> : !companyId ? (
          <p className="subtle">Choose a company from the sidebar to see every lead currently allocated to it.</p>
        ) : leads.length === 0 ? <p className="subtle">No active leads are allocated to this company.</p> : (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <label className="filter-control"><span>Allocated on</span>
              <input type="date" className="input" aria-label="Filter by allocated date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
            </label>
            {dateFilter && <button type="button" className="btn" onClick={() => setDateFilter('')}>Clear</button>}
            <span className="subtle" style={{ fontSize: 12, marginLeft: 'auto' }}>{visibleLeads.length} of {leads.length} leads</span>
          </div>
          {visibleLeads.length === 0 ? <p className="subtle">No leads were allocated to this company on that date.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Practice</th><th>State</th><th>Specialty</th><th>Allocated</th><th>Status</th></tr></thead>
          <tbody>{visibleLeads.map((lead) => <tr key={lead.practiceCode}>
            <td><Link prefetch={false} href={`/practice/${lead.practiceCode}`}>{lead.name}</Link><small className="assigned-lead-code">{lead.practiceCode}</small></td>
            <td>{lead.state ?? '—'}</td><td>{lead.specialty ?? '—'}</td><td>{new Date(lead.allocatedAt).toLocaleString()}</td>
            <td><span className="badge badge-green">{lead.status}</span></td>
          </tr>)}</tbody></table></div>
          )}
        </>)}
        </div>
        {msg && <p className="subtle">{msg}</p>}
      </section>
    </div>
  )
}
