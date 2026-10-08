'use client'

import { Building2, Layers3 } from 'lucide-react'
import { useKpiCompany } from '../../lib/kpi-company-store'

export type KpiCompanyOption = { id: string; name: string; count: number }

// Company list in the left KPI panel (same look as the Worksheet Reports one).
// Super Admin: "All companies" + every company with its verified-transfer
// count; clicking filters the KPI records instantly. Other roles: their own
// company's name.
export default function KpiCompanyNav({ companies, ownCompany }: { companies: KpiCompanyOption[]; ownCompany?: string | null }) {
  const [selected, setSelected] = useKpiCompany()
  if (!companies.length) {
    return ownCompany ? (
      <div className="worksheet-company-nav" aria-label="Company">
        <div className="worksheet-company-nav-label">Company</div>
        <a className="active" aria-current="true"><Building2 size={15} strokeWidth={2} aria-hidden="true" /><span>{ownCompany}</span><strong /></a>
      </div>
    ) : null
  }
  const total = companies.reduce((sum, c) => sum + c.count, 0)
  const item = (id: string, label: string, count: number, icon: React.ReactNode) => (
    <a key={id || 'all'} href="#" role="button" className={selected === id ? 'active' : ''} aria-pressed={selected === id}
      onClick={(e) => { e.preventDefault(); setSelected(id) }}>
      {icon}<span>{label}</span><strong>{count}</strong>
    </a>
  )
  return (
    <div className="worksheet-company-nav" aria-label="Filter KPI by company">
      <div className="worksheet-company-nav-label">Companies</div>
      {item('', 'All companies', total, <Layers3 size={15} strokeWidth={2} aria-hidden="true" />)}
      {companies.map((c) => item(c.id, c.name, c.count, <Building2 size={15} strokeWidth={2} aria-hidden="true" />))}
    </div>
  )
}
