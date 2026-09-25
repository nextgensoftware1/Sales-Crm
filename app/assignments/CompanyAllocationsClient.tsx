'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { getCompanyAllocatedLeads, getCompanyAllocationSummary } from '../manage-assignments-actions'

type Company = { id: string; name: string; count: number }
type AllocatedLead = { practiceCode: string; name: string; state: string | null; specialty: string | null; allocatedAt: string; status: string }

export default function CompanyAllocationsClient() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [leads, setLeads] = useState<AllocatedLead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getCompanyAllocationSummary().then((result) => {
      if (result.ok) setCompanies(result.companies ?? [])
      else setMsg(result.message ?? 'Could not load company allocations.')
      setLoading(false)
    })
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
        ) : leads.length === 0 ? <p className="subtle">No active leads are allocated to this company.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Practice</th><th>State</th><th>Specialty</th><th>Allocated</th><th>Status</th></tr></thead>
          <tbody>{leads.map((lead) => <tr key={lead.practiceCode}>
            <td><Link prefetch={false} href={`/practice/${lead.practiceCode}`}>{lead.name}</Link><small className="assigned-lead-code">{lead.practiceCode}</small></td>
            <td>{lead.state ?? '—'}</td><td>{lead.specialty ?? '—'}</td><td>{new Date(lead.allocatedAt).toLocaleString()}</td>
            <td><span className="badge badge-green">{lead.status}</span></td>
          </tr>)}</tbody></table></div>
        )}
        </div>
        {msg && <p className="subtle">{msg}</p>}
      </section>
    </div>
  )
}
