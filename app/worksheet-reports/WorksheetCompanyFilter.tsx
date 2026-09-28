import Link from 'next/link'
import { Building2, Layers3 } from 'lucide-react'

export type WorksheetCompanyOption = { id: string; name: string; count: number }

export default function WorksheetCompanyFilter({ companies, selected, showAll }: {
  companies: WorksheetCompanyOption[]
  selected: string
  showAll: boolean
}) {
  const total = companies.reduce((sum, company) => sum + company.count, 0)
  return <div className="worksheet-company-nav" aria-label="Filter worksheets by company">
    <div className="worksheet-company-nav-label">Companies</div>
    {showAll && <Link href="/worksheet-reports" className={selected === '__all__' ? 'active' : ''}>
      <Layers3 size={15} strokeWidth={2} aria-hidden="true" /><span>All companies</span><strong>{total}</strong>
    </Link>}
    {companies.map(company => <Link key={company.id} href={`/worksheet-reports?company=${encodeURIComponent(company.id)}`} className={selected === company.id ? 'active' : ''}>
      <Building2 size={15} strokeWidth={2} aria-hidden="true" /><span>{company.name}</span><strong>{company.count}</strong>
    </Link>)}
  </div>
}
