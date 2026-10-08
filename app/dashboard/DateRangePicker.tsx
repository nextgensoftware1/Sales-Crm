'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { fromPickerValue, rangeLabel, toPickerValue } from '../../lib/date-range'

// Dashboard date + time range. Pick From and To (date and time, in your local
// time) and press Apply. The page then filters every
// number to exactly that range.
export type DashboardFilterOptions = {
  company: string
  agent: string
  companies: { id: string; name: string }[]
  people: { id: string; name: string }[]
  canPickAgent: boolean
}

// Company (Super Admin) and Agent filters sit next to the range and apply to
// the WHOLE Dashboard. Changing either applies right away and keeps the range.
export default function DateRangePicker({ from, to, filters }: { from: string; to: string; filters?: DashboardFilterOptions }) {
  const router = useRouter()
  const pathname = usePathname()
  // Local date/time text depends on the viewer's time zone, so it's filled in
  // after the page loads in the browser.
  const [fromValue, setFromValue] = useState('')
  const [toValue, setToValue] = useState('')
  const [activeLabel, setActiveLabel] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => {
      setFromValue(toPickerValue(from, false)); setToValue(toPickerValue(to, true))
      setActiveLabel(`${rangeLabel(from)} – ${rangeLabel(to)}`)
    }, 0)
    return () => window.clearTimeout(id)
  }, [from, to])

  const go = (nextFrom: string, nextTo: string, company = filters?.company ?? '', agent = filters?.agent ?? '') => {
    const params = new URLSearchParams({ from: nextFrom, to: nextTo })
    if (company) params.set('company', company)
    if (agent) params.set('agent', agent)
    router.push(`${pathname}?${params.toString()}`)
  }
  const showCompany = !!filters && filters.companies.length > 0
  const showAgent = !!filters && filters.canPickAgent && filters.people.length > 0
  const activeFilters = (filters?.company ? 1 : 0) + (filters?.agent ? 1 : 0)
  const fromISO = fromPickerValue(fromValue)
  const toISO = fromPickerValue(toValue)
  const reversed = !!fromISO && !!toISO && fromISO > toISO
  const changed = fromValue !== toPickerValue(from, false) || toValue !== toPickerValue(to, true)
  const canApply = !!fromISO && !!toISO && !reversed && changed

  return (
    <section className="card dash-range-bar" aria-label="Date and time range">
      <div className="dash-range-title">
        <span className="dash-range-icon" aria-hidden="true"><CalendarClock size={16} /></span>
        <div>
          <strong>Date &amp; time range</strong>
          <small>{activeLabel ? `Showing ${activeLabel}` : '\u00a0'}</small>
        </div>
      </div>
      <div className="date-range-picker">
        <label className="dash-range-field"><span>From</span>
          <input type="datetime-local" className="input" value={fromValue} max={toValue || undefined}
            onChange={(e) => setFromValue(e.target.value)} aria-label="From date and time" />
        </label>
        <label className="dash-range-field"><span>To</span>
          <input type="datetime-local" className="input" value={toValue} min={fromValue || undefined}
            onChange={(e) => setToValue(e.target.value)} aria-label="To date and time" />
        </label>
        <button type="button" className="btn btn-primary dash-range-apply" disabled={!canApply} onClick={() => fromISO && toISO && go(fromISO, toISO)}>Apply</button>
        {showCompany && (
          <label className="dash-range-field"><span>Company</span>
            <select className="input" aria-label="Company" value={filters!.company}
              onChange={(e) => go(from, to, e.target.value, '')}>
              <option value="">All companies</option>
              {filters!.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {showAgent && (
          <label className="dash-range-field"><span>Agent</span>
            <select className="input" aria-label="Agent" value={filters!.agent}
              onChange={(e) => go(from, to, filters!.company, e.target.value)}>
              <option value="">All agents</option>
              {filters!.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {activeFilters > 0 && (
          <button type="button" className="btn" onClick={() => go(from, to, '', '')}>Clear ({activeFilters})</button>
        )}
      </div>
      {reversed && <small role="alert" className="date-range-error">“From” is after “To”.</small>}
    </section>
  )
}
