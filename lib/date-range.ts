// Dashboard date + time range.
//
// The URL carries `from` / `to` either as plain dates (YYYY-MM-DD — older links
// and the default month) or as exact moments in UTC (e.g.
// 2026-10-05T15:00:00.000Z), which the picker creates from the viewer's own
// local date + time. "To" includes its whole minute (to 2:00 AM includes 2:00:59).

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/

export function isRangeValue(v: unknown): v is string {
  return typeof v === 'string' && (DATE_ONLY.test(v) || (INSTANT.test(v) && !Number.isNaN(Date.parse(v))))
}

/** Exact UTC bounds for database filters, or null if the range is invalid. */
export function rangeBounds(from: unknown, to: unknown): { fromISO: string; toISO: string } | null {
  if (!isRangeValue(from) || !isRangeValue(to)) return null
  const fromISO = DATE_ONLY.test(from) ? `${from}T00:00:00.000Z` : new Date(from).toISOString()
  const toISO = DATE_ONLY.test(to) ? `${to}T23:59:59.999Z` : new Date(Date.parse(to) + 59_999).toISOString()
  return fromISO <= toISO ? { fromISO, toISO } : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** URL value -> <input type="datetime-local"> value (viewer's local time). */
export function toPickerValue(v: string, end: boolean): string {
  if (DATE_ONLY.test(v)) return `${v}T${end ? '23:59' : '00:00'}`
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : localInput(d)
}

/** <input type="datetime-local"> value (local) -> URL value (exact UTC moment). */
export function fromPickerValue(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Human label for one end of the range. */
export function rangeLabel(v: string): string {
  if (DATE_ONLY.test(v)) {
    const [y, m, d] = v.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Presets in the viewer's local time, as exact UTC moments. */
export function presetRange(kind: 'today' | 'last7' | 'month', now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59)
  if (kind === 'today') return { from: start.toISOString(), to: endOfToday.toISOString() }
  if (kind === 'last7') return { from: new Date(start.getFullYear(), start.getMonth(), start.getDate() - 6).toISOString(), to: endOfToday.toISOString() }
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59).toISOString(),
  }
}
