import { hasRealMips, type LeadRow } from './lead-filters'

// Is this lead a MIPS lead? Uses exactly the same rule as the Lead Pool's
// MIPS tab (hasRealMips in lead-filters.ts), with the provider_mips rows read
// the same way as lib/leads-data.ts — so a lead gets the MIPS layout on its
// page whenever it would appear under the MIPS tab, however it was opened
// (MIPS tab, New / any other filter, or search).
type MipsRow = { performance_year?: number | null; status?: string | null; reporting_option?: string | null }

export function isMipsLead(rows: MipsRow[] | null | undefined): boolean {
  const mipsByYear: Record<number, string> = {}
  for (const m of rows ?? []) {
    const raw = (m?.reporting_option ?? m?.status ?? '').toString().trim()
    let year = m?.performance_year ?? null
    if (!year) {
      const match = raw.match(/^(\d{4})/)
      if (match) year = parseInt(match[1], 10)
    }
    if (year) {
      const statusText = raw.replace(/^\d{4}\s*-\s*/, '')
      mipsByYear[year] = statusText || raw
    }
  }
  return hasRealMips({ mipsByYear } as unknown as LeadRow)
}
