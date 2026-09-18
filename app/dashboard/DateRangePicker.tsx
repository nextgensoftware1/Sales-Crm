'use client'

import { useRouter, usePathname } from 'next/navigation'

export default function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter()
  const pathname = usePathname()

  const setRange = (nextFrom: string, nextTo: string) => {
    const params = new URLSearchParams({ from: nextFrom, to: nextTo })
    router.push(`${pathname}?${params.toString()}`)
  }

  const resetToThisMonth = () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    setRange(first.toISOString().slice(0, 10), last.toISOString().slice(0, 10))
  }

  return (
    <div className="date-range-picker">
      <input
        type="date"
        className="input"
        value={from}
        max={to}
        onChange={(e) => setRange(e.target.value, to)}
        aria-label="From date"
      />
      <span className="date-range-sep">–</span>
      <input
        type="date"
        className="input"
        value={to}
        min={from}
        onChange={(e) => setRange(from, e.target.value)}
        aria-label="To date"
      />
      <button type="button" className="btn date-range-reset" onClick={resetToThisMonth} title="Reset to this month">
        This month
      </button>
    </div>
  )
}
