'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Building2, Layers3 } from 'lucide-react'

type Company = { id: string; name: string }
type ReminderCompanyFilterValue = {
  companies: Company[]
  companyId: string
  setCompanyId: (companyId: string) => void
}

const ReminderCompanyFilterContext = createContext<ReminderCompanyFilterValue | null>(null)

export function ReminderCompanyFilterProvider({ companies, children }: { companies: Company[]; children: ReactNode }) {
  const [companyId, setCompanyId] = useState('all')
  const value = useMemo(() => ({ companies, companyId, setCompanyId }), [companies, companyId])
  return <ReminderCompanyFilterContext.Provider value={value}>{children}</ReminderCompanyFilterContext.Provider>
}

export function useReminderCompanyFilter() {
  return useContext(ReminderCompanyFilterContext)
}

export function ReminderCompanyNav({ counts }: { counts: Record<string, number> }) {
  const filter = useReminderCompanyFilter()
  if (!filter || filter.companies.length === 0) return null

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const choices = [{ id: 'all', name: 'All companies', count: total }, ...filter.companies.map((company) => ({
    ...company,
    count: counts[company.id] ?? 0,
  }))]

  return (
    <div className="reminder-company-nav" aria-label="Filter reminders by company">
      <span className="reminder-company-nav-label">Companies</span>
      {choices.map((company) => {
        const active = filter.companyId === company.id
        const Icon = company.id === 'all' ? Layers3 : Building2
        return (
          <button key={company.id} type="button" className={active ? 'active' : ''} onClick={() => filter.setCompanyId(company.id)} aria-pressed={active}>
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
            <span title={company.name}>{company.name}</span>
            <strong>{company.count}</strong>
          </button>
        )
      })}
    </div>
  )
}
