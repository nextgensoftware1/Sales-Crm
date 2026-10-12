'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { fromPickerValue, rangeLabel, toPickerValue } from '../../lib/date-range'

// Dashboard date + time range. Pick From and To (date and time, in your local
// time) and press Apply. The page then filters every
// number to exactly that range.
export default function DateRangePicker({ from, to }: { from: string; to: string }) {
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

  const go = (nextFrom: string, nextTo: string) => {
    const params = new URLSearchParams({ from: nextFrom, to: nextTo })
    router.push(`${pathname}?${params.toString()}`)
  }
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
      </div>
      {reversed && <small role="alert" className="date-range-error">“From” is after “To”.</small>}
    </section>
  )
}
