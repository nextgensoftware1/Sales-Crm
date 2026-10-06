// "Assigned on" date filter helper, shared by the Leads page and the
// Assignments page.

/** "2026-10-06" -> "Oct 6, 2026" (in the viewer's locale), for the filter chip. */
export function formatCalendarDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
