import Link from 'next/link'
import { Building2, Layers3 } from 'lucide-react'

export type WorksheetCompanyOption = { id: string; name: string; count: number }

// ← CHANGED: basePath / ariaLabel added so Active Email (/email-reports) can
// reuse this same company list. Active Call keeps the defaults unchanged.
export default function WorksheetCompanyFilter({ companies, selected, showAll, basePath = '/worksheet-reports', ariaLabel = 'Filter worksheets by company' }: {
  companies: WorksheetCompanyOption[]
  selected: string
  showAll: boolean
  basePath?: string
  ariaLabel?: string
}) {
  const total = companies.reduce((sum, company) => sum + company.count, 0)
  return <div className="worksheet-company-nav" aria-label={ariaLabel}>
    <div className="worksheet-company-nav-label">Companies</div>
    {showAll && <Link href={basePath} className={selected === '__all__' ? 'active' : ''}>
      <Layers3 size={15} strokeWidth={2} aria-hidden="true" /><span>All companies</span><strong>{total}</strong>
    </Link>}
    {companies.map(company => <Link key={company.id} href={`${basePath}?company=${encodeURIComponent(company.id)}`} className={selected === company.id ? 'active' : ''}>
      <Building2 size={15} strokeWidth={2} aria-hidden="true" /><span>{company.name}</span><strong>{company.count}</strong>
    </Link>)}
  </div>
}
